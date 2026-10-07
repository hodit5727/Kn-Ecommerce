import React, { useState, useEffect } from 'react';
import { adminService } from '../../services/adminService';
import { useToast } from '../../context/ToastContext';
import { Product } from '../../types/product';
import {
  Flame,
  TrendingUp,
  Award,
  Package,
  Search,
  CheckCircle,
  Eye,
  Store,
  RefreshCw,
  Sparkles,
  ShoppingBag,
  ExternalLink
} from 'lucide-react';
import { Link } from 'react-router-dom';

type TrendingProductItem = Product & {
  soldCount: number;
  totalRevenue: number;
  sellerStoreName?: string;
};

export const AdminTrendingPage: React.FC = () => {
  const { showToast } = useToast();
  const [products, setProducts] = useState<TrendingProductItem[]>([]);
  const [top10, setTop10] = useState<TrendingProductItem[]>([]);
  const [metrics, setMetrics] = useState({
    activeTrendingCount: 0,
    totalUnitsSold: 0,
    totalProducts: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'top10' | 'all'>('top10');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchTrendingData = async () => {
    setIsLoading(true);
    try {
      const data = await adminService.getTrendingProducts();
      setProducts(data.products || []);
      setTop10(data.top10 || []);
      setMetrics(data.metrics || { activeTrendingCount: 0, totalUnitsSold: 0, totalProducts: 0 });
    } catch (err: any) {
      showToast(err.message || 'Unable to load trending products.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTrendingData();
  }, []);

  const handleToggleTrending = async (product: TrendingProductItem) => {
    const nextState = !product.isTrending;
    setTogglingId(product.id);
    try {
      await adminService.toggleProductTrending(product.id, nextState);
      // Optimistic update
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, isTrending: nextState } : p))
      );
      setTop10((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, isTrending: nextState } : p))
      );
      setMetrics((prev) => ({
        ...prev,
        activeTrendingCount: nextState
          ? prev.activeTrendingCount + 1
          : Math.max(0, prev.activeTrendingCount - 1),
      }));
      showToast(
        nextState
          ? `"${product.name}" is now featured on Homepage Trending!`
          : `"${product.name}" removed from Homepage Trending.`,
        'success'
      );
    } catch (err: any) {
      showToast(err.message || 'Failed to update trending status.', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const filteredProducts = products.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.sellerStoreName && p.sellerStoreName.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-8 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-burgundy font-serif font-bold text-xs uppercase tracking-widest mb-1">
            <Flame className="w-4 h-4 text-orange-600 fill-orange-500" />
            <span>Merchandising & Curation</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900 tracking-tight">
            Trending & Top Sold Products
          </h1>
          <p className="text-xs sm:text-sm text-stone-600 mt-1 max-w-2xl">
            Monitor verified seller sales performance across campus orders and toggle which pieces are spotlighted in the Homepage <strong>Trending Now</strong> showcase.
          </p>
        </div>

        <button
          onClick={fetchTrendingData}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-stone-300 hover:border-burgundy text-stone-700 text-xs font-semibold rounded-xl shadow-xs transition-all active:scale-[0.98] self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-stone-500 ${isLoading ? 'animate-spin text-burgundy' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
            <Flame className="w-6 h-6 fill-orange-500" />
          </div>
          <div>
            <span className="text-[11px] uppercase font-bold tracking-wider text-stone-500 block">
              Active on Homepage
            </span>
            <div className="text-2xl font-serif font-bold text-stone-900 mt-0.5">
              {metrics.activeTrendingCount} <span className="text-xs font-sans font-normal text-stone-500">pieces</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[11px] uppercase font-bold tracking-wider text-stone-500 block">
              Total Units Sold
            </span>
            <div className="text-2xl font-serif font-bold text-stone-900 mt-0.5">
              {metrics.totalUnitsSold} <span className="text-xs font-sans font-normal text-stone-500">units</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[11px] uppercase font-bold tracking-wider text-stone-500 block">
              Catalog Strength
            </span>
            <div className="text-2xl font-serif font-bold text-stone-900 mt-0.5">
              {metrics.totalProducts} <span className="text-xs font-sans font-normal text-stone-500">artifacts</span>
            </div>
          </div>
        </div>
      </div>

      {/* View Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white p-3 rounded-2xl border border-stone-200 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('top10')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'top10'
                ? 'bg-stone-900 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            🏆 Top 10 Best Sellers
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'all'
                ? 'bg-stone-900 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            All Products ({products.length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            placeholder="Search by title, brand, seller..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </div>
      </div>

      {/* Main Table / Leaderboard */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin" />
            <p className="text-xs text-stone-500 font-medium">Aggregating seller sales and trending status...</p>
          </div>
        ) : (activeTab === 'top10' ? top10 : filteredProducts).length === 0 ? (
          <div className="py-16 text-center text-stone-500 text-xs">
            No products found matching your search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4 w-12 text-center">Rank</th>
                  <th className="py-3 px-4">Artifact / Product</th>
                  <th className="py-3 px-4">Seller Store</th>
                  <th className="py-3 px-4 text-center">Units Sold</th>
                  <th className="py-3 px-4 text-right">GMV Revenue</th>
                  <th className="py-3 px-4 text-center">Price</th>
                  <th className="py-3 px-4 text-center">Trending on Home</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {(activeTab === 'top10' ? top10 : filteredProducts).map((product, idx) => {
                  const isTop3 = idx < 3 && activeTab === 'top10';
                  return (
                    <tr
                      key={product.id}
                      className={`hover:bg-stone-50/70 transition-colors ${
                        product.isTrending ? 'bg-orange-50/20' : ''
                      }`}
                    >
                      {/* Rank Column */}
                      <td className="py-3 px-4 text-center font-bold">
                        {isTop3 ? (
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs text-white font-bold shadow-2xs ${
                              idx === 0
                                ? 'bg-amber-500'
                                : idx === 1
                                ? 'bg-stone-400'
                                : 'bg-amber-700'
                            }`}
                          >
                            {idx + 1}
                          </span>
                        ) : (
                          <span className="text-stone-400 font-medium">{idx + 1}</span>
                        )}
                      </td>

                      {/* Product Column */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={product.images[0] || '/placeholder-product.jpg'}
                            alt={product.name}
                            className="w-11 h-11 rounded-xl object-cover bg-stone-100 border border-stone-200 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-stone-900 truncate max-w-xs flex items-center gap-1.5">
                              <span>{product.name}</span>
                              {product.isTrending && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-800 text-[9px] font-bold tracking-wide uppercase shrink-0">
                                  <Flame className="w-2.5 h-2.5 fill-orange-500 text-orange-600" />
                                  Trending
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-stone-500 flex items-center gap-2 mt-0.5">
                              <span>{product.category}</span>
                              <span className="opacity-40">•</span>
                              <span>{product.brand}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Seller Column */}
                      <td className="py-3 px-4 text-stone-700">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Store className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                          <span className="truncate max-w-[140px]">
                            {product.sellerStoreName || 'Campus Atelier'}
                          </span>
                        </div>
                      </td>

                      {/* Units Sold */}
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-stone-100 font-bold text-stone-800 text-xs">
                          {product.soldCount}
                        </span>
                      </td>

                      {/* Total Revenue */}
                      <td className="py-3 px-4 text-right font-serif font-bold text-stone-900">
                        ₹{Number(product.totalRevenue || 0).toLocaleString('en-IN')}
                      </td>

                      {/* Unit Price */}
                      <td className="py-3 px-4 text-center font-semibold text-burgundy">
                        ₹{product.price.toLocaleString('en-IN')}
                      </td>

                      {/* Trending Toggle Switch */}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleTrending(product)}
                          disabled={togglingId === product.id}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer select-none active:scale-[0.97] border ${
                            product.isTrending
                              ? 'bg-orange-500 hover:bg-orange-600 text-white border-orange-600 shadow-xs'
                              : 'bg-stone-100 hover:bg-stone-200 text-stone-600 border-stone-300'
                          }`}
                          title={product.isTrending ? 'Click to remove from Homepage Trending' : 'Click to feature in Homepage Trending'}
                        >
                          <Flame
                            className={`w-3.5 h-3.5 ${
                              product.isTrending ? 'fill-white text-white' : 'text-stone-400'
                            }`}
                          />
                          <span>{product.isTrending ? 'Active' : 'Enable'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Helper Guideline Card */}
      <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 text-amber-900 text-xs flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-serif font-bold text-amber-950">How Homepage Trending Works</h4>
          <p className="text-[11px] text-amber-800 leading-relaxed mt-0.5">
            Products marked <strong>Active</strong> will automatically display on the Sovereign Homepage under the <strong>Trending Now</strong> showcase. If no items are explicitly selected, the platform highlights the verified Top 10 best-selling items calculated from genuine customer Cash on Delivery orders.
          </p>
        </div>
      </div>
    </div>
  );
};
