import React, { useState, useEffect } from 'react';
import { refundService } from '../../services/refundService';
import { RefundClaim } from '../../types/refund';
import { useAuth } from '../../auth/AuthContext';
import { RefundStatusBadge } from '../../components/refunds/RefundStatusBadge';
import { ErrorState } from '../../components/common/ErrorState';
import { EmptyState } from '../../components/common/EmptyState';
import { Button } from '../../components/common/Button';
import { Link } from 'react-router-dom';
import { formatINR } from '../../lib/currency';
import {
  RotateCcw,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Package
} from 'lucide-react';

export const RefundsPage: React.FC = () => {
  const { user } = useAuth();
  const [refunds, setRefunds] = useState<RefundClaim[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRefunds = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await refundService.getRefunds(user?.id);
      setRefunds(list);
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve refund records from server.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRefunds();
  }, [user]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Header */}
      <div className="border-b border-cream-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
            Arbitration & Return Claims
          </span>
          <h1 className="text-3xl font-serif font-bold text-stone-900">
            Refund Status Tracker
          </h1>
        </div>
        <Link to="/orders?tab=REFUND">
          <Button variant="outline" size="sm" leftIcon={<Package className="w-4 h-4" />}>
            View Delivered Orders for Refund
          </Button>
        </Link>
      </div>

      {/* Protocol Banner */}
      <div className="bg-ivory p-6 rounded-3xl border border-cream-300 space-y-2 text-xs text-stone-700 shadow-soft">
        <div className="flex items-center gap-2 font-bold text-burgundy">
          <RotateCcw className="w-4 h-4" />
          <span>Sovereign Return Protocol & Arbitration Lifecycle</span>
        </div>
        <p className="text-stone-600 leading-relaxed max-w-3xl">
          Because K-Shop operates under pure Cash on Delivery, refunds are audited individually by
          governance curators and the artisan seller. Upon approval, funds are wired directly to your
          registered IBAN or bank coordinates.
        </p>
      </div>

      {/* Error state */}
      {error ? (
        <ErrorState
          title="Refund Records Unreachable"
          message={error}
          onRetry={fetchRefunds}
          isRetrying={isLoading}
        />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">
          <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-3" />
          Accessing claim registry...
        </div>
      ) : refunds.length === 0 ? (
        <EmptyState
          title="No Active Refund Claims"
          description="You have no open or resolved refund claims. Returns may be initiated on delivered orders within 14 days."
          actionText="View Orders"
          onAction={() => window.location.assign('/orders')}
        />
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
              className="bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-cream-200">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-stone-900 text-stone-100 font-mono text-xs font-bold tracking-wider">
                      Return {returnCode}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-burgundy text-white font-mono text-xs font-bold tracking-wider">
                      Refund {refundCode}
                    </span>
                    <RefundStatusBadge status={claim.status} />
                  </div>
                  <p className="text-xs text-stone-500 mt-2">
                    Order Requisition: <strong>{orderCode}</strong> • Lodged on{' '}
                    {claim.requestedAt ? new Date(claim.requestedAt).toLocaleDateString() : 'Recent'}
                  </p>
                </div>

                <div className="text-right sm:text-right">
                  <span className="text-xs text-stone-500 block">Claim Valuation:</span>
                  <span className="text-xl font-serif font-bold text-burgundy">
                    {formatINR(claim.amount)}
                  </span>
                </div>
              </div>

              {/* Product Info */}
              <div className="flex items-center gap-4">
                <img
                  src={claim.productImage}
                  alt={claim.productName}
                  className="w-16 h-16 rounded-xl object-cover bg-stone-50 border border-cream-200"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] uppercase font-bold text-stone-400 block">
                    Target Artifact
                  </span>
                  <h4 className="font-serif font-semibold text-xs text-stone-900 truncate">
                    {claim.productName}
                  </h4>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Seller: <strong>{claim.sellerName}</strong> • Grounds: {claim.reason.replace(/_/g, ' ')}
                  </p>
                </div>
              </div>

              {/* Statement Description */}
              <div className="bg-ivory p-4 rounded-2xl border border-cream-200 text-xs text-stone-700">
                <span className="font-bold text-[10px] uppercase tracking-wider text-stone-500 block mb-1">
                  Patron Claim Description:
                </span>
                <p className="italic">"{claim.description}"</p>
              </div>

              {/* Governance / Admin Decision Notes if present */}
              {claim.adminNotes && (
                <div className="bg-cream-50 p-4 rounded-2xl border border-cream-300 text-xs text-stone-800">
                  <span className="font-bold text-[10px] uppercase tracking-wider text-burgundy block mb-1">
                    Governance Arbitration Resolution:
                  </span>
                  <p>{claim.adminNotes}</p>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
