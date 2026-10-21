import React, { useState, useEffect, useMemo } from 'react';
import { transactionService } from '../../services/transactionService';
import type { FinancialTransaction } from '../../types/transaction';
import { ErrorState } from '../../components/common/ErrorState';
import { Select } from '../../components/common/Select';
import { formatINR } from '../../lib/currency';
import { CheckCircle2, Download, Search, RotateCcw, Wallet, ArrowDownLeft, Percent, Landmark } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { useToast } from '../../context/ToastContext';

export const AdminTransactionsPage: React.FC = () => {
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CR' | 'DR'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');

  const { showToast } = useToast();

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await transactionService.getTransactions({
        type: typeFilter !== 'ALL' ? typeFilter : undefined,
      });
      setTransactions(list);
    } catch (err: any) {
      setError(err.message || 'Unable to load platform-wide financial transaction ledger.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [typeFilter]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
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
        const matchRef = tx.payoutReference?.toLowerCase().includes(q);
        const matchCat = tx.category?.toLowerCase().includes(q);

        if (!matchTx && !matchOrder && !matchSeller && !matchDesc && !matchRef && !matchCat) {
          return false;
        }
      }

      return true;
    });
  }, [transactions, dateFilter, searchQuery]);

  const summary = useMemo(() => {
    const totalCollected = transactions
      .filter((t) => t.type === 'CR')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalDisbursed = transactions
      .filter((t) => t.type === 'DR')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const retainedProfits = Math.max(0, Math.round((totalCollected - totalDisbursed) * 100) / 100);
    const currentTreasury = transactions.length > 0 ? transactions[0].balanceAfter : 0;

    return { totalCollected, totalDisbursed, retainedProfits, currentTreasury };
  }, [transactions]);

  /** Real CSV export of the loaded ledger rows. */
  const handleExportCSV = () => {
    if (filteredTransactions.length === 0) {
      showToast('There are no transactions to export.', 'error');
      return;
    }

    try {
      const header = [
        'Tx Number',
        'Date',
        'Seller',
        'Order Number',
        'Category',
        'Type',
        'Amount',
        'Payout Reference',
        'Treasury Balance',
        'Status',
      ];
      const rows = filteredTransactions.map((tx) => [
        tx.transactionNumber,
        new Date(tx.createdAt).toLocaleDateString(),
        tx.sellerName ?? '',
        tx.orderNumber ?? '',
        tx.category,
        tx.type,
        String(tx.amount),
        tx.payoutReference ?? '—',
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
            Central Treasury
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Platform Financial Transaction Ledger
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Reconciled double-entry ledger tracking cash collections, seller wire payouts, and retained commission
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleExportCSV} leftIcon={<Download className="w-4 h-4" />}>
            Export CSV
          </Button>
        </div>
      </div>

      {/* ── Treasury Summary Metric Cards ───────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">COD Collected</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-stone-900">
            {formatINR(summary.totalCollected)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">Total customer cash collected</span>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Seller Payouts</span>
            <ArrowDownLeft className="w-4 h-4 text-rosered-600" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-rosered-600">
            {formatINR(summary.totalDisbursed)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">95% net settlement wires paid</span>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Retained Commission</span>
            <Percent className="w-4 h-4 text-amber-500" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-amber-700">
            {formatINR(summary.retainedProfits)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">5% platform fee profit (1000 - 950 = 50)</span>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-soft">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Treasury Balance</span>
            <Landmark className="w-4 h-4 text-stone-600" />
          </div>
          <p className="font-serif text-xl sm:text-2xl font-bold text-stone-900">
            {formatINR(summary.currentTreasury)}
          </p>
          <span className="text-[10px] text-stone-400 block mt-1">Audited cash balance in treasury</span>
        </div>
      </div>

      {/* ── Filters Bar ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-stone-200 p-3 sm:p-4 shadow-soft space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Search Requisition, Txn, Seller, Ref..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-500/20 bg-stone-50/50"
            />
          </div>

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

        {(searchQuery || typeFilter !== 'ALL' || dateFilter !== 'ALL') && (
          <div className="flex items-center justify-between pt-2 border-t border-stone-100 text-xs text-stone-500">
            <span>Showing {filteredTransactions.length} of {transactions.length} operations</span>
            <button
              onClick={() => {
                setSearchQuery('');
                setTypeFilter('ALL');
                setDateFilter('ALL');
              }}
              className="inline-flex items-center gap-1 text-amber-700 hover:underline font-medium"
            >
              <RotateCcw className="w-3 h-3" /> Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Accessing fiscal ledger...</div>
      ) : (
        <div className="bg-white rounded-3xl border border-stone-200 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px] font-sans">
                  <th className="py-4 px-6 whitespace-nowrap">Tx Number</th>
                  <th className="py-4 px-4 whitespace-nowrap">Timestamp</th>
                  <th className="py-4 px-4 whitespace-nowrap">Atelier / Entity</th>
                  <th className="py-4 px-4 whitespace-nowrap">Requisition</th>
                  <th className="py-4 px-4 whitespace-nowrap">Category</th>
                  <th className="py-4 px-4 text-emerald-700 whitespace-nowrap">Credit (CR)</th>
                  <th className="py-4 px-4 text-rosered-600 whitespace-nowrap">Debit (DR)</th>
                  <th className="py-4 px-4 whitespace-nowrap">Payout Ref</th>
                  <th className="py-4 px-4 whitespace-nowrap">Treasury Balance</th>
                  <th className="py-4 px-6 text-right whitespace-nowrap">Reconciliation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-xs text-stone-500 font-sans">
                      No transactions found matching your criteria.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-stone-50/50">
                      <td className="py-4 px-6 font-bold text-stone-900 whitespace-nowrap">{tx.transactionNumber}</td>
                      <td className="py-4 px-4 text-stone-500 font-sans text-[11px] whitespace-nowrap">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-4 px-4 font-sans font-medium text-stone-800 whitespace-nowrap">
                        {tx.sellerName || 'Central Platform Escrow'}
                      </td>
                      <td className="py-4 px-4 text-stone-600 whitespace-nowrap">{tx.orderNumber || '—'}</td>
                      <td className="py-4 px-4 font-sans text-[11px] text-stone-600 whitespace-nowrap">{tx.category}</td>
                      <td className="py-4 px-4 font-bold text-emerald-700 whitespace-nowrap">
                        {tx.type === 'CR' ? `+${formatINR(tx.amount)}` : '—'}
                      </td>
                      <td className="py-4 px-4 font-bold text-rosered-600 whitespace-nowrap">
                        {tx.type === 'DR' ? `-${formatINR(tx.amount)}` : '—'}
                      </td>
                      <td className="py-4 px-4 text-stone-600 text-[11px] whitespace-nowrap">
                        {tx.payoutReference ? (
                          <span className="font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                            {tx.payoutReference}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-4 px-4 font-bold text-stone-900 whitespace-nowrap">{formatINR(tx.balanceAfter)}</td>
                      <td className="py-4 px-6 text-right font-sans whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> Reconciled
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
