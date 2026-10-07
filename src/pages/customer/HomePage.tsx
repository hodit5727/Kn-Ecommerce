import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { productService } from '../../services/productService';
import { Product } from '../../types/product';
import { ProductCard } from '../../components/product/ProductCard';
import { QuickViewModal } from '../../components/product/QuickViewModal';
import { ProductCardSkeleton } from '../../components/common/Skeleton';
import {
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Truck,
  ChevronDown,
  Flame,
  Clock,
  Shirt,
  Smartphone,
  Laptop,
  LayoutGrid,
  ChevronRight,
  CheckCircle2,
  Lock
} from 'lucide-react';

export const HomePage: React.FC = () => {
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedQuickViewProduct, setSelectedQuickViewProduct] = useState<Product | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // If URL has category or search query, redirect immediately to the dedicated /products catalog page
  useEffect(() => {
    const category = searchParams.get('category');
    const q = searchParams.get('q');
    if (category && category.toLowerCase() !== 'all' && category.toLowerCase() !== 'home') {
      navigate(`/products?category=${encodeURIComponent(category)}`, { replace: true });
    } else if (q && q.trim()) {
      navigate(`/products?q=${encodeURIComponent(q.trim())}`, { replace: true });
    }
  }, [searchParams, navigate]);

  // Fetch approved products for the curated New Arrivals and Trending showcases
  useEffect(() => {
    setIsLoading(true);
    productService.getProducts({})
      .then((prods) => {
        setAllProducts(prods || []);
      })
      .catch((err) => {
        console.warn('[home] failed to fetch showcase products:', err?.message || err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const handleCategoryClick = (cat: string) => {
    if (cat === 'All') {
      navigate('/products');
    } else {
      navigate(`/products?category=${encodeURIComponent(cat)}`);
    }
  };

  // Derive New Arrivals (Newest first, up to 10 products)
  const newArrivals = allProducts
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 10);

  // Derive Trending Products: STRICTLY products explicitly approved/toggled by Admin (NO fallback to all products!)
  const trendingApprovedProducts = allProducts.filter((p) => Boolean(p.isTrending));

  return (
    <div className="space-y-10 sm:space-y-16 pb-24">
      {/* ── 1. SOVEREIGN LUXURY HERO SECTION ───────────────────────────────── */}
      <section className="relative w-full overflow-hidden bg-[#FAF7F2] border-b border-cream-200/80 min-h-auto py-8 sm:py-12 lg:py-16 flex items-center">
        {/* Background Texture & Wash */}
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center no-repeat pointer-events-none"
          style={{ backgroundImage: "url('/hero-water-scene.jpg')" }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-r from-[#FAF7F2]/95 via-[#FAF7F2]/80 sm:via-[#FAF7F2]/60 to-transparent w-full lg:w-[55%] pointer-events-none" />

        {/* Architectural Watermark Typography */}
        <div className="hidden xl:flex flex-col items-center justify-center absolute left-5 top-1/2 -translate-y-1/2 z-10 text-[9px] uppercase tracking-[0.38em] text-stone-500/80 font-serif space-y-3 pointer-events-none select-none">
          <span>T</span><span>I</span><span>M</span><span>E</span>
          <span className="w-1 h-1 rounded-full bg-burgundy/40 my-1" />
          <span>L</span><span>I</span><span>V</span><span>E</span><span>S</span>
          <span className="w-1 h-1 rounded-full bg-burgundy/40 my-1" />
          <span>B</span><span>E</span><span>Y</span><span>O</span><span>N</span><span>D</span>
        </div>

        {/* Main Content Container */}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 z-10 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-12 items-center">
            
            {/* Left Narrative Column */}
            <div className="lg:col-span-6 space-y-4 sm:space-y-5 max-w-xl">
              <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.32em] text-stone-600 font-serif font-semibold select-none">
                CURATE &nbsp;×&nbsp; COLLECT &nbsp;×&nbsp; CHERISH
              </div>

              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/90 backdrop-blur-xs border border-stone-300/80 text-[11px] font-semibold text-stone-800 shadow-2xs">
                <Sparkles className="w-3.5 h-3.5 text-burgundy" />
                <span>Campus Artisanal Marketplace • 100% COD Protocol</span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-[50px] font-serif font-extrabold text-stone-900 tracking-tight leading-[1.12]">
                MASTERPIECES OF <br />
                <span className="text-burgundy italic font-serif">Enduring</span> <br />
                PROVENANCE.
              </h1>

              <p className="text-xs sm:text-sm lg:text-base text-stone-700 leading-relaxed font-normal">
                Connect directly with verified master horologists, jewelers, and atelier guilds.
                Inspect each piece upon delivery and pay with 100% Cash on Delivery.
              </p>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-4 pt-1 max-w-md">
                <button
                  type="button"
                  onClick={() => handleCategoryClick('Timepieces')}
                  className="inline-flex items-center justify-center gap-2 bg-burgundy hover:bg-burgundy-800 active:scale-[0.98] text-white font-serif font-semibold text-xs sm:text-sm px-6 py-3 rounded-xl shadow-soft hover:shadow-md transition-all min-h-[44px] cursor-pointer select-none"
                >
                  <span>Explore Watches</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById('new-arrivals');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="inline-flex items-center justify-center gap-1.5 bg-white/95 hover:bg-white active:scale-[0.98] text-stone-800 border border-stone-300 font-serif font-semibold text-xs sm:text-sm px-5 py-3 rounded-xl shadow-2xs hover:shadow-soft transition-all min-h-[44px] cursor-pointer select-none"
                >
                  <span>New Arrivals ↓</span>
                  <ChevronDown className="w-4 h-4 text-burgundy" />
                </button>
              </div>

              {/* Trust Badges */}
              <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                <div className="flex items-center gap-2 p-2 rounded-xl bg-white/80 border border-cream-200/80 shadow-2xs">
                  <ShieldCheck className="w-4 h-4 text-burgundy shrink-0" />
                  <span className="text-[11px] font-semibold text-stone-800 leading-tight">100% Cash on Delivery</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-xl bg-white/80 border border-cream-200/80 shadow-2xs">
                  <Truck className="w-4 h-4 text-burgundy shrink-0" />
                  <span className="text-[11px] font-semibold text-stone-800 leading-tight">White-Glove Courier</span>
                </div>
              </div>
            </div>

            {/* Right Showcase Column */}
            <div className="lg:col-span-6 relative h-[250px] sm:h-[360px] lg:h-[500px] flex items-center justify-center">
              {/* Certified Horology Badge */}
              <div className="hidden sm:block absolute top-2 sm:top-6 left-2 sm:left-6 z-30 bg-white/95 backdrop-blur-md px-4 py-3 rounded-2xl border border-cream-200 shadow-soft max-w-[210px] animate-float-case">
                <div className="flex items-center justify-between text-[10px] font-bold tracking-wider uppercase text-burgundy mb-1">
                  <span>CERTIFIED HOROLOGY</span>
                  <Sparkles className="w-3 h-3 text-burgundy" />
                </div>
                <h4 className="font-serif font-bold text-stone-900 text-xs tracking-wide">Authenticated Pieces</h4>
                <div className="text-[10px] font-semibold text-burgundy mt-0.5">Expert-Verified Authenticity</div>
                <p className="text-[10px] text-stone-500 mt-0.5 leading-tight">Independent Hallmark Inspection</p>
              </div>

              {/* Floating Tourbillon Watch */}
              <div 
                onClick={() => handleCategoryClick('Timepieces')}
                className="absolute left-6 sm:left-14 bottom-8 sm:bottom-12 z-20 cursor-pointer group select-none"
                title="Inspect Timepieces"
              >
                <img
                  src="/hero-watch-8k.png"
                  alt="Aethelgard Chronometre Tourbillon"
                  className="w-52 sm:w-64 lg:w-72 drop-shadow-[0_28px_42px_rgba(0,0,0,0.36)] animate-float-watch-8k group-hover:scale-105 transition-transform duration-500 select-none"
                />
              </div>

              {/* COD Escrow Verified Badge */}
              <div className="absolute bottom-2 sm:bottom-6 right-1 sm:right-6 z-30 bg-burgundy text-cream-100 px-4 py-3 rounded-2xl shadow-2xl border border-amber-400/30 max-w-[220px]">
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
      </section>

      {/* ── 2. CLEAN CURATED HOMEPAGE SHOWCASES (NO RAW PRODUCT LIST) ──────── */}
      <div className="space-y-16 sm:space-y-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Category Navigation Pills */}
        <section className="pt-2">
          <div className="text-center max-w-xl mx-auto mb-6">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.25em] text-burgundy block mb-1">
              DISCOVER BY GUILD
            </span>
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-stone-900">
              Curated Atelier Collections
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            {[
              { name: 'Timepieces', label: 'Watches', icon: Clock, desc: 'Horology & Movements' },
              { name: 'Fashion', label: 'Apparel', icon: Shirt, desc: 'Tailored Silks & Cottons' },
              { name: 'Mobiles', label: 'Mobiles', icon: Smartphone, desc: 'Flagship Handsets' },
              { name: 'Electronics', label: 'Laptops', icon: Laptop, desc: 'Pro Computing' },
              { name: 'Beauty', label: 'Grooming', icon: Sparkles, desc: 'Pure Botanical Formulations' },
              { name: 'All', label: 'All Artifacts', icon: LayoutGrid, desc: 'Explore Complete Guild' },
            ].map((item) => {
              const IconComponent = item.icon;
              return (
                <button
                  key={item.name}
                  onClick={() => handleCategoryClick(item.name)}
                  className="p-4 rounded-2xl bg-white border border-stone-200/90 shadow-2xs hover:shadow-soft hover:border-burgundy/60 transition-all flex flex-col items-center text-center group cursor-pointer active:scale-[0.98]"
                >
                  <div className="w-11 h-11 rounded-xl bg-stone-50 border border-stone-200 group-hover:bg-burgundy group-hover:border-burgundy group-hover:text-white transition-all flex items-center justify-center text-burgundy mb-2.5 shadow-2xs">
                    <IconComponent className="w-5 h-5 transition-transform group-hover:scale-110" />
                  </div>
                  <span className="font-serif font-bold text-xs sm:text-sm text-stone-900 group-hover:text-burgundy transition-colors">
                    {item.label}
                  </span>
                  <span className="text-[10px] text-stone-500 mt-0.5 line-clamp-1">
                    {item.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── NEW ARRIVALS SECTION (HOMEPAGE MAIN SHOWCASE) ──────────── */}
        <section id="new-arrivals" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-stone-200/80 pb-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cream-100 border border-cream-300 text-[10px] font-bold uppercase tracking-widest text-stone-800 mb-1.5">
                <Sparkles className="w-3 h-3 text-burgundy" />
                <span>Fresh From The Guild</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-serif font-extrabold text-stone-900 tracking-tight">
                New Arrivals
              </h2>
              <p className="text-xs sm:text-sm text-stone-600 mt-1 max-w-xl">
                Recently verified signatures and bespoke items released direct from independent campus sellers.
              </p>
            </div>

            <Link
              to="/products?sort=newest"
              className="inline-flex items-center gap-1.5 text-xs font-serif font-bold text-burgundy hover:text-burgundy-800 transition-colors self-start sm:self-auto group"
            >
              <span>Explore All Releases</span>
              <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

          {isLoading && allProducts.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : newArrivals.length === 0 ? (
            <div className="py-12 text-center bg-stone-50/70 rounded-2xl border border-stone-200 text-stone-500 text-xs">
              No new arrivals found. Check back as campus artisans add new collections.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-4">
              {newArrivals.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onQuickView={(p) => setSelectedQuickViewProduct(p)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── TRENDING NOW SECTION: STRICTLY ADMIN APPROVED TOP 10 ITEMS ONLY ── */}
        {trendingApprovedProducts.length > 0 && (
          <section className="space-y-6 bg-gradient-to-b from-orange-50/30 to-transparent p-4 sm:p-6 rounded-3xl border border-orange-100/80 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-orange-200/60 pb-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-orange-100 border border-orange-200 text-[10px] font-bold uppercase tracking-widest text-orange-900 mb-1.5">
                  <Flame className="w-3 h-3 fill-orange-500 text-orange-600" />
                  <span>Curated & Most Coveted</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-serif font-extrabold text-stone-900 tracking-tight">
                  Trending Now
                </h2>
                <p className="text-xs sm:text-sm text-stone-600 mt-1 max-w-xl">
                  Top seller pieces and viral artisan signatures verified by administration for high customer acclaim.
                </p>
              </div>

              <Link
                to="/products?sort=featured"
                className="inline-flex items-center gap-1.5 text-xs font-serif font-bold text-orange-800 hover:text-orange-950 transition-colors self-start sm:self-auto group"
              >
                <span>View Full Gallery</span>
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-4">
              {trendingApprovedProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onQuickView={(p) => setSelectedQuickViewProduct(p)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── 3. WHITE-GLOVE COD PROTOCOL GUARANTEE ──────────────────── */}
        <section className="bg-stone-900 text-cream-100 rounded-3xl p-6 sm:p-10 border border-stone-800 shadow-xl overflow-hidden relative">
          <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center text-amber-300 shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-serif font-bold text-white text-sm">100% Cash on Delivery</h4>
                <p className="text-xs text-stone-400 mt-1 leading-relaxed">
                  Zero advance payment required. Inspect your order in person before handing cash to the courier.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center text-amber-300 shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-serif font-bold text-white text-sm">Verified Artisans</h4>
                <p className="text-xs text-stone-400 mt-1 leading-relaxed">
                  Every seller is identity-verified via college credentials and biometric authentication.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center text-amber-300 shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-serif font-bold text-white text-sm">7-Day Escrow Protection</h4>
                <p className="text-xs text-stone-400 mt-1 leading-relaxed">
                  Funds remain in administrative escrow for 7 days ensuring immediate return and refund coverage.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Quick View Modal */}
      <QuickViewModal
        isOpen={!!selectedQuickViewProduct}
        onClose={() => setSelectedQuickViewProduct(null)}
        product={selectedQuickViewProduct}
      />
    </div>
  );
};
