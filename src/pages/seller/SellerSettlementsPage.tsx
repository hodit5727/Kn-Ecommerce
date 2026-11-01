import React, { useState, useEffect } from 'react';
import { sellerService, settlementService } from '../../services/sellerService';
import type { SettlementRecord, SellerMetrics } from '../../types/seller';
import { useToast } from '../../context/ToastContext';
import { ErrorState } from '../../components/common/ErrorState';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { ArrowUpRight } from 'lucide-react';
import { formatINR } from '../../lib/currency';

export const SellerSettlementsPage: React.FC = () => {
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [metrics, setMetrics] = useState<SellerMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState<boolean>(false);
  const { showToast } = useToast();

  const loadSettlements = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [data, m] = await Promise.all([
        settlementService.getSettlements(),
        sellerService.getMetrics(),
      ]);
      setSettlements(data);
      setMetrics(m);
    } catch (err: any) {
      setError(err.message || 'Unable to load seller settlements.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettlements();
  }, []);

  const handleRequestPayout = async () => {
    // Payout amount comes from the server-computed available balance —
    // never a hardcoded client-side number. The backend re-validates it.
    if (!metrics) {
      showToast('Settlement metrics are unavailable. Please reload and try again.', 'error');
      return;
    }
    const available = metrics.availableSettlement;
    if (available <= 0) {
      showToast('No available settlement balance to request a payout for.', 'error');
      return;
    }

    setIsRequesting(true);
    try {
      await settlementService.requestSettlementPayout(available);
      showToast(`Cash settlement request for ${formatINR(available)} submitted.`);
      loadSettlements();
    } catch (err: any) {
      showToast(err.message || 'Payout request failed.', 'error');
    } finally {
      setIsRequesting(false);
    }
  };

  const pending = settlements.filter((s) => s.status === 'PENDING' || s.status === 'PROCESSING');
  const completed = settlements.filter((s) => s.status === 'COMPLETED');

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-cream-200">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
            Cash Settlements
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Direct Cash Settlement Handover
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            100% Cash on Delivery platform — cash collected from customer, 5% fee retained, and balance settled directly to you in cash.
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={handleRequestPayout}
          isLoading={isRequesting}
          leftIcon={<ArrowUpRight className="w-4 h-4" />}
        >
          Request Cash Settlement
        </Button>
      </div>

      {/* Summary KPI Cards — rendered only with real loaded data */}
      {!error && !isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-1">
            <span className="text-xs text-stone-500 font-medium">Pending Settlement</span>
            <p className="text-2xl font-serif font-bold text-amber-600">
              {formatINR(pending.reduce((sum, s) => sum + s.netSettlementAmount, 0))}
            </p>
            <span className="text-[11px] text-stone-400">{pending.length} batch awaiting handover</span>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-1">
            <span className="text-xs text-stone-500 font-medium">Settled In Hand</span>
            <p className="text-2xl font-serif font-bold text-emerald-600">
              {formatINR(completed.reduce((sum, s) => sum + s.netSettlementAmount, 0))}
            </p>
            <span className="text-[11px] text-stone-400">{completed.length} batches handed</span>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-1">
            <span className="text-xs text-stone-500 font-medium">Available for Handover</span>
            <p className="text-2xl font-serif font-bold text-burgundy">
              {formatINR(metrics?.availableSettlement || 0)}
            </p>
            <span className="text-[11px] text-stone-400">Current eligible balance</span>
          </div>
        </div>
      )}

      {error ? (
        <ErrorState message={error} onRetry={loadSettlements} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Loading cash settlements...</div>
      ) : settlements.length === 0 ? (
        <div className="bg-white rounded-3xl border border-cream-200 p-12 text-center text-stone-500 text-xs">
          No cash settlement records found. Orders delivered to customers will appear here.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Mobile Stacked Cards (Visible on screens < md) */}
          <div className="md:hidden space-y-3">
            {settlements.map((stl) => (
              <div
                key={stl.id}
                className="bg-white rounded-2xl border border-cream-200/90 shadow-soft p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-stone-400 block tracking-wider">
                      Settlement ID
                    </span>
                    <p className="font-mono text-sm font-bold text-stone-900">{stl.settlementNumber}</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">
                      {stl.periodStart} to {stl.periodEnd}
                    </p>
                  </div>
                  <Badge
                    variant={stl.status === 'COMPLETED' ? 'emerald' : 'amber'}
                    size="sm"
                    dot
                  >
                    {stl.status}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-cream-50/70 rounded-xl p-2.5 border border-cream-200/80 text-center text-xs font-mono">
                  <div>
                    <span className="text-[10px] font-sans text-stone-400 block">Gross</span>
                    <span className="font-semibold text-stone-800">{formatINR(stl.grossAmount)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-amber-700 block">Fee (5%)</span>
                    <span className="font-semibold text-amber-800">-{formatINR(stl.platformFee)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-burgundy block font-bold">Net In Hand</span>
                    <span className="font-bold text-burgundy">{formatINR(stl.netSettlementAmount)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-stone-500 pt-1 border-t border-cream-100">
                  <span>Method:</span>
                  <span className="font-medium text-stone-800">
                    Direct Cash Handover
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Luxury Table (Visible on screens >= md) */}
          <div className="hidden md:block bg-white rounded-3xl border border-cream-200/90 shadow-soft overflow-hidden">
            <div className="p-6 border-b border-cream-200">
              <h3 className="font-serif font-bold text-base text-stone-900">
                Cash Settlement Batch History
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-stone-50/80 border-b border-cream-200/80 text-stone-500 uppercase tracking-widest font-bold text-[10px]">
                    <th className="py-4 px-6">Settlement ID</th>
                    <th className="py-4 px-4">Period</th>
                    <th className="py-4 px-4">Gross Collected</th>
                    <th className="py-4 px-4">Platform Fee (5%)</th>
                    <th className="py-4 px-4 font-bold text-burgundy">Net Cash Payout</th>
                    <th className="py-4 px-4">Disbursal Method</th>
                    <th className="py-4 px-6 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-100">
                  {settlements.map((stl) => (
                    <tr key={stl.id} className="hover:bg-cream-50/50 transition-colors">
                      <td className="py-4 px-6 font-mono font-semibold text-stone-900">
                        {stl.settlementNumber}
                      </td>
                      <td className="py-4 px-4 text-stone-600">
                        {stl.periodStart} to {stl.periodEnd}
                      </td>
                      <td className="py-4 px-4 font-semibold text-stone-900 font-mono">
                        {formatINR(stl.grossAmount)}
                      </td>
                      <td className="py-4 px-4 text-stone-500 font-mono">
                        {formatINR(stl.platformFee)}
                      </td>
                      <td className="py-4 px-4 font-bold text-burgundy text-sm font-mono">
                        {formatINR(stl.netSettlementAmount)}
                      </td>
                      <td className="py-4 px-4 font-sans text-stone-600 text-[11px]">
                        Direct Cash Handover
                      </td>
                      <td className="py-4 px-6 text-right">
                        <Badge
                          variant={stl.status === 'COMPLETED' ? 'emerald' : 'amber'}
                          size="sm"
                          dot
                        >
                          {stl.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
