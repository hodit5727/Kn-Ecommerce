import React, { useState, useEffect } from 'react';
import { transactionService } from '../../services/transactionService';
import type { FinancialTransaction } from '../../types/transaction';
import { ErrorState } from '../../components/common/ErrorState';
import { Select } from '../../components/common/Select';
import { formatINR } from '../../lib/currency';
import { CheckCircle2, Download } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { useToast } from '../../context/ToastContext';

export const AdminTransactionsPage: React.FC = () => {
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CR' | 'DR'>('ALL');
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

  /** Real CSV export of the already-loaded (server-authorized) ledger rows.
   *  No backend mutation involved — this only downloads what is on screen. */
  const handleExportCSV = () => {
    if (transactions.length === 0) {
      showToast('There are no transactions to export.', 'error');
      return;
    }

    try {
      const header = [
        'Tx Number',
        'Date',
        'Seller',
        'Order',
        'Category',
        'Type',
        'Amount',
        'Balance After',
        'Status',
      ];
      const rows = transactions.map((tx) => [
        tx.transactionNumber,
        tx.createdAt,
        tx.sellerName ?? '',
        tx.orderNumber ?? '',
        tx.category,
        tx.type,
        String(tx.amount),
        String(tx.balanceAfter),
        tx.status,
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
        .join('\r\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      showToast(`Exported ${transactions.length} transaction${transactions.length === 1 ? '' : 's'} to CSV.`);
    } catch (err: any) {
      showToast(err.message || 'Failed to export transactions.', 'error');
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-stone-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
            Central Treasury
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Platform Financial Transaction Ledger
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-44">
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              options={[
                { value: 'ALL', label: 'All Operations (CR/DR)' },
                { value: 'CR', label: 'Credits (CR)' },
                { value: 'DR', label: 'Debits (DR)' },
              ]}
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCSV} leftIcon={<Download className="w-4 h-4" />}>
            Export CSV
          </Button>
        </div>
      </div>

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
                  <th className="py-4 px-6">Tx Number</th>
                  <th className="py-4 px-4">Timestamp</th>
                  <th className="py-4 px-4">Atelier / Entity</th>
                  <th className="py-4 px-4">Requisition</th>
                  <th className="py-4 px-4">Category</th>
                  <th className="py-4 px-4 text-emerald-700">Credit (CR)</th>
                  <th className="py-4 px-4 text-rosered-600">Debit (DR)</th>
                  <th className="py-4 px-4">Balance</th>
                  <th className="py-4 px-6 text-right">Reconciliation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-stone-50/50">
                    <td className="py-4 px-6 font-bold text-stone-900">{tx.transactionNumber}</td>
                    <td className="py-4 px-4 text-stone-500 font-sans text-[11px]">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-4 font-sans font-medium text-stone-800">
                      {tx.sellerName || 'Central Platform Escrow'}
                    </td>
                    <td className="py-4 px-4 text-stone-600">{tx.orderNumber || '—'}</td>
                    <td className="py-4 px-4 font-sans text-[11px] text-stone-600">{tx.category}</td>
                    <td className="py-4 px-4 font-bold text-emerald-700">
                      {tx.type === 'CR' ? `+${formatINR(tx.amount)}` : '—'}
                    </td>
                    <td className="py-4 px-4 font-bold text-rosered-600">
                      {tx.type === 'DR' ? `-${formatINR(tx.amount)}` : '—'}
                    </td>
                    <td className="py-4 px-4 font-bold text-stone-900">{formatINR(tx.balanceAfter)}</td>
                    <td className="py-4 px-6 text-right font-sans">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" /> Reconciled
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
