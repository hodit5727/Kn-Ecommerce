import React, { useState, useEffect } from 'react';
import { refundService } from '../../services/refundService';
import { RefundClaim, RefundStatus } from '../../types/refund';
import { RefundStatusBadge } from '../../components/refunds/RefundStatusBadge';
import { ErrorState } from '../../components/common/ErrorState';
import { Button } from '../../components/common/Button';
import { useToast } from '../../context/ToastContext';
import { RotateCcw, CheckCircle2, XCircle, AlertTriangle, Download } from 'lucide-react';
import { formatINR } from '../../lib/currency';
import { exportToCsv } from '../../lib/csvExport';

export const AdminRefundsPage: React.FC = () => {
  const [refunds, setRefunds] = useState<RefundClaim[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const loadRefunds = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await refundService.getRefunds();
      setRefunds(list);
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve refund arbitration dossiers.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRefunds();
  }, []);

  const handleArbitrate = async (id: string, status: RefundStatus, notes: string) => {
    try {
      await refundService.updateRefundStatus(id, status, notes);
      showToast(`Refund claim status updated to ${status}.`);
      loadRefunds();
    } catch (err: any) {
      showToast(err.message || 'Arbitration update failed.', 'error');
    }
  };

  const handleExportCsv = () => {
    if (refunds.length === 0) {
      showToast('No refund claims to export.', 'error');
      return;
    }
    exportToCsv<RefundClaim>(
      'kshop_refunds',
      [
        { header: 'Claim ID', key: 'id' },
        { header: 'Order Code', key: (r) => r.orderNumber ? `ORD-${r.orderNumber}` : r.orderId },
        { header: 'Customer Name', key: (r) => r.customerName || 'Customer' },
        { header: 'Store / Seller', key: (r) => r.sellerName || 'Merchant' },
        { header: 'Product Item', key: (r) => r.productName || 'Item' },
        { header: 'Refund Amount (INR)', key: 'amount' },
        { header: 'Return Code', key: (r) => r.returnCode || 'N/A' },
        { header: 'Refund Code', key: (r) => r.refundCode || 'N/A' },
        { header: 'Claim Reason', key: 'reason' },
        { header: 'Claim Status', key: 'status' },
        { header: 'Requested At', key: (r) => r.requestedAt ? new Date(r.requestedAt).toLocaleString() : 'N/A' },
        { header: 'Resolved At', key: (r) => r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : 'Pending' },
        { header: 'Admin Notes', key: (r) => r.adminNotes || 'None' },
      ],
      refunds
    );
    showToast(`Exported ${refunds.length} refund claims to CSV!`);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-stone-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
            Dispute Tribunal
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Refund Arbitration & Return Claims
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Adjudicate campus return requests, evaluate customer claim reasons, and dispatch status updates.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          disabled={isLoading || refunds.length === 0}
          leftIcon={<Download className="w-4 h-4 text-emerald-600" />}
        >
          Export Refunds CSV
        </Button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadRefunds} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Auditing claims tribunal...</div>
      ) : refunds.length === 0 ? (
        <div className="py-16 text-center text-xs text-stone-500 bg-white rounded-3xl border border-stone-200">
          No refund claims lodged.
        </div>
      ) : (
        <div className="space-y-6">
          {refunds.map((claim) => {
            const match = String(claim.orderNumber ?? '').match(/\d{4}$/);
            const hex = String(claim.id ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
            const codeDigits = match ? match[0] : (hex ? String((parseInt(hex, 16) % 9000) + 1000) : '1001');
            const returnCode = claim.returnCode || `CNRT-${codeDigits}`;
            const refundCode = claim.refundCode || `CNRF-${codeDigits}`;
            const orderCode = claim.orderNumber?.startsWith('KNOR-') ? claim.orderNumber : `KNOR-${codeDigits}`;

            return (
            <div
              key={claim.id}
              className="bg-white p-6 sm:p-8 rounded-3xl border border-stone-200 shadow-soft space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-100">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-stone-900 text-stone-100 font-mono text-xs font-bold tracking-wider">
                      Return {returnCode}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-burgundy text-white font-mono text-xs font-bold tracking-wider">
                      Refund {refundCode}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-stone-100 border border-stone-200 text-stone-600 font-mono text-xs">
                      Order {orderCode}
                    </span>
                    <RefundStatusBadge status={claim.status} />
                  </div>
                  <p className="text-xs text-stone-500 mt-2">
                    Patron: <strong>{claim.customerName}</strong> ({claim.customerEmail}) • Atelier:{' '}
                    <strong>{claim.sellerName}</strong>
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-xs text-stone-400 block">Valuation:</span>
                  <span className="text-xl font-serif font-bold text-burgundy">
                    {formatINR(claim.amount)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <img src={claim.productImage} alt="" className="w-16 h-16 rounded-xl object-cover" />
                <div className="flex-1 text-xs">
                  <h4 className="font-serif font-semibold text-stone-900">{claim.productName}</h4>
                  <p className="text-stone-500">Grounds: {claim.reason.replace(/_/g, ' ')}</p>
                  <p className="p-3 bg-stone-50 rounded-xl border border-stone-200 mt-2 italic text-stone-700">
                    "{claim.description}"
                  </p>
                </div>
              </div>

              {/* Action Buttons for Admin */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-stone-100">
                {claim.status === 'UNDER_REVIEW' || claim.status === 'REQUESTED' ? (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() =>
                        handleArbitrate(
                          claim.id,
                          'APPROVED',
                          'Approved by Platform Governance. White-glove courier pickup scheduled.'
                        )
                      }
                      leftIcon={<CheckCircle2 className="w-4 h-4" />}
                    >
                      Approve Return & Wire
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        handleArbitrate(
                          claim.id,
                          'REJECTED',
                          'Claim rejected: Piece is past return eligibility window or inspected without fault.'
                        )
                      }
                      leftIcon={<XCircle className="w-4 h-4" />}
                    >
                      Decline Claim
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-stone-500 italic">
                    Tribunal action concluded: {claim.status}
                  </span>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
