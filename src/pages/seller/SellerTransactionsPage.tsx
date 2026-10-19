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
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto">
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
        <div className="w-full sm:w-48">
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
        <>
          {/* ── MOBILE: stacked cards (visible below md) ─────────────────────── */}
          <div className="md:hidden space-y-3">
            {transactions.length === 0 && (
              <div className="py-12 text-center text-xs text-stone-500 bg-white rounded-2xl border border-cream-200">
                No transactions found.
              </div>
            )}

            {transactions.map((tx) => {
              const isCredit = tx.type === 'CR';
              const itemDisplay =
                tx.productReference ||
                tx.productName ||
                (tx.productSku ? `SKU: ${tx.productSku}` : '') ||
                (tx.productId ? `Product (${tx.productId.slice(0, 8)})` : (tx.category === 'SETTLEMENT_PAYOUT' ? 'Settlement Payout' : 'Store Product'));

              return (
                <div
                  key={tx.id}
                  className="bg-white rounded-2xl border border-cream-200 shadow-soft p-4 space-y-3"
                >
                  {/* Reference ID + status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase font-semibold text-stone-400 block tracking-wider">
                        Reference ID
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

                  {/* Description */}
                  <p className="text-xs text-stone-800 break-words font-medium">{tx.description}</p>

                  {/* Product / Item Reference */}
                  <div className="flex items-center justify-between text-xs py-1.5 border-t border-cream-100">
                    <span className="text-stone-500">Product / Item</span>
                    <span className="font-sans font-semibold text-stone-800 break-all text-right">
                      {itemDisplay}
                    </span>
                  </div>

                  {/* Amount + balance side by side */}
                  <div className="grid grid-cols-2 gap-2">
                    <div
                      className={`rounded-xl border p-2.5 text-center ${
                        isCredit
                          ? 'bg-emerald-50/60 border-emerald-200'
                          : 'bg-rosered-50/60 border-rosered-200'
                      }`}
                    >
                      <span
                        className={`block text-[10px] uppercase tracking-wider font-semibold ${
                          isCredit ? 'text-emerald-700' : 'text-rosered-600'
                        }`}
                      >
                        {isCredit ? 'Credit (CR)' : 'Debit (DR)'}
                      </span>
                      <span
                        className={`block mt-1 font-mono font-bold text-sm ${
                          isCredit ? 'text-emerald-700' : 'text-rosered-600'
                        }`}
                      >
                        {isCredit ? `+${formatINR(tx.amount)}` : `-${formatINR(tx.amount)}`}
                      </span>
                    </div>
                    <div className="rounded-xl bg-cream-50/80 border border-cream-200 p-2.5 text-center">
                      <span className="block text-[10px] uppercase tracking-wider text-stone-500 font-semibold">
                        Ledger Balance
                      </span>
                      <span className="block mt-1 font-mono font-bold text-sm text-stone-900">
                        {formatINR(tx.balanceAfter)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── DESKTOP / TABLET: table (visible from md up) ─────────────────── */}
          <div className="hidden md:block bg-white rounded-3xl border border-cream-200 shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-ivory border-b border-cream-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                    <th className="py-4 px-6">Reference ID</th>
                    <th className="py-4 px-4">Date</th>
                    <th className="py-4 px-4">Description</th>
                    <th className="py-4 px-4">Product / Item Reference</th>
                    <th className="py-4 px-4 text-emerald-700">Credit (CR)</th>
                    <th className="py-4 px-4 text-rosered-600">Debit (DR)</th>
                    <th className="py-4 px-4">Ledger Balance</th>
                    <th className="py-4 px-6 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-100 font-mono">
                  {transactions.map((tx) => {
                    const isCredit = tx.type === 'CR';
                    const itemDisplay =
                      tx.productReference ||
                      tx.productName ||
                      (tx.productSku ? `SKU: ${tx.productSku}` : '') ||
                      (tx.productId ? `Product (${tx.productId.slice(0, 8)})` : (tx.category === 'SETTLEMENT_PAYOUT' ? 'Settlement Payout' : 'Store Product'));

                    return (
                      <tr key={tx.id} className="hover:bg-cream-50/40 transition-colors">
                        <td className="py-4 px-6 font-semibold text-stone-900">{tx.transactionNumber}</td>
                        <td className="py-4 px-4 text-stone-500 font-sans text-[11px]">
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-4 px-4 font-sans text-stone-800 text-xs font-medium">{tx.description}</td>
                        <td className="py-4 px-4 font-sans text-stone-700 font-medium">
                          {itemDisplay}
                        </td>
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
        </>
      )}
    </div>
  );
};
