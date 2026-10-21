import React, { useState, useEffect } from 'react';
import { settlementService } from '../../services/sellerService';
import type { SettlementRecord } from '../../types/seller';
import { ErrorState } from '../../components/common/ErrorState';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { useToast } from '../../context/ToastContext';
import { apiRequest } from '../../api/http';
import { formatINR } from '../../lib/currency';
import { Send, CheckCircle2, ShieldCheck, ArrowRight, RefreshCw, Download } from 'lucide-react';
import { exportToCsv } from '../../lib/csvExport';

export const AdminSettlementsPage: React.FC = () => {
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const loadSettlements = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ settlements: SettlementRecord[] }>('/admin/settlements', { method: 'GET' });
      setSettlements(res.settlements || []);
    } catch (err: any) {
      try {
        const list = await settlementService.getSettlements();
        setSettlements(list);
      } catch (fallbackErr: any) {
        setError(err.message || fallbackErr.message || 'Failed to retrieve settlements.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettlements();
  }, []);

  const handleReleasePayout = async (settlement: SettlementRecord) => {
    const confirmRelease = window.confirm(
      `Confirm wire release of ${formatINR(settlement.netSettlementAmount)} to ${settlement.sellerName}? This will debit the platform ledger and mark the escrow complete.`,
    );
    if (!confirmRelease) return;

    setReleasingId(settlement.id);
    try {
      await apiRequest(`/admin/settlements/${encodeURIComponent(settlement.id)}/release`, {
        method: 'POST',
        body: JSON.stringify({
          bankReference: `WIRE-KN-${Date.now().toString().slice(-6)}`,
        }),
      });
      showToast(`Settlement wire released to ${settlement.sellerName}! Platform ledger updated.`, 'success');
      loadSettlements();
    } catch (err: any) {
      showToast(err.message || 'Failed to release settlement wire.', 'error');
    } finally {
      setReleasingId(null);
    }
  };

  const handleExportCsv = () => {
    if (settlements.length === 0) {
      showToast('No settlements to export.', 'error');
      return;
    }
    exportToCsv<SettlementRecord>(
      'kshop_escrow_settlements',
      [
        { header: 'Settlement Number', key: 'settlementNumber' },
        { header: 'Seller ID', key: 'sellerId' },
        { header: 'Merchant Contact', key: 'sellerName' },
        { header: 'Gross Amount (INR)', key: 'grossAmount' },
        { header: 'Platform Fee (INR)', key: 'platformFee' },
        { header: 'Net Payout (INR)', key: 'netSettlementAmount' },
        { header: 'Escrow Status', key: 'status' },
        { header: 'Period Start', key: (s) => s.periodStart ? new Date(s.periodStart).toLocaleDateString() : 'N/A' },
        { header: 'Period End', key: (s) => s.periodEnd ? new Date(s.periodEnd).toLocaleDateString() : 'N/A' },
        { header: 'Wire Reference', key: (s) => s.bankReference || 'Pending' },
        { header: 'Created Date', key: (s) => s.createdAt ? new Date(s.createdAt).toLocaleDateString() : 'N/A' },
        { header: 'Processed Date', key: (s) => s.processedAt ? new Date(s.processedAt).toLocaleString() : 'Unprocessed' },
      ],
      settlements
    );
    showToast(`Exported ${settlements.length} settlement records to CSV!`);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-stone-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
            Escrow Releases & Banking
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Settlement Wire Authorizations
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Verify Day-8 escrow maturation, release bank wires to merchant balances, and audit platform commission fees.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={isLoading || settlements.length === 0}
            leftIcon={<Download className="w-4 h-4 text-emerald-600" />}
          >
            Export Settlements CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadSettlements}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh Escrow
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadSettlements} isRetrying={isLoading} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Auditing escrow batches...</div>
      ) : (
        <div className="space-y-4">
          {/* Mobile Stacked Cards (Visible on screens < md) */}
          <div className="md:hidden space-y-3">
            {settlements.length === 0 ? (
              <div className="py-12 text-center text-xs text-stone-500 bg-white rounded-2xl border border-stone-200">
                No escrow settlements currently recorded.
              </div>
            ) : (
              settlements.map((s) => (
                <div
                  key={s.id}
                  className="bg-white rounded-2xl border border-stone-200/90 shadow-soft p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-stone-400 block tracking-wider">
                        Batch ID
                      </span>
                      <p className="font-mono text-sm font-bold text-stone-900">{s.settlementNumber}</p>
                      <p className="font-sans font-semibold text-stone-900 text-xs mt-0.5">{s.sellerName}</p>
                    </div>
                    <Badge variant={s.status === 'COMPLETED' ? 'emerald' : 'amber'} size="sm" dot>
                      {s.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2 bg-stone-50/70 rounded-xl p-2.5 border border-stone-200/80 text-center text-xs font-mono">
                    <div>
                      <span className="text-[10px] font-sans text-stone-400 block">Gross</span>
                      <span className="font-semibold text-stone-800">{formatINR(s.grossAmount)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-sans text-amber-700 block">Fee (5%)</span>
                      <span className="font-semibold text-amber-800">-{formatINR(s.platformFee)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-sans text-burgundy block font-bold">Net Payout</span>
                      <span className="font-bold text-burgundy">{formatINR(s.netSettlementAmount)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-stone-500 pt-1">
                    <span>Date: {s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-IN') : 'Recent'}</span>
                    <span className="font-mono">{s.bankReference ? `Ref: ${s.bankReference}` : 'Queued'}</span>
                  </div>

                  <div className="pt-2 border-t border-stone-100 flex items-center justify-end">
                    {s.status === 'COMPLETED' ? (
                      <span className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Wired & Reconciled
                      </span>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        isLoading={releasingId === s.id}
                        onClick={() => handleReleasePayout(s)}
                        leftIcon={<Send className="w-3 h-3" />}
                        className="bg-emerald-700 hover:bg-emerald-800 text-xs w-full sm:w-auto"
                      >
                        Release Wire
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop Luxury Table (Visible on screens >= md) */}
          <div className="hidden md:block bg-white rounded-3xl border border-stone-200/90 shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-stone-50/80 border-b border-stone-200/80 text-[10px] font-bold text-stone-500 uppercase tracking-widest">
                    <th className="py-4 px-6">Batch ID</th>
                    <th className="py-4 px-4">Seller Store</th>
                    <th className="py-4 px-4">Escrow Date</th>
                    <th className="py-4 px-4">Gross Collected</th>
                    <th className="py-4 px-4">Platform Fee (5%)</th>
                    <th className="py-4 px-4 font-bold text-burgundy">Net Payout</th>
                    <th className="py-4 px-4">Bank Ref</th>
                    <th className="py-4 px-4">Status</th>
                    <th className="py-4 px-6 text-right">Wire Authorization</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {settlements.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-stone-400">
                        No escrow settlements currently recorded. Deliveries automatically populate this register.
                      </td>
                    </tr>
                  ) : (
                    settlements.map((s) => (
                      <tr key={s.id} className="hover:bg-stone-50/60 transition-colors font-mono">
                        <td className="py-4 px-6 font-bold text-stone-900">{s.settlementNumber}</td>
                        <td className="py-4 px-4 font-sans font-semibold text-stone-900">{s.sellerName}</td>
                        <td className="py-4 px-4 font-sans text-stone-500 text-[11px]">
                          {s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-IN') : 'Recent'}
                        </td>
                        <td className="py-4 px-4 text-stone-700">{formatINR(s.grossAmount)}</td>
                        <td className="py-4 px-4 text-stone-500">{formatINR(s.platformFee)}</td>
                        <td className="py-4 px-4 font-bold text-burgundy text-sm">
                          {formatINR(s.netSettlementAmount)}
                        </td>
                        <td className="py-4 px-4 text-stone-500 text-[11px]">{s.bankReference || 'Queued'}</td>
                        <td className="py-4 px-4 font-sans">
                          <Badge variant={s.status === 'COMPLETED' ? 'emerald' : 'amber'} size="sm" dot>
                            {s.status}
                          </Badge>
                        </td>
                        <td className="py-4 px-6 text-right font-sans">
                          {s.status === 'COMPLETED' ? (
                            <span className="text-[11px] font-bold text-emerald-700 flex items-center justify-end gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Wired & Reconciled
                            </span>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              isLoading={releasingId === s.id}
                              onClick={() => handleReleasePayout(s)}
                              leftIcon={<Send className="w-3 h-3" />}
                              className="bg-emerald-700 hover:bg-emerald-800 text-[11px]"
                            >
                              Release Wire
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
