import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { productService } from '../../services/productService';
import { Product } from '../../types/product';
import { useToast } from '../../context/ToastContext';
import { ErrorState } from '../../components/common/ErrorState';
import { EmptyState } from '../../components/common/EmptyState';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { formatINR } from '../../lib/currency';
import {
  PlusCircle,
  Edit,
  Trash2,
  Eye,
  Search,
  Box,
  AlertCircle,
  X,
  Layers,
  CheckCircle2,
  Clock
} from 'lucide-react';

export const SellerProductsPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { showToast } = useToast();

  // Edit Modal State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editStock, setEditStock] = useState<number>(0);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const loadProducts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Query the seller's own catalog (includes submitted & pending items)
      const prods = await productService.getSellerProducts();
      setProducts(prods);
    } catch (err: any) {
      setError(err.message || 'Unable to load seller product catalog.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you wish to delete "${name}" from your catalog?`)) return;
    try {
      await productService.deleteProduct(id);
      showToast(`Removed "${name}" from catalog.`, 'info');
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
      await productService.updateProduct(editingProduct.id, {
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

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.productCode && p.productCode.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const pendingCount = products.filter(
    (p) => (p.approvalStatus || p.status) !== 'APPROVED'
  ).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-cream-200">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
            Inventory Dossier
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Catalog Management
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Manage your registered horological & artisan pieces, verify stock, and monitor sales.
          </p>
        </div>

        <Link to="/seller/products/new">
          <Button variant="primary" size="sm" leftIcon={<PlusCircle className="w-4 h-4" />}>
            Publish New Artifact
          </Button>
        </Link>
      </div>

      {/* IT Cabin Physical Verification Notice */}
      {pendingCount > 0 && (
        <div className="bg-amber-500/10 border border-amber-300/60 rounded-2xl p-4 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <h4 className="font-bold text-amber-900">
              Mandatory IT Cabin Handover Notice ({pendingCount} piece{pendingCount > 1 ? 's' : ''} in queue)
            </h4>
            <p className="text-amber-950/90 leading-relaxed font-medium">
              Please take off in IT cabin for product verification. Once campus administrators inspect the piece, it will be hallmarked and published live for patrons.
            </p>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-cream-200 shadow-soft flex items-center gap-3">
        <Search className="w-4 h-4 text-stone-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter by product name, KNPR code, SKU or category..."
          className="w-full text-xs text-stone-900 bg-transparent focus:outline-none"
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadProducts} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">
          <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-3" />
          Loading your atelier catalog...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No Products Found"
          description={
            searchQuery
              ? `No artifacts matching "${searchQuery}".`
              : 'You have not added any products to your catalog yet.'
          }
          actionText="Add New Product"
          onAction={() => window.location.assign('/seller/products/new')}
        />
      ) : (
        <div className="bg-white rounded-3xl border border-cream-200 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-ivory border-b border-cream-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-4 px-6">Artifact Details</th>
                  <th className="py-4 px-4">Category</th>
                  <th className="py-4 px-4">Price (COD)</th>
                  <th className="py-4 px-4">Total Stock</th>
                  <th className="py-4 px-4">Sold</th>
                  <th className="py-4 px-4">Balance Stock</th>
                  <th className="py-4 px-4">Status</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-100">
                {filtered.map((product) => {
                  const isApproved = (product.approvalStatus || product.status) === 'APPROVED';
                  const isRejected = (product.approvalStatus || product.status) === 'REJECTED';
                  const totalUnits = product.totalStock ?? product.stock;
                  const soldUnits = product.soldCount ?? 0;
                  const balanceUnits = product.balanceStock ?? (totalUnits - soldUnits);

                  return (
                    <tr key={product.id} className="hover:bg-cream-50/50 transition-colors">
                      {/* Product Details & Photo */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          {product.images && product.images[0] ? (
                            <img
                              src={product.images[0]}
                              alt=""
                              className="w-12 h-12 rounded-xl object-cover border border-cream-200 shrink-0"
                            />
                          ) : (
                            <div
                              className="w-12 h-12 rounded-xl bg-cream-100 border border-cream-200 flex items-center justify-center text-stone-400 shrink-0"
                              title="No product image"
                            >
                              <Box className="w-5 h-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <span className="font-serif font-bold text-stone-900 block truncate max-w-xs">
                              {product.name}
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                              <span className="font-mono text-[10px] font-bold text-burgundy bg-burgundy/5 px-1.5 py-0.2 rounded border border-burgundy/10">
                                {product.productCode || (product.sku?.match(/\d{4}/) ? `KNPR-${product.sku.match(/\d{4}/)![0]}` : 'KNPR-0001')}
                              </span>
                              <span className="text-[10px] text-stone-400 font-mono">
                                {product.sku}
                              </span>
                            </div>
                            {/* Variant Split Tags if multi-unit split */}
                            {product.variants && product.variants.length > 1 && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {product.variants.map((v) => (
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

                      {/* Category */}
                      <td className="py-4 px-4 text-stone-700 font-medium">
                        {product.category}
                      </td>

                      {/* Price */}
                      <td className="py-4 px-4 font-bold text-stone-900 font-mono">
                        {formatINR(product.price)}
                      </td>

                      {/* Total Stock */}
                      <td className="py-4 px-4">
                        <span className="font-bold text-stone-900 font-mono text-xs">
                          {totalUnits}
                        </span>
                        <span className="text-[10px] text-stone-400 block">total units</span>
                      </td>

                      {/* Sold Units */}
                      <td className="py-4 px-4">
                        <span className="font-bold text-emerald-700 font-mono text-xs">
                          {soldUnits}
                        </span>
                        <span className="text-[10px] text-stone-400 block">units sold</span>
                      </td>

                      {/* Balance Stock */}
                      <td className="py-4 px-4">
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

                      {/* Approval Status */}
                      <td className="py-4 px-4">
                        {isApproved ? (
                          <Badge variant="emerald" size="sm" dot>
                            Approved & Live
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

                      {/* Action buttons */}
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isApproved && (
                            <Link
                              to={`/products/${product.id}`}
                              className="p-1.5 text-stone-500 hover:text-burgundy rounded-lg hover:bg-white border border-stone-200 transition-colors"
                              title="View on public catalog"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Link>
                          )}
                          <button
                            onClick={() => handleOpenEdit(product)}
                            className="p-1.5 text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-100 border border-stone-200 transition-colors"
                            title="Edit product"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(product.id, product.name)}
                            className="p-1.5 text-rosered-600 hover:text-rosered-700 rounded-lg hover:bg-rosered-50 border border-rosered-200 transition-colors"
                            title="Delete piece"
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
        </div>
      )}

      {/* ── Edit Product Modal ────────────────────────────────────────────── */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 border border-cream-200 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-cream-200">
              <div>
                <h3 className="font-serif font-bold text-lg text-stone-900">
                  Edit Artifact Details
                </h3>
                <span className="font-mono text-[10px] text-stone-500">
                  {editingProduct.productCode || editingProduct.sku}
                </span>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="p-1.5 rounded-xl hover:bg-cream-100 text-stone-400 hover:text-stone-700"
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
                  className="w-full px-3 py-2 rounded-xl border border-cream-300 bg-ivory focus:bg-white focus:outline-none focus:border-burgundy text-stone-900 text-xs"
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
                    className="w-full px-3 py-2 rounded-xl border border-cream-300 bg-ivory focus:bg-white focus:outline-none focus:border-burgundy text-stone-900 text-xs font-mono"
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
                    className="w-full px-3 py-2 rounded-xl border border-cream-300 bg-ivory focus:bg-white focus:outline-none focus:border-burgundy text-stone-900 text-xs font-mono"
                    required
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-cream-200 flex justify-end gap-3">
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
