import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { productService } from '../../services/productService';
import { Product, ProductFilterParams } from '../../types/product';
import { ProductCard } from '../../components/product/ProductCard';
import { QuickViewModal } from '../../components/product/QuickViewModal';
import { FloatingAirboard } from '../../components/product/FloatingAirboard';
import { Product3DViewer } from '../../components/3d/Product3DViewer';
import { ErrorState } from '../../components/common/ErrorState';
import { EmptyState } from '../../components/common/EmptyState';
import { ProductCardSkeleton } from '../../components/common/Skeleton';
import { Button } from '../../components/common/Button';
import { Select } from '../../components/common/Select';
import {
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Truck,
  ChevronDown,
  Search,
  Filter,
  RotateCcw,
  LayoutGrid,
  List,
  SlidersHorizontal
} from 'lucide-react';

export const HomePage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Search and URL parameters synchronization
  const [searchParams, setSearchParams] = useSearchParams();
  const urlCategory = searchParams.get('category');

  // Catalog Filters State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>(urlCategory || 'All');
  const [minPrice, setMinPrice] = useState<number | undefined>(undefined);
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined);
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  const [inStockOnly, setInStockOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<ProductFilterParams['sortBy']>('featured');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [selectedQuickViewProduct, setSelectedQuickViewProduct] = useState<Product | null>(null);
  const [isCatalogVisible, setIsCatalogVisible] = useState<boolean>(false);
  const catalogRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  // Sync category state whenever URL search param changes
  useEffect(() => {
    if (urlCategory) {
      setSelectedCategory(urlCategory);
      setIsCatalogVisible(true);
      const el = document.getElementById('catalog-index');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      setSelectedCategory('All');
    }
  }, [urlCategory]);

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
      setError(err.message || 'Unable to load products. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, [selectedCategory, minPrice, maxPrice, minRating, inStockOnly, sortBy]);

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
    setSearchParams({}, { replace: true });
  };

  const handleCategoryClick = (cat: string) => {
    setSelectedCategory(cat);
    if (cat === 'All') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ category: cat }, { replace: true });
    }
  };

  // Reveal catalog index on scroll with smooth slow animation
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsCatalogVisible(true);
        }
      },
      { threshold: 0.05, rootMargin: '0px 0px -40px 0px' }
    );

    if (catalogRef.current) {
      observer.observe(catalogRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Note: no mock hero-product fallback — an empty catalog is handled by the
  // EmptyState/ErrorState rendering in the catalog section below.

  return (
    <div className="space-y-16 pb-24">
      {/* 1. SOVEREIGN LUXURY HERO SECTION - 100% ACCURATE SINGLE LAYER WITH ZERO DOUBLE-LAYERING */}
      <section className="relative w-full overflow-hidden bg-[#FAF7F2] border-b border-cream-200/80 min-h-[580px] lg:min-h-[630px] flex items-center">
        {/* Pristine Clean Background: Sunlit Roman Arches, Golden Ring, Marble Pedestal & Water Ripples */}
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center no-repeat pointer-events-none"
          style={{ backgroundImage: "url('/hero-water-scene.jpg')" }}
        />

        {/* Soft warm ivory wash on left for flawless text contrast & readability */}
        <div className="absolute inset-0 z-0 bg-gradient-to-r from-[#FAF7F2]/90 via-[#FAF7F2]/75 sm:via-[#FAF7F2]/55 to-transparent w-full lg:w-[52%] pointer-events-none" />

        {/* Far-Left Vertical Architectural Typography */}
        <div className="hidden xl:flex flex-col items-center justify-center absolute left-5 top-1/2 -translate-y-1/2 z-10 text-[9px] uppercase tracking-[0.38em] text-stone-500/80 font-serif space-y-3 pointer-events-none select-none">
          <span>T</span><span>I</span><span>M</span><span>E</span>
          <span className="w-1 h-1 rounded-full bg-burgundy/40 my-1" />
          <span>L</span><span>I</span><span>V</span><span>E</span><span>S</span>
          <span className="w-1 h-1 rounded-full bg-burgundy/40 my-1" />
          <span>B</span><span>E</span><span>Y</span><span>O</span><span>N</span><span>D</span>
          <span className="w-1 h-1 rounded-full bg-burgundy/40 my-1" />
          <span>T</span><span>R</span><span>E</span><span>N</span><span>D</span><span>S</span>
        </div>

        {/* Main Content Container */}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 z-10 w-full py-12 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            
            {/* Left Narrative Column - Real UI Components */}
            <div className="lg:col-span-6 space-y-5 max-w-xl">
              {/* Top Spaced Subtitle */}
              <div className="text-[11px] uppercase tracking-[0.38em] text-stone-600 font-serif font-medium select-none">
                CURATE &nbsp;×&nbsp; COLLECT &nbsp;×&nbsp; CHERISH
              </div>

              {/* Pill Badge */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/80 backdrop-blur-xs border border-stone-300/80 text-xs font-semibold text-stone-800 shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-burgundy" />
                <span>Curated Sovereign Marketplace • COD Protocol</span>
              </div>

              {/* Masterpieces Headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-[54px] font-serif font-extrabold text-stone-900 tracking-tight leading-[1.08]">
                MASTERPIECES OF <br />
                <span className="text-burgundy italic font-serif">Enduring</span> <br />
                PROVENANCE.
              </h1>

              {/* Narrative Subtitle */}
              <p className="text-sm sm:text-base text-stone-700 leading-relaxed font-normal">
                Connect directly with master horologists, jewelers, and atelier guilds.
                Inspect each piece in 3D and pay exclusively upon white-glove delivery.
              </p>

              {/* Real UI Buttons */}
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById('catalog-index');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="inline-flex items-center justify-center gap-2.5 bg-burgundy hover:bg-burgundy-800 active:scale-[0.98] text-white font-serif font-medium text-sm px-6 py-3 rounded-xl shadow-soft hover:shadow-md transition-all duration-200 cursor-pointer select-none"
                >
                  <span>Explore Catalog</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById('catalog-index');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-white/90 hover:bg-white active:scale-[0.98] text-stone-800 border border-stone-300/90 font-serif font-medium text-sm px-5 py-3 rounded-xl shadow-xs hover:shadow-soft transition-all duration-200 cursor-pointer select-none"
                >
                  <span>Catalog Index ↓</span>
                  <ChevronDown className="w-4 h-4 text-burgundy" />
                </button>
              </div>

              {/* Real Trust Bar */}
              <div className="pt-3 flex items-center gap-4 text-xs text-stone-700">
                <div className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="w-4 h-4 text-burgundy" />
                  <span>100% Cash on Delivery Only</span>
                </div>
                <span className="text-stone-300">|</span>
                <div className="flex items-center gap-1.5 font-medium">
                  <Truck className="w-4 h-4 text-burgundy" />
                  <span>White-Glove Courier Inspection</span>
                </div>
              </div>
            </div>

            {/* Right Showcase Column - Single Floating Watch & Floating AirPods Over Marble Pedestal */}
            <div className="lg:col-span-6 relative h-[420px] sm:h-[460px] lg:h-[500px] flex items-center justify-center">
              
              {/* Real UI Card: Certified Horology (Top Left of Watch) */}
              <div className="absolute top-2 sm:top-6 left-2 sm:left-6 z-30 bg-white/95 backdrop-blur-md px-4 py-3 rounded-2xl border border-cream-200 shadow-soft max-w-[210px] animate-float-case">
                <div className="flex items-center justify-between text-[10px] font-bold tracking-wider uppercase text-burgundy mb-1">
                  <span>CERTIFIED HOROLOGY</span>
                  <Sparkles className="w-3 h-3 text-burgundy" />
                </div>
                <h4 className="font-serif font-bold text-stone-900 text-xs tracking-wide">Authenticated Horology</h4>
                <div className="text-[10px] font-semibold text-burgundy mt-0.5">Expert-Verified Authenticity</div>
                <p className="text-[10px] text-stone-500 mt-0.5 leading-tight">Independent Hallmark Inspection</p>
              </div>

              {/* Single Floating Tourbillon Watch (8K Ultra Sharp, Floating smoothly in golden ring) */}
              <div 
                onClick={() => {
                  const el = document.getElementById('catalog-index');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}
                className="absolute left-6 sm:left-14 bottom-8 sm:bottom-12 z-20 cursor-pointer group select-none"
                title="Inspect Aethelgard Tourbillon (8K Ultra Sharp)"
              >
                <img
                  src="/hero-watch-8k.png"
                  alt="Aethelgard Chronometre Tourbillon"
                  className="w-52 sm:w-64 lg:w-72 drop-shadow-[0_28px_42px_rgba(0,0,0,0.36)] animate-float-watch-8k group-hover:scale-105 transition-transform duration-500 select-none"
                />
              </div>

              {/* Single Floating AirPods Cluster: Case Closes/Opens & 2 Earbuds Emerge From Within */}
              <div 
                onClick={() => {
                  navigate('/home?category=Electronics');
                  setTimeout(() => {
                    const el = document.getElementById('catalog-index');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }, 50);
                }}
                className="airpods-stage absolute right-4 sm:right-10 top-8 sm:top-12 z-20 cursor-pointer group select-none"
                title="K-Shop Sovereign Airbods - Emerge from Case"
              >
                {/* Floating Left Earbud (8K Rounded, Emerges from Inside Case) */}
                <div className="absolute -top-14 -left-6 z-20 pointer-events-none">
                  <img
                    src="/hero-bud-left-8k.png"
                    alt="K-Shop Left Airbod (8K Rounded)"
                    className="w-12 sm:w-15 drop-shadow-[0_12px_24px_rgba(0,0,0,0.22)] animate-bud-left-8k"
                  />
                </div>

                {/* Floating Right Earbud (8K Rounded, Emerges from Inside Case) */}
                <div className="absolute -top-16 right-3 z-20 pointer-events-none">
                  <img
                    src="/hero-bud-right-8k.png"
                    alt="K-Shop Right Airbod (8K Rounded)"
                    className="w-12 sm:w-15 drop-shadow-[0_12px_24px_rgba(0,0,0,0.22)] animate-bud-right-8k"
                  />
                </div>

                {/* Dual Case Container: Closed State transitioning to Open State with Gold K-Shop Inscription */}
                <div className="relative w-32 sm:w-40 lg:w-44 h-28 sm:h-36 lg:h-40 flex items-center justify-center">
                  {/* Closed Case Image */}
                  <img
                    src="/hero-case-closed-8k.png"
                    alt="K-Shop Sovereign Airbods Case (Closed)"
                    className="absolute inset-0 w-full h-full object-contain drop-shadow-[0_20px_32px_rgba(0,0,0,0.22)] animate-case-closed"
                  />
                  {/* Open Case Image */}
                  <img
                    src="/hero-case-open-8k.png"
                    alt="K-Shop Sovereign Airbods Case (Open)"
                    className="absolute inset-0 w-full h-full object-contain drop-shadow-[0_20px_32px_rgba(0,0,0,0.25)] animate-case-open"
                  />
                </div>
              </div>

              {/* Real UI Card: COD Escrow Verified (Bottom Right) */}
              <div className="absolute bottom-2 sm:bottom-6 right-1 sm:right-6 z-30 bg-burgundy text-cream-100 px-4 py-3 rounded-2xl shadow-2xl border border-amber-400/30 max-w-[220px] airboard-landing-float-delayed">
                <div className="flex items-center justify-between text-[10px] font-bold tracking-wider uppercase text-amber-200 mb-1">
                  <span>COD ESCROW VERIFIED</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-300" />
                </div>
                <h4 className="font-serif font-bold text-white text-xs">ZERO ADVANCE PAYMENT</h4>
                <p className="text-[10px] text-cream-200/90 mt-0.5 leading-tight">Settle cash upon personal handover</p>
              </div>

            </div>
          </div>
        </div>

        {/* Far-Right Vertical Architectural Watermark */}
        <div className="hidden xl:flex flex-col items-center justify-center absolute right-5 top-1/2 -translate-y-1/2 z-10 text-[9px] uppercase tracking-[0.38em] text-stone-500/80 font-serif space-y-3 pointer-events-none select-none">
          <span>C</span><span>R</span><span>A</span><span>F</span><span>T</span><span>E</span><span>D</span>
          <span className="w-1 h-1 rounded-full bg-burgundy/40 my-1" />
          <span>F</span><span>O</span><span>R</span>
          <span className="w-1 h-1 rounded-full bg-burgundy/40 my-1" />
          <span>R</span><span>E</span><span>F</span><span>I</span><span>N</span><span>E</span><span>D</span>
          <span className="w-1 h-1 rounded-full bg-burgundy/40 my-1" />
          <span>T</span><span>O</span><span>M</span><span>O</span><span>R</span><span>R</span><span>O</span><span>W</span>
        </div>

        {/* Far-Right Page Counter (01 / 02 / 03) */}
        <div className="hidden xl:flex flex-col items-center absolute right-5 bottom-8 z-10 text-[10px] text-stone-400 font-serif space-y-1.5 pointer-events-none select-none">
          <span className="text-stone-700 font-bold">01</span>
          <span className="w-4 h-px bg-stone-300" />
          <span>02</span>
          <span className="w-4 h-px bg-stone-300" />
          <span>03</span>
        </div>

        {/* Bottom Left Decorative Slogan Bar */}
        <div className="absolute bottom-3 left-8 sm:left-12 z-10 text-[10px] tracking-[0.35em] uppercase text-stone-500/80 font-serif flex items-center gap-3 select-none pointer-events-none">
          <span>A HIGHER STANDARD AWAITS</span>
          <span className="w-12 h-px bg-stone-400/60" />
        </div>
      </section>

      {/* 2. EXACT CATALOG INDEX & FILTER SECTION - REVEALED ON SCROLL WITH SLOW ANIMATION */}
      <section
        id="catalog-index"
        ref={catalogRef}
        className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 transition-all duration-1000 ease-out transform ${
          isCatalogVisible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-16'
        }`}
      >
        {/* Header & Page Title */}
        <div className="border-b border-cream-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
            Catalog Index
          </span>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-3xl font-serif font-bold text-stone-900">
              {selectedCategory === 'All' ? 'Complete Collection' : selectedCategory}
            </h2>
            <p className="text-xs text-stone-500">
              Showing {products.length} sovereign artifact{products.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {/* Control Bar (Search, Sort, View Toggle) */}
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
          {/* Desktop Filter Sidebar - Sticky/Static while right side scrolls */}
          <aside className="bg-white p-6 rounded-2xl border border-cream-200 shadow-soft space-y-6 sticky top-24 self-start max-h-[calc(100vh-7rem)] overflow-y-auto pr-3 scrollbar-thin">
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
                    onClick={() => handleCategoryClick(cat)}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      selectedCategory.toLowerCase() === cat.toLowerCase()
                        ? 'bg-burgundy text-white font-semibold shadow-xs'
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
            {error ? (
              <ErrorState
                title="Unable to Load Products"
                message={error}
                onRetry={fetchCatalog}
                isRetrying={isLoading}
              />
            ) : isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
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
                    ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6'
                    : 'space-y-4'
                }
              >
                {products.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onQuickView={(prod) => setSelectedQuickViewProduct(prod)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Quick View Modal */}
      <QuickViewModal
        isOpen={!!selectedQuickViewProduct}
        onClose={() => setSelectedQuickViewProduct(null)}
        product={selectedQuickViewProduct}
      />
    </div>
  );
};
