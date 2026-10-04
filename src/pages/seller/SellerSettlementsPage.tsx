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
      showToast(`Payout request for ${formatINR(available)} submitted to treasury.`);
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
            Treasury & Escrow
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Settlement Disbursements
          </h1>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={handleRequestPayout}
          isLoading={isRequesting}
          leftIcon={<ArrowUpRight className="w-4 h-4" />}
        >
          Request Accelerated Wire Transfer
        </Button>
      </div>

      {/* Summary KPI Cards — rendered only with real loaded data, never as
          fake ₹0 stats while the load is pending or has failed. */}
      {!error && !isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-1">
            <span className="text-xs text-stone-500 font-medium">Pending Reconciliation</span>
            <p className="text-2xl font-serif font-bold text-amber-600">
              {formatINR(pending.reduce((sum, s) => sum + s.netSettlementAmount, 0))}
            </p>
            <span className="text-[11px] text-stone-400">{pending.length} batch in queue</span>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-1">
            <span className="text-xs text-stone-500 font-medium">Disbursed to Bank</span>
            <p className="text-2xl font-serif font-bold text-emerald-700">
              {formatINR(completed.reduce((sum, s) => sum + s.netSettlementAmount, 0))}
            </p>
            <span className="text-[11px] text-stone-400">Total transferred via Swift/SEPA</span>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-cream-200 shadow-soft space-y-1">
            <span className="text-xs text-stone-500 font-medium">Next Scheduled Cycle</span>
            <p className="text-2xl font-serif font-bold text-stone-900">1st of Month</p>
            <span className="text-[11px] text-stone-400">Automated bi-weekly dispatch</span>
          </div>
        </div>
      )}

      {error ? (
        <ErrorState message={error} onRetry={loadSettlements} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Retrieving settlement records...</div>
      ) : (
        <div className="bg-white rounded-3xl border border-cream-200 shadow-soft overflow-hidden">
          <div className="p-6 border-b border-cream-200">
            <h3 className="font-serif font-bold text-base text-stone-900">
              Settlement Batch History
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-ivory border-b border-cream-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-4 px-6">Settlement ID</th>
                  <th className="py-4 px-4">Period</th>
                  <th className="py-4 px-4">Gross Collected</th>
                  <th className="py-4 px-4">Platform Fee (5%)</th>
                  <th className="py-4 px-4 font-bold text-burgundy">Net Wire Amount</th>
                  <th className="py-4 px-4">Banking Reference</th>
                  <th className="py-4 px-6 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-100">
                {settlements.map((stl) => (
                  <tr key={stl.id} className="hover:bg-cream-50/50">
                    <td className="py-4 px-6 font-mono font-semibold text-stone-900">
                      {stl.settlementNumber}
                    </td>
                    <td className="py-4 px-4 text-stone-600">
                      {stl.periodStart} to {stl.periodEnd}
                    </td>
                    <td className="py-4 px-4 font-semibold text-stone-900">
                      {formatINR(stl.grossAmount)}
                    </td>
                    <td className="py-4 px-4 text-stone-500">
                      {formatINR(stl.platformFee)}
                    </td>
                    <td className="py-4 px-4 font-bold text-burgundy text-sm">
                      {formatINR(stl.netSettlementAmount)}
                    </td>
                    <td className="py-4 px-4 font-mono text-stone-500 text-[11px]">
                      {stl.bankReference || 'Pending Batching'}
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
      )}
    </div>
  );
};
