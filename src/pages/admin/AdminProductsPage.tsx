import React, { useState, useEffect, useCallback } from 'react';
import { adminService } from '../../services/adminService';
import { Product } from '../../types/product';
import { ErrorState } from '../../components/common/ErrorState';
import { Badge } from '../../components/common/Badge';
import { Pagination } from '../../components/common/Pagination';
import { Button } from '../../components/common/Button';
import { useToast } from '../../context/ToastContext';
import {
  Search,
  Box,
  CheckCircle,
  XCircle,
  Edit,
  Trash2,
  Clock,
  X,
  ExternalLink
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatINR } from '../../lib/currency';

const DEFAULT_PER_PAGE = 20;

export const AdminProductsPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const { showToast } = useToast();

  // Review & Action states
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [rejectingProduct, setRejectingProduct] = useState<Product | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Edit Modal state
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editStock, setEditStock] = useState<number>(0);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Server-side search: debounce the input, then reset to page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await adminService.getProducts({ page, perPage, q: debouncedQuery });
      setProducts(res.items);
      setTotal(res.meta.total);
      setTotalPages(res.meta.totalPages || 1);
    } catch (err: any) {
      setError(err.message || 'Failed to load product index.');
      setProducts([]); // NO fallback products when the API fails
    } finally {
      setIsLoading(false);
    }
  }, [page, perPage, debouncedQuery]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const handleApprove = async (product: Product) => {
    setActionInProgress(product.id);
    try {
      await adminService.reviewProduct(product.id, 'APPROVED');
      showToast(`Artifact "${product.name}" verified & approved for public sale.`, 'success');
      loadProducts();
    } catch (err: any) {
      showToast(err.message || 'Failed to approve product.', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingProduct) return;
    if (!rejectReason.trim()) {
      showToast('Please provide a reason for rejection.', 'error');
      return;
    }

    setActionInProgress(rejectingProduct.id);
    try {
      await adminService.reviewProduct(rejectingProduct.id, 'REJECTED', rejectReason.trim());
      showToast(`Artifact "${rejectingProduct.name}" rejected.`, 'info');
      setRejectingProduct(null);
      setRejectReason('');
      loadProducts();
    } catch (err: any) {
      showToast(err.message || 'Failed to reject product.', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you wish to delete/archive artifact "${name}"?`)) return;
    try {
      await adminService.deleteProduct(id);
      showToast(`Artifact "${name}" removed from registry.`, 'info');
      loadProducts();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete product.', 'error');
    }
  };

  const handleOpenEdit = (product: Product) => {
    setEditingProduct(product);
    setEditName(product.name);
    setEditPrice(product.price);
    setEditStock(product.totalStock ?? product.stock);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    if (editPrice <= 0) {
      showToast('Price must be greater than zero.', 'error');
      return;
    }
    if (editStock < 0) {
      showToast('Stock cannot be negative.', 'error');
      return;
    }

    setIsSavingEdit(true);
    try {
      await adminService.updateProduct(editingProduct.id, {
        name: editName.trim(),
        price: editPrice,
        stock: editStock,
      });
      showToast('Product details updated successfully.', 'success');
      setEditingProduct(null);
      loadProducts();
    } catch (err: any) {
      showToast(err.message || 'Failed to update product.', 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const empty = !isLoading && !error && products.length === 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div className="border-b border-stone-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
            Catalog Central
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Global Artifact Registry & Verification
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Inspect physical pieces brought to IT Cabin, verify hallmarking, manage stock and approve public listings.
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-soft flex items-center gap-3">
        <Search className="w-4 h-4 text-stone-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search products across all sellers, KNPR codes, SKU and categories..."
          className="w-full text-xs bg-transparent focus:outline-none text-stone-900"
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadProducts} isRetrying={isLoading} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">
          <div className="w-8 h-8 rounded-full border-2 border-amber-600 border-t-transparent animate-spin mx-auto mb-3" />
          Scanning indexed artifacts & stock levels...
        </div>
      ) : empty ? (
        <div className="py-16 text-center text-xs text-stone-500 bg-white rounded-3xl border border-stone-200">
          {debouncedQuery
            ? `No products match "${debouncedQuery}".`
            : 'No products have been indexed yet.'}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-stone-200 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-4 px-6">Artifact & Image</th>
                  <th className="py-4 px-4">Accredited Seller</th>
                  <th className="py-4 px-4">Category</th>
                  <th className="py-4 px-4">Price (COD)</th>
                  <th className="py-4 px-4">Physical Stock</th>
                  <th className="py-4 px-4">Sold Units</th>
                  <th className="py-4 px-4">Balance</th>
                  <th className="py-4 px-4">Status</th>
                  <th className="py-4 px-6 text-right">Intervention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {products.map((p) => {
                  const isApproved = (p.approvalStatus || p.status) === 'APPROVED';
                  const isRejected = (p.approvalStatus || p.status) === 'REJECTED';
                  const isPending = !isApproved && !isRejected;
                  const totalUnits = p.totalStock ?? p.stock;
                  const soldUnits = p.soldCount ?? 0;
                  const balanceUnits = p.balanceStock ?? (totalUnits - soldUnits);

                  return (
                    <tr key={p.id} className="hover:bg-stone-50/50 transition-colors">
                      {/* Product Image & Details */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          {p.images && p.images[0] ? (
                            <img
                              src={p.images[0]}
                              alt=""
                              className="w-12 h-12 rounded-xl object-cover border border-stone-200 shrink-0"
                            />
                          ) : (
                            <div
                              className="w-12 h-12 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-400 shrink-0"
                              title="No product image"
                            >
                              <Box className="w-5 h-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <span className="font-serif font-bold text-stone-900 block truncate max-w-xs">
                              {p.name}
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                              <span className="font-mono text-[10px] font-bold text-amber-900 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                                {p.productCode || (p.sku?.match(/\d{4}/) ? `KNPR-${p.sku.match(/\d{4}/)![0]}` : 'KNPR-0001')}
                              </span>
                              <span className="text-[10px] text-stone-400 font-mono">
                                {p.sku}
                              </span>
                            </div>
                            {/* Variant Split Tags if multi-unit split */}
                            {p.variants && p.variants.length > 1 && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {p.variants.map((v) => (
                                  <span
                                    key={v.id || v.sku}
                                    className="text-[9px] font-mono text-stone-600 bg-stone-100 px-1 rounded border border-stone-200"
                                  >
                                    {v.color || v.size || 'Var'}: {v.stock}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Seller */}
                      <td className="py-4 px-4">
                        <p className="font-semibold text-stone-800">{p.sellerName || 'Accredited Merchant'}</p>
                        <span className="text-[10px] font-mono text-stone-400 block">
                          ID: {p.sellerId?.slice(0, 8)}...
                        </span>
                      </td>

                      {/* Category */}
                      <td className="py-4 px-4 text-stone-600 font-medium">{p.category}</td>

                      {/* Price */}
                      <td className="py-4 px-4 font-bold text-stone-900 font-mono">
                        {formatINR(p.price)}
                      </td>

                      {/* Total Stock */}
                      <td className="py-4 px-4 font-mono font-bold text-stone-800">
                        {totalUnits} units
                      </td>

                      {/* Sold Units */}
                      <td className="py-4 px-4 font-mono font-bold text-emerald-700">
                        {soldUnits} sold
                      </td>

                      {/* Balance Stock */}
                      <td className="py-4 px-4 font-mono">
                        <span
                          className={`font-mono font-bold text-xs px-2 py-0.5 rounded-full inline-block ${
                            balanceUnits <= 2
                              ? 'bg-rosered-50 text-rosered-700 border border-rosered-200'
                              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {balanceUnits} available
                        </span>
                      </td>

                      {/* Verification Status */}
                      <td className="py-4 px-4">
                        {isApproved ? (
                          <Badge variant="emerald" size="sm" dot>
                            Approved
                          </Badge>
                        ) : isRejected ? (
                          <Badge variant="rosered" size="sm">
                            Rejected
                          </Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                            <Clock className="w-3 h-3 text-amber-600" />
                            Pending IT Cabin
                          </span>
                        )}
                      </td>

                      {/* Admin Actions */}
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {isPending && (
                            <>
                              <button
                                onClick={() => handleApprove(p)}
                                disabled={actionInProgress === p.id}
                                className="px-2 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[10px] font-semibold transition-colors flex items-center gap-1 shadow-xs"
                                title="Approve artifact after physical inspection"
                              >
                                <CheckCircle className="w-3 h-3" /> Approve
                              </button>
                              <button
                                onClick={() => setRejectingProduct(p)}
                                disabled={actionInProgress === p.id}
                                className="px-2 py-1 bg-rosered-50 hover:bg-rosered-100 text-rosered-700 border border-rosered-200 rounded-lg text-[10px] font-semibold transition-colors flex items-center gap-1"
                                title="Reject artifact with reason"
                              >
                                <XCircle className="w-3 h-3" /> Reject
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleOpenEdit(p)}
                            className="p-1.5 text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-100 border border-stone-200 transition-colors"
                            title="Edit product"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(p.id, p.name)}
                            className="p-1.5 text-rosered-600 hover:text-rosered-700 rounded-lg hover:bg-rosered-50 border border-rosered-200 transition-colors"
                            title="Delete artifact"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 border-t border-stone-100">
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

      {/* ── Reject Modal ──────────────────────────────────────────────────── */}
      {rejectingProduct && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 border border-stone-200 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <h3 className="font-serif font-bold text-base text-stone-900">
                Reject Product Artifact
              </h3>
              <button
                onClick={() => setRejectingProduct(null)}
                className="p-1.5 rounded-xl hover:bg-stone-100 text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-stone-600">
              Specify the reason for declining <strong>{rejectingProduct.name}</strong> ({rejectingProduct.productCode || rejectingProduct.sku}). This explanation will be documented in the audit ledger.
            </p>

            <form onSubmit={handleConfirmReject} className="space-y-4 text-xs">
              <div>
                <label className="block text-stone-700 font-semibold mb-1">
                  Reason for Rejection
                </label>
                <textarea
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g., Physical hallmarks do not match specifications, packaging damaged upon IT cabin inspection."
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:border-amber-600 text-stone-900 text-xs"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRejectingProduct(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  isLoading={actionInProgress === rejectingProduct.id}
                >
                  Confirm Rejection
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Product Modal ────────────────────────────────────────────── */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 border border-stone-200 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-stone-200">
              <div>
                <h3 className="font-serif font-bold text-lg text-stone-900">
                  Administrative Artifact Edit
                </h3>
                <span className="font-mono text-[10px] text-stone-500">
                  {editingProduct.productCode || editingProduct.sku}
                </span>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="p-1.5 rounded-xl hover:bg-stone-100 text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div>
                <label className="block text-stone-600 font-semibold mb-1">Product Title</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:border-amber-600 text-stone-900 text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-stone-600 font-semibold mb-1">Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={editPrice}
                    onChange={(e) => setEditPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:border-amber-600 text-stone-900 text-xs font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-stone-600 font-semibold mb-1">Total Stock</label>
                  <input
                    type="number"
                    min="0"
                    value={editStock}
                    onChange={(e) => setEditStock(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:border-amber-600 text-stone-900 text-xs font-mono"
                    required
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-stone-200 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingProduct(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSavingEdit}
                >
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};