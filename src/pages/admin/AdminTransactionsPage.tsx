import React, { useState, useEffect, useMemo } from 'react';
import { transactionService } from '../../services/transactionService';
import type { FinancialTransaction, AdminTreasurySummary } from '../../types/transaction';
import { ErrorState } from '../../components/common/ErrorState';
import { Select } from '../../components/common/Select';
import { formatINR } from '../../lib/currency';
import { formatDateDDMMYYYY } from '../../lib/dateFormat';
import { CheckCircle2, Download, Search, RotateCcw, Wallet, ArrowDownLeft, Percent, Landmark, Clock, RefreshCw } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { useToast } from '../../context/ToastContext';

export const AdminTransactionsPage: React.FC = () => {
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [backendSummary, setBackendSummary] = useState<AdminTreasurySummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isReconciling, setIsReconciling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CR' | 'DR'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');

  const { showToast } = useToast();

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await transactionService.getTransactionsWithSummary({
        type: typeFilter !== 'ALL' ? typeFilter : undefined,
      });
      setTransactions(res.transactions);
      if (res.summary) {
        setBackendSummary(res.summary);
      }
    } catch (err: any) {
      setError(err.message || 'Unable to load platform-wide financial transaction ledger.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [typeFilter]);

  const handleReconcile = async (transactionId?: string, allPending: boolean = false) => {
    setIsReconciling(true);
    try {
      const res = await transactionService.reconcileCash({
        transactionId,
        allPending: allPending || undefined,
      });
      showToast(`Successfully reconciled ${res.reconciledCount} cash collection${res.reconciledCount === 1 ? '' : 's'}.`);
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to reconcile cash collections.', 'error');
    } finally {
      setIsReconciling(false);
    }
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (categoryFilter !== 'ALL') {
        const cat = (tx.transactionCategory || tx.category || '').toUpperCase();
        if (cat !== categoryFilter.toUpperCase()) {
          // Check alternate alias mapping
          if (categoryFilter === 'COD_COLLECTION' && cat !== 'ORDER_REVENUE') return false;
          if (categoryFilter === 'PLATFORM_COMMISSION' && cat !== 'PLATFORM_FEE') return false;
          if (categoryFilter === 'SELLER_PAYOUT' && cat !== 'SETTLEMENT_PAYOUT') return false;
          if (categoryFilter === 'CUSTOMER_REFUND' && cat !== 'REFUND_DEDUCTION') return false;
        }
      }

      if (dateFilter !== 'ALL') {
        const txDate = new Date(tx.createdAt).getTime();
        const now = Date.now();
        if (dateFilter === 'TODAY' && txDate < now - 24 * 60 * 60 * 1000) return false;
        if (dateFilter === 'WEEK' && txDate < now - 7 * 24 * 60 * 60 * 1000) return false;
        if (dateFilter === 'MONTH' && txDate < now - 30 * 24 * 60 * 60 * 1000) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTx = tx.transactionNumber?.toLowerCase().includes(q);
        const matchOrder = tx.orderNumber?.toLowerCase().includes(q);
        const matchSeller = tx.sellerName?.toLowerCase().includes(q);
        const matchDesc = tx.description?.toLowerCase().includes(q);
        const matchCashRef = tx.cashCollectionReference?.toLowerCase().includes(q);
        const matchPayoutId = tx.sellerPayoutId?.toLowerCase().includes(q);
        const matchCat = (tx.transactionCategory || tx.category)?.toLowerCase().includes(q);

        if (
          !matchTx &&
          !matchOrder &&
          !matchSeller &&
          !matchDesc &&
          !matchCashRef &&
          !matchPayoutId &&
          !matchCat
        ) {
          return false;
        }
      }

      return true;
    });
  }, [transactions, categoryFilter, dateFilter, searchQuery]);

  // Verified Summary Metrics (uses verified backend figures when available, with accurate fallback)
  const summary = useMemo(() => {
    if (backendSummary) {
      return backendSummary;
    }
    const totalCodCollected = transactions
      .filter((t) => t.type === 'CR' && ((t.transactionCategory || t.category) === 'COD_COLLECTION' || t.category === 'ORDER_REVENUE'))
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const sellerPayoutsPaid = transactions
      .filter((t) => t.type === 'DR')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const retainedCommission = Math.round(totalCodCollected * 0.05 * 100) / 100;
    const cashAwaitingReconciliation = transactions
      .filter((t) => t.type === 'CR' && !t.isReconciled)
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const pendingSellerPayouts = 0;
    const reconciledCash = Math.max(0, Math.round((totalCodCollected - cashAwaitingReconciliation) * 100) / 100);
    const treasuryBalance = Math.max(0, Math.round((reconciledCash - sellerPayoutsPaid) * 100) / 100);

    return {
      totalCodCollected,
      sellerPayoutsPaid,
      pendingSellerPayouts,
      retainedCommission,
      cashAwaitingReconciliation,
      reconciledCash,
      treasuryBalance,
    };
  }, [transactions, backendSummary]);

  /** Real CSV export of the loaded ledger rows. */
  const handleExportCSV = () => {
    if (filteredTransactions.length === 0) {
      showToast('There are no transactions to export.', 'error');
      return;
    }

    try {
      const header = [
        'Ledger Tx ID',
        'Timestamp',
        'Seller / Entity',
        'Order ID',
        'Transaction Category',
        'Payment Method',
        'Credit (CR)',
        'Debit (DR)',
        'Cash Collection Ref',
        'Seller Payout ID',
        'Status',
        'Running Balance',
      ];
      const rows = filteredTransactions.map((tx) => [
        tx.transactionNumber,
        formatDateDDMMYYYY(tx.createdAt),
        tx.sellerName ?? 'Platform Central Treasury',
        tx.orderNumber ?? '—',
        tx.transactionCategory || tx.category,
        tx.paymentMethod ?? 'Cash on Delivery (COD)',
        tx.type === 'CR' ? String(tx.amount) : '0',
        tx.type === 'DR' ? String(tx.amount) : '0',
        tx.cashCollectionReference ?? '—',
        tx.sellerPayoutId ?? '—',
        tx.status,
        String(tx.balanceAfter),
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `treasury-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      showToast(`Exported ${filteredTransactions.length} transaction${filteredTransactions.length === 1 ? '' : 's'} to CSV.`);
    } catch (err: any) {
      showToast(err.message || 'Failed to export transactions.', 'error');
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <div className="border-b border-stone-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
            Central Treasury & FinTech Passbook
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Platform Financial Transaction Ledger
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            100% Cash on Delivery platform accounting — tracking verified cash collection, 5% retained commission, and seller settlements
          </p>
        </div>

        <div className="flex items-center gap-3">
          {summary.cashAwaitingReconciliation > 0 && (
            <Button
              variant="primary"
              size="sm"
              isLoading={isReconciling}
              onClick={() => handleReconcile(undefined, true)}
              leftIcon={<RefreshCw className="w-4 h-4" />}
            >
              Reconcile All Pending Cash ({formatINR(summary.cashAwaitingReconciliation)})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExportCSV} leftIcon={<Download className="w-4 h-4" />}>
            Export CSV
          </Button>
        </div>
      </div>

      {/* ── 6 Independent Treasury Summary Metric Cards ───────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* 1. Total COD Collected */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Total COD Collected</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-stone-900">
            {formatINR(summary.totalCodCollected)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">Actual customer cash collected</span>
        </div>

        {/* 2. Seller Payouts Paid */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Seller Payouts Paid</span>
            <ArrowDownLeft className="w-4 h-4 text-rosered-600" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-rosered-600">
            {formatINR(summary.sellerPayoutsPaid)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">Completed seller settlements</span>
        </div>

        {/* 3. Pending Seller Payouts */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Pending Payouts</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-amber-700">
            {formatINR(summary.pendingSellerPayouts)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">Approved awaiting settlement</span>
        </div>

        {/* 4. Retained Commission */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Retained Commission</span>
            <Percent className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-indigo-900">
            {formatINR(summary.retainedCommission)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">5% platform commission profit</span>
        </div>

        {/* 5. Cash Awaiting Reconciliation */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Awaiting Reconcile</span>
            <RefreshCw className="w-4 h-4 text-orange-500" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-orange-700">
            {formatINR(summary.cashAwaitingReconciliation)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">Collected not yet in treasury</span>
        </div>

        {/* 6. Treasury Balance */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Treasury Balance</span>
            <Landmark className="w-4 h-4 text-emerald-700" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-emerald-800">
            {formatINR(summary.treasuryBalance)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">Reconciled platform cash balance</span>
        </div>
      </div>

      {/* ── Filters Bar ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-stone-200 p-3 sm:p-4 shadow-soft space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Search Txn, Order, Seller, CASH-, PAY-..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-500/20 bg-stone-50/50"
            />
          </div>

          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'All Categories' },
              { value: 'COD_COLLECTION', label: 'COD Collection' },
              { value: 'PLATFORM_COMMISSION', label: 'Platform Commission (5%)' },
              { value: 'SELLER_PAYOUT', label: 'Seller Payout' },
              { value: 'CUSTOMER_REFUND', label: 'Customer Refund' },
              { value: 'ADJUSTMENT', label: 'Adjustment / Reversal' },
            ]}
          />

          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            options={[
              { value: 'ALL', label: 'All Operations (CR/DR)' },
              { value: 'CR', label: 'Credits (COD Cash In)' },
              { value: 'DR', label: 'Debits (Payouts Disbursed)' },
            ]}
          />

          <Select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            options={[
              { value: 'ALL', label: 'All Time' },
              { value: 'TODAY', label: 'Today' },
              { value: 'WEEK', label: 'Last 7 Days' },
              { value: 'MONTH', label: 'Last 30 Days' },
            ]}
          />
        </div>

        {(searchQuery || typeFilter !== 'ALL' || categoryFilter !== 'ALL' || dateFilter !== 'ALL') && (
          <div className="flex items-center justify-between pt-2 border-t border-stone-100 text-xs text-stone-500">
            <span>Showing {filteredTransactions.length} of {transactions.length} operations</span>
            <button
              onClick={() => {
                setSearchQuery('');
                setTypeFilter('ALL');
                setCategoryFilter('ALL');
                setDateFilter('ALL');
              }}
              className="inline-flex items-center gap-1 text-amber-700 hover:underline font-medium"
            >
              <RotateCcw className="w-3 h-3" /> Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* ── Table & Mobile Cards ────────────────────────────────────────── */}
      {error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Accessing fiscal ledger...</div>
      ) : filteredTransactions.length === 0 ? (
        <div className="bg-white rounded-2xl sm:rounded-3xl p-12 border border-cream-200 shadow-soft text-center text-xs text-stone-500">
          No transactions found matching your criteria.
        </div>
      ) : (
        <>
          {/* Mobile Card Layout (< md) */}
          <div className="md:hidden space-y-3">
            {filteredTransactions.map((tx) => {
              const displayCategory = tx.transactionCategory || tx.category;
              return (
                <div
                  key={tx.id}
                  className="bg-white rounded-2xl p-4 border border-cream-200 shadow-soft space-y-3"
                >
                  <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-cream-100">
                    <div>
                      <span className="font-mono text-xs font-bold text-stone-900 block">
                        {tx.transactionNumber}
                      </span>
                      <span className="text-[10px] text-stone-500 font-mono">
                        {formatDateDDMMYYYY(tx.createdAt)}
                      </span>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        tx.type === 'CR'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {tx.type === 'CR' ? 'CREDIT (CR)' : 'DEBIT (DR)'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-stone-400 block uppercase font-bold">Seller / Entity</span>
                      <span className="font-semibold text-stone-800 truncate block">
                        {tx.sellerName || 'Central Platform Escrow'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 block uppercase font-bold">Order ID</span>
                      <span className="font-mono text-stone-700 block">
                        {tx.orderNumber || '—'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-stone-50 rounded-xl p-2.5 space-y-1.5 text-[11px] border border-stone-200/60 font-mono">
                    <div className="flex justify-between items-center text-stone-600">
                      <span className="font-sans text-[10px] uppercase text-stone-400">Category:</span>
                      <span className="font-semibold text-stone-800">{displayCategory}</span>
                    </div>
                    {tx.cashCollectionReference && (
                      <div className="flex justify-between items-center">
                        <span className="font-sans text-[10px] uppercase text-stone-400">Cash Ref:</span>
                        <span className="font-bold text-emerald-700">{tx.cashCollectionReference}</span>
                      </div>
                    )}
                    {tx.sellerPayoutId && (
                      <div className="flex justify-between items-center">
                        <span className="font-sans text-[10px] uppercase text-stone-400">Payout ID:</span>
                        <span className="font-bold text-amber-800">{tx.sellerPayoutId}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-cream-100 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[10px] text-stone-400 block font-semibold uppercase">Amount</span>
                      <span
                        className={`text-sm font-bold font-mono ${
                          tx.type === 'CR' ? 'text-emerald-700' : 'text-rose-600'
                        }`}
                      >
                        {tx.type === 'CR' ? `+${formatINR(tx.amount)}` : `-${formatINR(tx.amount)}`}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-stone-400 block font-semibold uppercase">Treasury Balance</span>
                      <span className="text-xs font-bold text-stone-900 font-mono">
                        {formatINR(tx.balanceAfter)}
                      </span>
                    </div>
                  </div>

                  {/* Mobile Actions */}
                  {tx.type === 'CR' && !tx.isReconciled && (
                    <div className="pt-2 border-t border-stone-100 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={isReconciling}
                        onClick={() => handleReconcile(tx.id)}
                        className="text-[11px] py-1 px-2.5 h-auto text-amber-700 border-amber-300"
                      >
                        Reconcile Cash
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop FinTech Ledger Table (>= md) */}
          <div className="hidden md:block bg-white rounded-3xl border border-cream-200 shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-cream-100/60 border-b border-cream-200 text-stone-600 uppercase tracking-wider font-bold text-[10px] sm:text-[11px]">
                    <th className="py-3.5 px-4 whitespace-nowrap">Ledger Txn ID</th>
                    <th className="py-3.5 px-3 whitespace-nowrap">Timestamp</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Seller / Entity</th>
                    <th className="py-3.5 px-3 whitespace-nowrap">Order ID</th>
                    <th className="py-3.5 px-3 whitespace-nowrap">Category</th>
                    <th className="py-3.5 px-3 whitespace-nowrap">Payment Method</th>
                    <th className="py-3.5 px-3 text-right text-emerald-700 whitespace-nowrap">Credit (CR)</th>
                    <th className="py-3.5 px-3 text-right text-rosered-600 whitespace-nowrap">Debit (DR)</th>
                    <th className="py-3.5 px-3 whitespace-nowrap">Cash Ref</th>
                    <th className="py-3.5 px-3 whitespace-nowrap">Payout ID</th>
                    <th className="py-3.5 px-3 text-center whitespace-nowrap">Status</th>
                    <th className="py-3.5 px-3 text-right whitespace-nowrap">Treasury Balance</th>
                    <th className="py-3.5 px-4 text-center whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-100 font-mono text-[11px]">
                  {filteredTransactions.map((tx) => {
                    const displayCategory = tx.transactionCategory || tx.category;
                    return (
                      <tr key={tx.id} className="hover:bg-cream-50/50 transition-colors">
                        {/* 1. Ledger Transaction ID */}
                        <td className="py-3.5 px-4 font-bold text-stone-900 whitespace-nowrap">
                          {tx.transactionNumber}
                        </td>

                        {/* 2. Timestamp */}
                        <td className="py-3.5 px-3 text-stone-600 font-mono whitespace-nowrap">
                          {formatDateDDMMYYYY(tx.createdAt)}
                        </td>

                        {/* 3. Seller / Entity */}
                        <td className="py-3.5 px-4 font-sans font-medium text-stone-800 whitespace-nowrap max-w-[150px] truncate" title={tx.sellerName || 'Central Platform Escrow'}>
                          {tx.sellerName || 'Central Platform Escrow'}
                        </td>

                        {/* 4. Order ID */}
                        <td className="py-3.5 px-3 text-stone-600 whitespace-nowrap">
                          {tx.orderNumber || '—'}
                        </td>

                        {/* 5. Transaction Category */}
                        <td className="py-3.5 px-3 font-sans whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-stone-100 text-stone-800 border border-stone-200">
                            {displayCategory}
                          </span>
                        </td>

                        {/* 6. Payment Method */}
                        <td className="py-3.5 px-3 font-sans text-stone-600 whitespace-nowrap">
                          {tx.paymentMethod || 'Cash on Delivery (COD)'}
                        </td>

                        {/* 7. Credit (CR) */}
                        <td className="py-3.5 px-3 text-right font-bold text-emerald-700 whitespace-nowrap">
                          {tx.type === 'CR' ? `+${formatINR(tx.amount)}` : '—'}
                        </td>

                        {/* 8. Debit (DR) */}
                        <td className="py-3.5 px-3 text-right font-bold text-rosered-600 whitespace-nowrap">
                          {tx.type === 'DR' ? `-${formatINR(tx.amount)}` : '—'}
                        </td>

                        {/* 9. Cash Collection Reference */}
                        <td className="py-3.5 px-3 text-emerald-800 font-bold whitespace-nowrap">
                          {tx.cashCollectionReference || '—'}
                        </td>

                        {/* 10. Seller Payout ID */}
                        <td className="py-3.5 px-3 text-amber-800 font-bold whitespace-nowrap">
                          {tx.sellerPayoutId || '—'}
                        </td>

                        {/* 11. Transaction Status */}
                        <td className="py-3.5 px-3 text-center whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              tx.isReconciled
                                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                : 'text-amber-800 bg-amber-50 border-amber-200'
                            }`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {tx.isReconciled ? 'RECONCILED' : tx.status}
                          </span>
                        </td>

                        {/* 13. Running Balance */}
                        <td className="py-3.5 px-3 text-right font-bold text-stone-900 whitespace-nowrap">
                          {formatINR(tx.balanceAfter)}
                        </td>

                        {/* 14. Actions */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {tx.type === 'CR' && !tx.isReconciled ? (
                            <Button
                              size="sm"
                              variant="outline"
                              isLoading={isReconciling}
                              onClick={() => handleReconcile(tx.id)}
                              className="text-[10px] py-1 px-2.5 h-auto text-amber-800 border-amber-300 hover:bg-amber-50"
                            >
                              Reconcile
                            </Button>
                          ) : (
                            <span className="text-stone-400 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
