'use strict';

var sc = angular.module('stellarClient');

sc.service('transactionHistory', function($rootScope, $q, StellarNetwork, session, contacts) {
  var history;

  var currentOffset;
  var allTransactionsLoaded;

  var ensureInitialized = StellarNetwork.ensureConnection().then(init);

  function init() {
    history = [];

    var account = StellarNetwork.remote.account(session.get('address'));
    account.on('transaction', processNewTransaction);

    currentOffset = 0;
    allTransactionsLoaded = false;
  }

  function getPage(pageNumber) {
    return ensureInitialized.then(function() {
      // Always keep one extra page of transactions.
      var transactionsNeeded = (pageNumber + 1) * Options.TRANSACTIONS_PER_PAGE;

      if (!allTransactionsLoaded && history.length < transactionsNeeded) {
        return requestTransactions().then(function() {
          return getPage(pageNumber);
        });
      } else {
        var startIndex = (pageNumber - 1) * Options.TRANSACTIONS_PER_PAGE;
        var endIndex = pageNumber * Options.TRANSACTIONS_PER_PAGE;

        if (history.length <= startIndex) {
          return $q.reject();
        } else {
          var transactions = history.slice(startIndex, endIndex);
          return $q.when(transactions);
        }
      }
    });
  }

  function lastPage() {
    if (allTransactionsLoaded) {
      return Math.ceil(history.length / Options.TRANSACTIONS_PER_PAGE);
    } else {
      return Infinity;
    }
  }

  /**
   * Request the first page of the transaction history.
   */
  function requestTransactions() {
    var txRequest = StellarNetwork.request('account_tx', {
      'account': session.get('address'),
      'ledger_index_min': -1,
      'ledger_index_max': -1,
      'descending': true,
      'limit': Options.TRANSACTIONS_PER_PAGE,
      'offset': currentOffset
    });

    return txRequest.then(processTransactionSet);
  }

  /**
   * Process a set of transactions.
   */
  function processTransactionSet(data) {
    data.transactions = data.transactions || [];

    currentOffset += data.transactions.length;

    data.transactions.forEach(function (transaction) {
      processTransaction(transaction.tx, transaction.meta);
    });

    // Request more transactions until there are no more left.
    if (!_.any(data.transactions)) {
      allTransactionsLoaded = true;
    }
  }

  /**
   * Process new transactions as they occur.
   */
  function processNewTransaction(data) {
    currentOffset++;

    var tx = processTransaction(data.transaction, data.meta, true);

    if (tx.tx_result === "tesSUCCESS" && tx.transaction) {
      $rootScope.$broadcast('$appTxNotification', tx.transaction);
    }

    $rootScope.$broadcast('transactionHistory.historyUpdated');
  }

  /**
   * Clean up a transactions, add it to the history, and add the counterparty and issuer addresses to the contacts list.
   *
   * NOTE:  this does not, and should not do an $apply.  It gets expensive doing that on every transaction
   */
  function processTransaction(tx, meta, isNew) {
    var processedTxn = JsonRewriter.processTxn(tx, meta, session.get('address'));

    if (processedTxn) {
      var transaction = processedTxn.transaction;

      if (processedTxn.tx_type === "Payment" && processedTxn.tx_result === "tesSUCCESS" && transaction) {
        contacts.fetchContactByAddress(transaction.counterparty);

        if (transaction.amount) {
          if (tx.Amount.issuer === tx.Destination && tx.Paths) {
            // When the issuer is set to the counterparty the transaction allows using any trusted issuer.
            // Find the issuer that was used in the last currency in the path.
            var lastPath = _.last(tx.Paths[0]);
            transaction.amount.issuer().parse_json(lastPath.issuer);
          }

          var issuer = transaction.amount.issuer().to_json();
          if (issuer) {
            contacts.fetchContactByAddress(issuer);
          }
        }

        if (isNew) {
          history.unshift(processedTxn);
        } else {
          history.push(processedTxn);
        }
      }
    }


    return processedTxn;
  }

  return {
    getPage: getPage,
    lastPage: lastPage
  };
});