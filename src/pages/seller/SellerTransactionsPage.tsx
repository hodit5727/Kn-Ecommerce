import React, { useState, useEffect } from 'react';
import { transactionService } from '../../services/transactionService';
import { FinancialTransaction } from '../../types/transaction';
import { ErrorState } from '../../components/common/ErrorState';
import { Select } from '../../components/common/Select';
import { formatINR } from '../../lib/currency';
import {
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
  Filter,
  CheckCircle2,
  FileSpreadsheet
} from 'lucide-react';

export const SellerTransactionsPage: React.FC = () => {
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CR' | 'DR'>('ALL');

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

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-cream-200">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
            Accounting Ledger
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Atelier Transaction Ledger (CR / DR)
          </h1>
        </div>

        {/* Filter */}
        <div className="w-48">
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            options={[
              { value: 'ALL', label: 'All Entries (CR & DR)' },
              { value: 'CR', label: 'Credits Only (CR)' },
              { value: 'DR', label: 'Debits Only (DR)' },
            ]}
          />
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadTransactions} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Auditing transaction ledger...</div>
      ) : (
        <div className="bg-white rounded-3xl border border-cream-200 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-ivory border-b border-cream-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-4 px-6">Transaction ID</th>
                  <th className="py-4 px-4">Date</th>
                  <th className="py-4 px-4">Description</th>
                  <th className="py-4 px-4">Requisition</th>
                  <th className="py-4 px-4 text-emerald-700">Credit (CR)</th>
                  <th className="py-4 px-4 text-rosered-600">Debit (DR)</th>
                  <th className="py-4 px-4">Ledger Balance</th>
                  <th className="py-4 px-6 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-100 font-mono">
                {transactions.map((tx) => {
                  const isCredit = tx.type === 'CR';
                  return (
                    <tr key={tx.id} className="hover:bg-cream-50/40 transition-colors">
                      <td className="py-4 px-6 font-semibold text-stone-900">{tx.transactionNumber}</td>
                      <td className="py-4 px-4 text-stone-500 font-sans text-[11px]">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-4 px-4 font-sans text-stone-800 text-xs">{tx.description}</td>
                      <td className="py-4 px-4 text-stone-600">{tx.orderNumber || '—'}</td>
                      <td className="py-4 px-4 font-bold text-emerald-700">
                        {isCredit ? `+${formatINR(tx.amount)}` : '—'}
                      </td>
                      <td className="py-4 px-4 font-bold text-rosered-600">
                        {!isCredit ? `-${formatINR(tx.amount)}` : '—'}
                      </td>
                      <td className="py-4 px-4 font-bold text-stone-900">
                        {formatINR(tx.balanceAfter)}
                      </td>
                      <td className="py-4 px-6 text-right font-sans">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> {tx.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
