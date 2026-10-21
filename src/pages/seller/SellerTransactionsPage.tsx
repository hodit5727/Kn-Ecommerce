import React, { useState, useEffect, useMemo } from 'react';
import { transactionService } from '../../services/transactionService';
import { FinancialTransaction } from '../../types/transaction';
import { ErrorState } from '../../components/common/ErrorState';
import { Select } from '../../components/common/Select';
import { Button } from '../../components/common/Button';
import { formatINR } from '../../lib/currency';
import { useToast } from '../../context/ToastContext';
import {
  Search,
  CheckCircle2,
  Download,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  Calendar,
  Wallet,
  Percent,
  Receipt
} from 'lucide-react';

export const SellerTransactionsPage: React.FC = () => {
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CR' | 'DR'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'POSTED' | 'PENDING'>('ALL');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');

  const { showToast } = useToast();

  const loadTransactions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await transactionService.getTransactions({
        type: typeFilter !== 'ALL' ? typeFilter : undefined,
      });
      setTransactions(data);
    } catch (err: any) {
      setError(err.message || 'Unable to load seller transaction ledger.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [typeFilter]);

  // Client-side filtering across search, status, and date range
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Status filter
      if (statusFilter !== 'ALL' && tx.status !== statusFilter) return false;

      // Date range filter
      if (dateFilter !== 'ALL') {
        const txDate = new Date(tx.createdAt).getTime();
        const now = Date.now();
        if (dateFilter === 'TODAY') {
          const oneDayAgo = now - 24 * 60 * 60 * 1000;
          if (txDate < oneDayAgo) return false;
        } else if (dateFilter === 'WEEK') {
          const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
          if (txDate < oneWeekAgo) return false;
        } else if (dateFilter === 'MONTH') {
          const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;
          if (txDate < oneMonthAgo) return false;
        }
      }

      // Search query across order ID, transaction number, product name, SKU, payout ref
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchTxNumber = tx.transactionNumber?.toLowerCase().includes(query);
        const matchOrderNumber = tx.orderNumber?.toLowerCase().includes(query);
        const matchProductName = tx.productName?.toLowerCase().includes(query);
        const matchSku = tx.productSku?.toLowerCase().includes(query);
        const matchPayoutRef = tx.payoutReference?.toLowerCase().includes(query);
        const matchDesc = tx.description?.toLowerCase().includes(query);

        if (!matchTxNumber && !matchOrderNumber && !matchProductName && !matchSku && !matchPayoutRef && !matchDesc) {
          return false;
        }
      }

      return true;
    });
  }, [transactions, statusFilter, dateFilter, searchQuery]);

  // Metric aggregates from the loaded ledger rows
  const summaryMetrics = useMemo(() => {
    const crEntries = transactions.filter((t) => t.type === 'CR');
    const drEntries = transactions.filter((t) => t.type === 'DR');

    const totalGrossSales = crEntries.reduce((sum, t) => sum + (t.grossAmount || t.amount || 0), 0);
    const totalCommission = transactions.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);
    const totalNetReceived = drEntries.reduce((sum, t) => sum + (t.netAmount || t.amount || 0), 0);
    const latestBalance = transactions.length > 0 ? transactions[0].balanceAfter : 0;

    return { totalGrossSales, totalCommission, totalNetReceived, latestBalance };
  }, [transactions]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setTypeFilter('ALL');
    setStatusFilter('ALL');
    setDateFilter('ALL');
  };

  const handleExportCSV = () => {
    if (filteredTransactions.length === 0) {
      showToast('No transactions available to export.', 'error');
      return;
    }

    try {
      const header = [
        'Transaction ID',
        'Date',
        'Order ID',
        'Product ID / SKU',
        'Product Name',
        'Gross Amount',
        'Commission Rate',
        'Commission Amount',
        'Net Seller Received',
        'Payout Reference',
        'Ledger Balance',
        'Status',
      ];

      const rows = filteredTransactions.map((tx) => [
        tx.transactionNumber,
        new Date(tx.createdAt).toLocaleDateString(),
        tx.orderNumber || '—',
        tx.productSku || tx.productId || '—',
        tx.productName || (tx.category === 'SETTLEMENT_PAYOUT' ? 'Settlement Payout' : 'Catalogue Product'),
        String(tx.grossAmount || tx.amount),
        `${tx.commissionRate || 5}%`,
        String(tx.commissionAmount || Math.round((tx.grossAmount || tx.amount) * 0.05 * 100) / 100),
        String(tx.netAmount || tx.amount),
        tx.payoutReference || '—',
        String(tx.balanceAfter),
        tx.status,
      ]);

      const csv = [header, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `seller-payout-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-cream-200">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
            Accounting Ledger
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Atelier Transaction Ledger (CR / DR)
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Product-wise settlement passbook with 5% platform fee accounting
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            leftIcon={<Download className="w-4 h-4" />}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {/* ── Metric Summary Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-cream-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Gross Sales</span>
            <Wallet className="w-4 h-4 text-stone-400" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-stone-900">
            {formatINR(summaryMetrics.totalGrossSales)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">Total customer invoice volume</span>
        </div>

        <div className="bg-white rounded-2xl border border-cream-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Platform Fee (5%)</span>
            <Percent className="w-4 h-4 text-amber-500" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-amber-700">
            {formatINR(summaryMetrics.totalCommission)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">Retained marketplace commission</span>
        </div>

        <div className="bg-white rounded-2xl border border-cream-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Net Payouts Wired</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-emerald-700">
            {formatINR(summaryMetrics.totalNetReceived)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">95% net transferred to bank</span>
        </div>

        <div className="bg-white rounded-2xl border border-cream-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Current Escrow Balance</span>
            <Receipt className="w-4 h-4 text-burgundy" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-stone-900">
            {formatINR(summaryMetrics.latestBalance)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">Pending wire disbursement</span>
        </div>
      </div>

      {/* ── Filters Bar ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-cream-200 p-3 sm:p-4 shadow-soft space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search by Order ID, Transaction Number, SKU, Product Name */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Search Order, Txn, SKU, Product..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-cream-300 focus:outline-none focus:ring-2 focus:ring-burgundy/20 bg-cream-50/50"
            />
          </div>

          {/* Type Filter (CR / DR) */}
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            options={[
              { value: 'ALL', label: 'All Operations (CR & DR)' },
              { value: 'CR', label: 'Credits (Sales Proceeds)' },
              { value: 'DR', label: 'Debits (Bank Payouts)' },
            ]}
          />

          {/* Status Filter */}
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            options={[
              { value: 'ALL', label: 'All Statuses' },
              { value: 'POSTED', label: 'Posted / Reconciled' },
              { value: 'PENDING', label: 'Pending Processing' },
            ]}
          />

          {/* Date Range Filter */}
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

        {(searchQuery || typeFilter !== 'ALL' || statusFilter !== 'ALL' || dateFilter !== 'ALL') && (
          <div className="flex items-center justify-between pt-2 border-t border-cream-100 text-xs text-stone-500">
            <span>
              Showing {filteredTransactions.length} of {transactions.length} transactions
            </span>
            <button
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1 text-burgundy hover:underline font-medium"
            >
              <RotateCcw className="w-3 h-3" /> Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* ── Main Content: Table & Mobile Cards ────────────────────────────── */}
      {error ? (
        <ErrorState message={error} onRetry={loadTransactions} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Auditing transaction ledger...</div>
      ) : (
        <>
          {/* ── MOBILE: stacked cards (visible below md) ─────────────────────── */}
          <div className="md:hidden space-y-3">
            {filteredTransactions.length === 0 && (
              <div className="py-12 text-center text-xs text-stone-500 bg-white rounded-2xl border border-cream-200">
                No transactions found matching your criteria.
              </div>
            )}

            {filteredTransactions.map((tx) => {
              const isCredit = tx.type === 'CR';
              const grossVal = tx.grossAmount || tx.amount;
              const commVal = tx.commissionAmount || Math.round(grossVal * 0.05 * 100) / 100;
              const netVal = tx.netAmount || (grossVal - commVal);
              const productNameDisplay = tx.productName || (tx.category === 'SETTLEMENT_PAYOUT' ? 'Settlement Payout' : 'Catalogue Item');
              const skuDisplay = tx.productSku || (tx.productId ? `ID: ${tx.productId.slice(0, 8)}` : '—');

              return (
                <div
                  key={tx.id}
                  className="bg-white rounded-2xl border border-cream-200 shadow-soft p-4 space-y-3"
                >
                  {/* Transaction ID & Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase font-semibold text-stone-400 block tracking-wider">
                        Transaction ID
                      </span>
                      <p className="font-mono text-xs font-semibold text-stone-900 break-all">
                        {tx.transactionNumber}
                      </p>
                      <p className="text-[11px] text-stone-500 mt-0.5">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 whitespace-nowrap">
                      <CheckCircle2 className="w-3 h-3" /> {tx.status}
                    </span>
                  </div>

                  {/* Order ID & Product Details */}
                  <div className="bg-cream-50/60 rounded-xl p-2.5 text-xs space-y-1.5 border border-cream-200">
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">Order ID</span>
                      <span className="font-mono font-semibold text-stone-900">{tx.orderNumber || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">Product</span>
                      <span className="font-sans font-semibold text-stone-800 break-words text-right max-w-[200px]">
                        {productNameDisplay}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-stone-400">SKU / Code</span>
                      <span className="font-mono text-stone-600">{skuDisplay}</span>
                    </div>
                    {tx.payoutReference && (
                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-cream-200">
                        <span className="text-stone-400">Payout Ref</span>
                        <span className="font-mono font-bold text-burgundy">{tx.payoutReference}</span>
                      </div>
                    )}
                  </div>

                  {/* 4-Stat Financial Breakdown Grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-cream-50/80 rounded-xl p-2 border border-cream-200 text-center">
                      <span className="block text-[10px] text-stone-500 font-semibold uppercase">Gross Amount</span>
                      <span className="font-mono font-bold text-stone-900 mt-0.5 block">
                        {formatINR(grossVal)}
                      </span>
                    </div>
                    <div className="bg-amber-50/60 rounded-xl p-2 border border-amber-200 text-center">
                      <span className="block text-[10px] text-amber-700 font-semibold uppercase">Comm. (5%)</span>
                      <span className="font-mono font-bold text-amber-800 mt-0.5 block">
                        -{formatINR(commVal)}
                      </span>
                    </div>
                    <div
                      className={`rounded-xl p-2 text-center border ${
                        isCredit ? 'bg-emerald-50/70 border-emerald-200' : 'bg-rosered-50/70 border-rosered-200'
                      }`}
                    >
                      <span
                        className={`block text-[10px] font-semibold uppercase ${
                          isCredit ? 'text-emerald-700' : 'text-rosered-600'
                        }`}
                      >
                        {isCredit ? 'Net Credit (CR)' : 'Payout Debit (DR)'}
                      </span>
                      <span
                        className={`font-mono font-bold mt-0.5 block ${
                          isCredit ? 'text-emerald-700' : 'text-rosered-600'
                        }`}
                      >
                        {isCredit ? `+${formatINR(netVal)}` : `-${formatINR(tx.amount)}`}
                      </span>
                    </div>
                    <div className="bg-cream-50/80 rounded-xl p-2 border border-cream-200 text-center">
                      <span className="block text-[10px] text-stone-500 font-semibold uppercase">Ledger Balance</span>
                      <span className="font-mono font-bold text-stone-900 mt-0.5 block">
                        {formatINR(tx.balanceAfter)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── DESKTOP / TABLET: Product-Wise Payout Table (visible md up) ──── */}
          <div className="hidden md:block bg-white rounded-3xl border border-cream-200 shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-ivory border-b border-cream-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                    <th className="py-4 px-4 whitespace-nowrap">1. Transaction ID</th>
                    <th className="py-4 px-3 whitespace-nowrap">2. Date</th>
                    <th className="py-4 px-3 whitespace-nowrap">3. Order ID</th>
                    <th className="py-4 px-3 whitespace-nowrap">4. Product ID / SKU</th>
                    <th className="py-4 px-4 whitespace-nowrap">5. Product Name</th>
                    <th className="py-4 px-3 text-right whitespace-nowrap">6. Gross Amount</th>
                    <th className="py-4 px-2 text-center whitespace-nowrap">7. Rate</th>
                    <th className="py-4 px-3 text-right text-amber-700 whitespace-nowrap">8. Comm. (5%)</th>
                    <th className="py-4 px-3 text-right text-emerald-700 whitespace-nowrap">9. Net Received</th>
                    <th className="py-4 px-3 whitespace-nowrap">10. Payout Ref</th>
                    <th className="py-4 px-3 text-right whitespace-nowrap">11. Balance</th>
                    <th className="py-4 px-4 text-center whitespace-nowrap">12. Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-100 font-mono">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-xs text-stone-500 font-sans">
                        No transactions found matching your criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx) => {
                      const isCredit = tx.type === 'CR';
                      const grossVal = tx.grossAmount || tx.amount;
                      const commVal = tx.commissionAmount || Math.round(grossVal * 0.05 * 100) / 100;
                      const netVal = tx.netAmount || (grossVal - commVal);
                      const productNameDisplay = tx.productName || (tx.category === 'SETTLEMENT_PAYOUT' ? 'Settlement Payout' : 'Catalogue Item');
                      const skuDisplay = tx.productSku || (tx.productId ? tx.productId.slice(0, 8) : '—');

                      return (
                        <tr key={tx.id} className="hover:bg-cream-50/40 transition-colors">
                          {/* 1. Transaction ID */}
                          <td className="py-4 px-4 font-semibold text-stone-900 whitespace-nowrap">
                            {tx.transactionNumber}
                          </td>

                          {/* 2. Date */}
                          <td className="py-4 px-3 text-stone-500 font-sans text-[11px] whitespace-nowrap">
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </td>

                          {/* 3. Order ID */}
                          <td className="py-4 px-3 text-stone-700 whitespace-nowrap">
                            {tx.orderNumber || '—'}
                          </td>

                          {/* 4. Product ID / SKU */}
                          <td className="py-4 px-3 text-stone-600 text-[11px] whitespace-nowrap">
                            {skuDisplay}
                          </td>

                          {/* 5. Product Name */}
                          <td className="py-4 px-4 font-sans text-stone-800 font-medium max-w-[200px] truncate" title={productNameDisplay}>
                            {productNameDisplay}
                          </td>

                          {/* 6. Gross Amount */}
                          <td className="py-4 px-3 text-right font-bold text-stone-900 whitespace-nowrap">
                            {formatINR(grossVal)}
                          </td>

                          {/* 7. Commission Rate */}
                          <td className="py-4 px-2 text-center text-stone-500 font-sans text-[11px] whitespace-nowrap">
                            {tx.commissionRate || 5}%
                          </td>

                          {/* 8. Commission Amount */}
                          <td className="py-4 px-3 text-right font-semibold text-amber-700 whitespace-nowrap">
                            -{formatINR(commVal)}
                          </td>

                          {/* 9. Net Seller Received */}
                          <td className="py-4 px-3 text-right font-bold whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md ${
                                isCredit
                                  ? 'text-emerald-700 bg-emerald-50'
                                  : 'text-rosered-600 bg-rosered-50'
                              }`}
                            >
                              {isCredit ? `+${formatINR(netVal)}` : `-${formatINR(tx.amount)}`}
                            </span>
                          </td>

                          {/* 10. Payout Reference */}
                          <td className="py-4 px-3 text-stone-600 text-[11px] whitespace-nowrap">
                            {tx.payoutReference ? (
                              <span className="font-semibold text-burgundy bg-burgundy/5 px-2 py-0.5 rounded-full border border-burgundy/10">
                                {tx.payoutReference}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>

                          {/* 11. Ledger Balance */}
                          <td className="py-4 px-3 text-right font-bold text-stone-900 whitespace-nowrap">
                            {formatINR(tx.balanceAfter)}
                          </td>

                          {/* 12. Status */}
                          <td className="py-4 px-4 text-center font-sans whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" /> {tx.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
