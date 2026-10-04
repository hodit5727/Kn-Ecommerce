import React, { useState, useEffect, useCallback } from 'react';
import { adminService } from '../../services/adminService';
import { AdminSellerRecord } from '../../types/admin';
import { ErrorState } from '../../components/common/ErrorState';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Pagination } from '../../components/common/Pagination';
import { useToast } from '../../context/ToastContext';
import { formatINR } from '../../lib/currency';
import {
  Store,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Building,
  FileSearch,
  ExternalLink
} from 'lucide-react';

type SellerTab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

const DEFAULT_PER_PAGE = 20;

export const AdminSellersPage: React.FC = () => {
  const [sellers, setSellers] = useState<AdminSellerRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SellerTab>('PENDING');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const { showToast } = useToast();

  // Switch tab -> server-side status filter, back to page 1.
  const handleTabChange = (tab: SellerTab) => {
    setActiveTab(tab);
    setPage(1);
  };

  const loadSellers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await adminService.getSellers({
        page,
        perPage,
        status: activeTab,
      });
      setSellers(res.items);
      setTotal(res.meta.total);
      setTotalPages(res.meta.totalPages || 1);
      if (res.counts) {
        setCounts(res.counts);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve seller registry.');
    } finally {
      setIsLoading(false);
    }
  }, [page, perPage, activeTab]);

  useEffect(() => {
    loadSellers();
  }, [loadSellers]);

  const handleReview = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      await adminService.reviewSellerApplication(id, decision);
      showToast(
        decision === 'APPROVED'
          ? 'Seller accreditation granted! Switched to Accredited Sellers tab.'
          : 'Seller application rejected.',
      );
      if (decision === 'APPROVED') {
        setActiveTab('APPROVED');
        setPage(1);
      } else {
        loadSellers();
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to process application.', 'error');
    }
  };

  const empty = !isLoading && !error && sellers.length === 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-stone-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
          Atelier Accreditation Pipeline
        </span>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Seller Accreditation & Governance
        </h1>
      </div>

      {/* Pipeline Tabs (server-side status filter) */}
      <div className="flex gap-2 border-b border-stone-200 pb-3 flex-wrap">
        {([
          { id: 'PENDING', label: 'Pending Applications', icon: Clock },
          { id: 'APPROVED', label: 'Accredited Sellers', icon: ShieldCheck },
          { id: 'REJECTED', label: 'Rejected Dossiers', icon: XCircle },
          { id: 'ALL', label: 'Complete Registry', icon: Building },
        ] as Array<{ id: SellerTab; label: string; icon: React.ComponentType<{ className?: string }> }>).map((tab) => {
          const tabCount = counts[tab.id] ?? (activeTab === tab.id ? total : undefined);
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === tab.id
                  ? 'bg-stone-900 text-white shadow-xs'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {typeof tabCount === 'number' && (
                <span
                  className={`px-1.5 py-0.5 text-[10px] rounded-full font-bold ${
                    activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-stone-200 text-stone-700'
                  }`}
                >
                  {tabCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadSellers} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Loading seller dossiers...</div>
      ) : empty ? (
        <div className="py-16 text-center text-xs text-stone-500 bg-white rounded-3xl border border-stone-200 space-y-4">
          <p className="text-sm font-medium text-stone-700">No seller applications in this pipeline.</p>
          {activeTab === 'PENDING' && (
            <div className="pt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleTabChange('APPROVED')}
                leftIcon={<ShieldCheck className="w-4 h-4 text-emerald-400" />}
              >
                View Accredited Sellers {typeof counts.APPROVED === 'number' ? `(${counts.APPROVED})` : ''}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {sellers.map((seller) => (
            <div
              key={seller.id}
              className="bg-white p-6 sm:p-8 rounded-3xl border border-stone-200 shadow-soft space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-cream-100 text-burgundy flex items-center justify-center font-serif font-bold text-lg">
                    <Store className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-serif font-bold text-base text-stone-900">
                        {seller.storeName}
                      </h3>
                      {(seller.sellerId || seller.customerId?.startsWith('KNSR-')) && (
                        <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                          {seller.sellerId || seller.customerId}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-500">
                      Master Artisan: <strong>{seller.ownerName}</strong> ({seller.email})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Badge
                    variant={
                      seller.status === 'APPROVED'
                        ? 'emerald'
                        : seller.status === 'PENDING'
                        ? 'amber'
                        : 'rosered'
                    }
                    size="sm"
                    dot
                  >
                    {seller.status}
                  </Badge>

                  {seller.status === 'PENDING' && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleReview(seller.id, 'APPROVED')}
                        leftIcon={<CheckCircle2 className="w-4 h-4" />}
                      >
                        Grant Accreditation
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleReview(seller.id, 'REJECTED')}
                        leftIcon={<XCircle className="w-4 h-4" />}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Dossier details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                {/* Contact & Category */}
                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-100 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider">
                    Contact & Category
                  </span>
                  <p className="font-semibold text-stone-800">
                    Phone: {seller.phone || 'Not provided'}
                  </p>
                  <p className="text-[11px] text-stone-500">
                    Category: <strong className="text-stone-700">{seller.storeCategory || 'General'}</strong>
                  </p>
                </div>

                {/* Entity & Address */}
                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-100 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider">
                    Entity & Address
                  </span>
                  <p className="font-semibold text-stone-800 truncate" title={seller.businessType}>
                    Type: {seller.businessType || 'INDIVIDUAL'}
                  </p>
                  <p className="text-[11px] text-stone-500 truncate" title={seller.address}>
                    {seller.address || 'Address not recorded'}
                  </p>
                </div>

                {/* Uploaded ID Document */}
                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-100 space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider">
                    Uploaded ID Document
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={seller.documentStatus === 'PASSED' ? 'emerald' : 'stone'}
                      size="sm"
                    >
                      {seller.documentStatus || 'PENDING'}
                    </Badge>
                    {seller.documentUrl ? (
                      <a
                        href={seller.documentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-burgundy hover:underline"
                      >
                        <FileSearch className="w-3.5 h-3.5" /> View ID Document
                      </a>
                    ) : (
                      <span className="text-[11px] text-stone-400">No document</span>
                    )}
                  </div>
                </div>

                {/* Biometric Verification */}
                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-100 space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider">
                    Biometric Verification
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge
                      variant={seller.livenessStatus === 'PASSED' ? 'emerald' : 'stone'}
                      size="sm"
                    >
                      Liveness: {seller.livenessStatus || 'PENDING'}
                    </Badge>
                    <Badge
                      variant={seller.matchStatus === 'PASSED' ? 'emerald' : 'stone'}
                      size="sm"
                    >
                      Match: {seller.matchStatus || 'PENDING'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="bg-white rounded-2xl border border-stone-200 px-6">
            <Pagination
              page={page}
              perPage={perPage}
              total={total}
              totalPages={totalPages}
              onPageChange={(p) => setPage(p)}
              onPerPageChange={(n) => {
                setPerPage(n);
                setPage(1);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};