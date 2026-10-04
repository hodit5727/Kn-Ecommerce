import React, { useState, useEffect } from 'react';
import { refundService } from '../../services/refundService';
import { RefundClaim } from '../../types/refund';
import { RefundStatusBadge } from '../../components/refunds/RefundStatusBadge';
import { ErrorState } from '../../components/common/ErrorState';
import { EmptyState } from '../../components/common/EmptyState';
import { RotateCcw } from 'lucide-react';
import { formatINR } from '../../lib/currency';

export const SellerRefundsPage: React.FC = () => {
  const [refunds, setRefunds] = useState<RefundClaim[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadRefunds = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Scope comes from the authenticated seller session server-side; no
      // hardcoded seller ids are sent from the client.
      const data = await refundService.getRefunds();
      setRefunds(data);
    } catch (err: any) {
      setError(err.message || 'Unable to load seller refunds.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRefunds();
  }, []);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-cream-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
          Arbitration & Disputes
        </span>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Atelier Return & Refund Dossiers
        </h1>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadRefunds} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Retrieving claims...</div>
      ) : refunds.length === 0 ? (
        <EmptyState
          title="No Open Refund Claims"
          description="Your atelier currently has zero active dispute or return dossiers."
        />
      ) : (
        <div className="space-y-4">
          {refunds.map((claim) => {
            const match = String(claim.orderNumber ?? '').match(/\d{4}$/);
            const hex = String(claim.id ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
            const codeDigits = match ? match[0] : (hex ? String((parseInt(hex, 16) % 9000) + 1000) : '1001');
            const returnCode = claim.returnCode || `CNRT-${codeDigits}`;
            const refundCode = claim.refundCode || `CNRF-${codeDigits}`;
            const orderCode = claim.orderNumber?.startsWith('KNOR-') ? claim.orderNumber : `KNOR-${codeDigits}`;

            return (
            <div key={claim.id} className="bg-white p-6 rounded-3xl border border-cream-200 shadow-soft space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-cream-200">
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
                  </div>
                  <p className="text-xs text-stone-500 mt-1.5">
                    Patron: <strong>{claim.customerName}</strong> ({claim.customerEmail})
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <RefundStatusBadge status={claim.status} />
                  <p className="text-sm font-bold text-burgundy font-serif mt-1">
                    {formatINR(claim.amount)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <img src={claim.productImage} alt="" className="w-14 h-14 rounded-xl object-cover" />
                <div className="flex-1 text-xs">
                  <p className="font-semibold text-stone-900">{claim.productName}</p>
                  <p className="text-stone-500">Reason: {claim.reason.replace(/_/g, ' ')}</p>
                  <p className="text-stone-700 italic mt-1 bg-ivory p-2 rounded-lg border border-cream-200">
                    "{claim.description}"
                  </p>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
