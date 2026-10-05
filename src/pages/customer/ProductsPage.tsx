import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { productService } from '../../services/productService';
import { Product, ProductFilterParams } from '../../types/product';
import { ProductCard } from '../../components/product/ProductCard';
import { QuickViewModal } from '../../components/product/QuickViewModal';
import { ProductCardSkeleton } from '../../components/common/Skeleton';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { Select } from '../../components/common/Select';
import { Button } from '../../components/common/Button';
import {
  Filter,
  Search,
  LayoutGrid,
  List,
  RotateCcw,
  SlidersHorizontal,
  X
} from 'lucide-react';

export const ProductsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState<string>(searchParams.get('q') || '');
  const [selectedCategory, setSelectedCategory] = useState<string>(searchParams.get('category') || 'All');
  const [minPrice, setMinPrice] = useState<number | undefined>(undefined);
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined);
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  const [inStockOnly, setInStockOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<ProductFilterParams['sortBy']>('featured');

  // View Mode
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedQuickView, setSelectedQuickView] = useState<Product | null>(null);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState<boolean>(false);

  // Sync filters with URL query parameters
  useEffect(() => {
    const cat = searchParams.get('category') || 'All';
    const q = searchParams.get('q') || '';
    setSelectedCategory(cat);
    setSearchQuery(q);
  }, [searchParams]);

  const fetchCatalog = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const filterParams: ProductFilterParams = {
        query: searchQuery || undefined,
        category: selectedCategory !== 'All' ? selectedCategory : undefined,
        minPrice,
        maxPrice,
        minRating,
        inStockOnly,
        sortBy,
      };

      const [prods, cats] = await Promise.all([
        productService.getProducts(filterParams),
        productService.getCategories(),
      ]);

      setProducts(prods);
      setCategories(cats);
    } catch (err: any) {
      // STRICT ERROR STATE
      setError(err.message || 'Unable to load products. Please try again.');
      setProducts([]); // NO fake fallback products!
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, [selectedCategory, searchQuery, minPrice, maxPrice, minRating, inStockOnly, sortBy]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchCatalog();
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setMinPrice(undefined);
    setMaxPrice(undefined);
    setMinRating(undefined);
    setInStockOnly(false);
    setSortBy('featured');
    setSearchParams({});
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Header & Page Title */}
      <div className="border-b border-cream-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
          Catalog Index
        </span>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="text-3xl font-serif font-bold text-stone-900">
            {selectedCategory === 'All' ? 'Complete Collection' : selectedCategory}
          </h1>
          <p className="text-xs text-stone-500">
            Showing {products.length} sovereign artifact{products.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Control Bar (Search, Sort, View Toggle, Mobile Filter Button) */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-cream-200 shadow-soft">
        {/* Search Field */}
        <form onSubmit={handleSearchSubmit} className="relative w-full md:max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search titles, materials, ateliers..."
            className="w-full bg-ivory border border-cream-300 rounded-xl pl-10 pr-24 py-2 text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1 bg-burgundy text-white text-[11px] font-semibold rounded-lg hover:bg-burgundy-800 transition-colors"
          >
            Find
          </button>
        </form>

        {/* Filters & Actions Group */}
        <div className="flex items-center justify-between w-full md:w-auto gap-3">
          {/* Mobile Filter Toggle */}
          <button
            onClick={() => setIsFilterDrawerOpen(true)}
            className="md:hidden flex items-center gap-1.5 px-3 py-2 rounded-xl bg-ivory border border-cream-300 text-xs font-semibold text-stone-800"
          >
            <SlidersHorizontal className="w-4 h-4 text-burgundy" /> Filters
          </button>

          {/* Sort Dropdown */}
          <div className="w-44">
            <Select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              options={[
                { value: 'featured', label: 'Curated Order' },
                { value: 'price_asc', label: 'Price: Low to High' },
                { value: 'price_desc', label: 'Price: High to Low' },
                { value: 'rating', label: 'Highest Rating' },
                { value: 'newest', label: 'Newest Arrivals' },
              ]}
            />
          </div>

          {/* Grid / List Switcher */}
          <div className="hidden sm:flex items-center border border-cream-300 rounded-xl p-0.5 bg-ivory">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'grid' ? 'bg-white text-burgundy shadow-xs' : 'text-stone-400'
              }`}
              title="Grid layout"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'list' ? 'bg-white text-burgundy shadow-xs' : 'text-stone-400'
              }`}
              title="List layout"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Catalog Stage with Sidebar Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-start">
        {/* Desktop Filter Sidebar - Sticky and Static while products scroll */}
        <aside className="hidden md:block bg-white p-6 rounded-2xl border border-cream-200 shadow-soft space-y-6 sticky top-24 self-start max-h-[calc(100vh-7rem)] overflow-y-auto pr-3 scrollbar-thin">
          <div className="flex items-center justify-between pb-4 border-b border-cream-200">
            <span className="font-serif font-bold text-sm text-stone-900 flex items-center gap-2">
              <Filter className="w-4 h-4 text-burgundy" /> Filter Attributes
            </span>
            <button
              onClick={handleResetFilters}
              className="text-[11px] text-stone-500 hover:text-burgundy flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>

          {/* Categories */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block mb-2.5">
              Category
            </label>
            <div className="space-y-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    selectedCategory === cat
                      ? 'bg-burgundy text-white font-semibold'
                      : 'text-stone-700 hover:bg-ivory'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Price Range Filter */}
          <div className="pt-4 border-t border-cream-200">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block mb-2.5">
              Price Range ($)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                placeholder="Min"
                value={minPrice ?? ''}
                onChange={(e) => setMinPrice(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full bg-ivory border border-stone-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
              <input
                type="number"
                placeholder="Max"
                value={maxPrice ?? ''}
                onChange={(e) => setMaxPrice(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full bg-ivory border border-stone-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
            </div>
          </div>

          {/* Availability */}
          <div className="pt-4 border-t border-cream-200">
            <label className="flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
                className="accent-burgundy w-4 h-4 rounded cursor-pointer"
              />
              <span>In Stock Only (Ready for COD)</span>
            </label>
          </div>

          {/* Rating Filter */}
          <div className="pt-4 border-t border-cream-200">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block mb-2">
              Minimum Master Rating
            </label>
            <div className="flex gap-2">
              {[4.5, 4.8, 5.0].map((r) => (
                <button
                  key={r}
                  onClick={() => setMinRating(minRating === r ? undefined : r)}
                  className={`flex-1 py-1 text-xs rounded-lg border font-semibold transition-all ${
                    minRating === r
                      ? 'bg-burgundy text-white border-burgundy'
                      : 'bg-ivory text-stone-700 border-stone-200 hover:bg-cream-100'
                  }`}
                >
                  ★ {r}+
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Product Cards Stage */}
        <div className="md:col-span-3">
          {/* STRICT ERROR HANDLING (Zero fallback data when API fails) */}
          {error ? (
            <ErrorState
              title="Unable to Load Products"
              message={error}
              onRetry={fetchCatalog}
              isRetrying={isLoading}
            />
          ) : isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : products.length === 0 ? (
            <EmptyState
              title="No Products Available"
              description="No pieces match your exact price or category criteria. Try broadening your filter selection."
              actionText="Clear Filters"
              onAction={handleResetFilters}
            />
          ) : (
            <div
              className={
                viewMode === 'grid'
                  ? 'grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6'
                  : 'space-y-4'
              }
            >
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onQuickView={(prod) => setSelectedQuickView(prod)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick View Modal */}
      <QuickViewModal
        isOpen={!!selectedQuickView}
        onClose={() => setSelectedQuickView(null)}
        product={selectedQuickView}
      />
    </div>
  );
};
