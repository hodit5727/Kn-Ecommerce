import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { productService } from '../../services/productService';
import { Product } from '../../types/product';
import { ErrorState } from '../../components/common/ErrorState';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { useToast } from '../../context/ToastContext';
import { formatINR } from '../../lib/currency';
import { getOptimizedImageUrl } from '../../lib/imageUrl';
import { SEOHead } from '../../components/seo/SEOHead';
import { formatProductCode } from '../../lib/dateFormat';

// Lazy-load Three.js components to avoid bundling 116 KiB vendor-three into the critical product path
const Product3DViewer = lazy(() =>
  import('../../components/3d/Product3DViewer').then((m) => ({ default: m.Product3DViewer }))
);
const InteriorVisualizerModal = lazy(() =>
  import('../../components/3d/InteriorVisualizerModal').then((m) => ({ default: m.InteriorVisualizerModal }))
);
import {
  Heart,
  ShoppingBag,
  Box,
  Image as ImageIcon,
  Compass,
  Star,
  Truck,
  RotateCcw,
  ShieldCheck,
  Store,
  Plus,
  Minus,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Zap,
  Share2,
  MapPin,
  HelpCircle,
  Sparkles,
  Maximize2,
  X,
} from 'lucide-react';

export const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeMediaTab, setActiveMediaTab] = useState<'photo' | '3d'>('photo');
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState<number>(0);
  const [quantity, setQuantity] = useState<number>(1);
  const [isInteriorModalOpen, setIsInteriorModalOpen] = useState<boolean>(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState<boolean>(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState<boolean>(false);
  const [pincode, setPincode] = useState<string>('641001');
  const [isPincodeChecked, setIsPincodeChecked] = useState<boolean>(true);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const { addToCart } = useCart();
  const { isInWishlist, toggleWishlist } = useWishlist();
  const { showToast } = useToast();

  const loadProduct = async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await productService.getProductById(id);
      setProduct(data);
    } catch (err: any) {
      setError(err.message || 'Unable to load product details. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProduct();
  }, [id]);

  const variants = useMemo(() => {
    return Array.isArray(product?.variants) && product!.variants.length > 0 ? product!.variants : [];
  }, [product]);

  const currentVariant = variants[selectedVariantIndex] || null;
  const currentStock = currentVariant ? currentVariant.stock : (product?.stock ?? 0);
  const currentPrice = currentVariant ? currentVariant.price : (product?.price ?? 0);
  const currentSku = currentVariant?.sku || product?.sku || '';
  const canonicalProductCode = useMemo(() => {
    if (product?.productCode) return product.productCode;
    return formatProductCode(currentSku || product?.sku, product?.id);
  }, [product, currentSku]);

  // Dynamic 2-Day Delivery Date (e.g. "Order today, delivered by Wed, 4 Nov")
  const deliveryInfo = useMemo(() => {
    const today = new Date();
    const deliveryDate = new Date(today);
    deliveryDate.setDate(today.getDate() + 2);

    const formattedDate = deliveryDate.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

    return {
      dateString: formattedDate,
      days: 2,
    };
  }, []);

  const displaySpecifications = useMemo(() => {
    if (!product) return [];
    const specs: { name: string; value: string }[] = [];
    const seen = new Set<string>();

    const addSpec = (name?: string, value?: any) => {
      if (!name || value === undefined || value === null) return;
      const cleanName = String(name).trim();
      const cleanVal = String(value).trim();
      if (!cleanName || !cleanVal || cleanVal.toLowerCase() === 'undefined' || cleanVal.toLowerCase() === 'null') return;
      const lowerKey = cleanName.toLowerCase();
      if (seen.has(lowerKey)) return;
      seen.add(lowerKey);
      specs.push({ name: cleanName, value: cleanVal });
    };

    // 1. Direct dynamic product specifications from database
    if (Array.isArray(product.specifications)) {
      for (const s of product.specifications) {
        if (s && typeof s === 'object') {
          addSpec(s.name, s.value);
        }
      }
    }

    // 2. Core attributes
    if (product.brand) addSpec('Brand', product.brand);
    if (product.category) addSpec('Category', product.category);
    addSpec('Product Code', canonicalProductCode);
    if (currentSku && currentSku !== canonicalProductCode) addSpec('Model / SKU', currentSku);
    if (product.material) addSpec('Material', product.material);

    // 3. Variant details if present
    if (currentVariant?.color) {
      addSpec('Color', currentVariant.color);
    } else if (Array.isArray(product.variants) && product.variants.length > 0) {
      const colors = Array.from(new Set(product.variants.map((v) => v.color).filter(Boolean)));
      if (colors.length > 0) addSpec('Available Colors', colors.join(', '));
      const sizes = Array.from(new Set(product.variants.map((v) => v.size).filter(Boolean)));
      if (sizes.length > 0) addSpec('Available Sizes', sizes.join(', '));
    }

    // 4. Stock availability for selected option
    if (currentStock !== undefined && currentStock >= 0) {
      addSpec('Available Stock', currentStock > 0 ? `${currentStock} Units Available` : 'Out of Stock');
    }

    // 5. Fallback: Parse key-value lines from description
    if (product.description) {
      const lines = product.description.split(/\r?\n|•|\*/);
      for (const line of lines) {
        const match = line.match(/^[\s\-–—]*([A-Za-z0-9\s/&()]{2,35})\s*[:=]\s*(.+)$/);
        if (match) {
          const k = match[1].trim();
          const v = match[2].trim().replace(/\.$/, '');
          if (k.length <= 35 && v.length > 0 && v.length < 150) {
            addSpec(k, v);
          }
        }
      }
    }

    return specs;
  }, [product, currentSku, canonicalProductCode, currentVariant, currentStock]);

  const dynamicFeatures = useMemo(() => {
    if (!product?.description) return [];
    const lines = product.description.split(/\r?\n/);
    const bullets: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^([•\-\*]|\d+\.)\s*(.+)$/);
      if (match && match[2].trim().length > 3) {
        bullets.push(match[2].trim());
      }
    }
    return bullets;
  }, [product?.description]);

  const inWishlist = product ? isInWishlist(product.id) : false;
  const isDescriptionLong = (product?.description || '').length > 350;

  const handleAddToCart = () => {
    if (!product) return;
    if (currentStock <= 0) {
      showToast('This item is currently out of stock.', 'error');
      return;
    }
    const productToOrder = currentVariant
      ? { ...product, price: currentPrice, stock: currentStock, sku: currentSku }
      : product;
    if (addToCart(productToOrder, quantity)) {
      showToast(`Added ${quantity} × ${product.name}${currentVariant?.color ? ` (${currentVariant.color})` : ''} to bag.`);
    }
  };

  const handleBuyNow = () => {
    if (!product) return;
    if (currentStock <= 0) {
      showToast('This item is currently out of stock.', 'error');
      return;
    }
    const productToOrder = currentVariant
      ? { ...product, price: currentPrice, stock: currentStock, sku: currentSku }
      : product;
    if (addToCart(productToOrder, quantity)) {
      navigate('/checkout');
    }
  };

  const handleShare = async () => {
    if (!product) return;
    const shareData = {
      title: `${product.name} | K-SHOP`,
      text: product.tagline || `Discover ${product.name} on K-Shop Sovereign Luxury Marketplace`,
      url: window.location.href,
    };
    if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          copyShareLink();
        }
      }
    } else {
      copyShareLink();
    }
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Product link copied to clipboard!');
    } catch {
      showToast('Unable to copy product link.', 'error');
    }
  };

  const nextImage = () => {
    if (!product || product.images.length <= 1) return;
    setActiveImageIndex((prev) => (prev + 1) % product.images.length);
  };

  const prevImage = () => {
    if (!product || product.images.length <= 1) return;
    setActiveImageIndex((prev) => (prev - 1 + product.images.length) % product.images.length);
  };

  const scrollToReviews = () => {
    const el = document.getElementById('ratings-reviews-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16">
        <ErrorState
          title="Product Unavailable"
          message={error}
          onRetry={loadProduct}
          isRetrying={isLoading}
        />
      </div>
    );
  }

  if (isLoading || !product) {
    return (
      <div className="min-h-screen bg-[#FFF9F2]/30 py-4 sm:py-8 pb-32 sm:pb-12" aria-busy="true" aria-label="Loading product details">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">
          <div className="flex items-center gap-2 py-1 overflow-hidden">
            <div className="h-4 w-12 bg-stone-200/80 rounded animate-pulse" />
            <div className="h-3 w-3 bg-stone-200/50 rounded animate-pulse" />
            <div className="h-4 w-16 bg-stone-200/80 rounded animate-pulse" />
            <div className="h-3 w-3 bg-stone-200/50 rounded animate-pulse" />
            <div className="h-4 w-44 sm:w-64 bg-stone-200/80 rounded animate-pulse" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
            <div className="lg:col-span-5 space-y-3">
              <div
                className="aspect-square w-full rounded-2xl bg-stone-200/70 border border-[#E8DCCF] animate-pulse"
                style={{ aspectRatio: '1 / 1' }}
              />
              <div className="h-[38px] w-full rounded-xl bg-white border border-[#E8DCCF] shadow-xs flex items-center justify-between px-4 animate-pulse">
                <div className="h-3 w-28 bg-stone-200/80 rounded" />
                <div className="h-3 w-20 bg-stone-200/80 rounded" />
              </div>
            </div>

            <div className="lg:col-span-7 bg-white rounded-2xl p-5 sm:p-6 lg:p-7 border border-[#E8DCCF] shadow-xs space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="h-3.5 w-24 bg-stone-200 rounded animate-pulse" />
                  <div className="h-5 w-16 bg-stone-100 rounded-full animate-pulse" />
                </div>
                <div className="h-7 w-4/5 bg-stone-200 rounded animate-pulse" />
                <div className="h-4 w-3/5 bg-stone-200/70 rounded animate-pulse" />
              </div>

              <div className="p-3.5 sm:p-4 rounded-xl bg-[#FFF9F2] border border-[#E8DCCF] space-y-2.5">
                <div className="h-8 w-36 bg-stone-200 rounded animate-pulse" />
                <div className="pt-2 border-t border-[#E8DCCF] flex items-center justify-between">
                  <div className="h-3 w-28 bg-stone-200/80 rounded animate-pulse" />
                  <div className="h-3 w-36 bg-stone-200/80 rounded animate-pulse" />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="h-8 w-28 rounded-lg bg-stone-100 border border-[#E8DCCF] animate-pulse" />
                  <div className="h-6 w-32 rounded-full bg-emerald-50 border border-emerald-200/60 animate-pulse" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div className="h-11 sm:h-12 rounded-xl bg-[#8F0025]/30 animate-pulse" />
                  <div className="h-11 sm:h-12 rounded-xl bg-stone-100 border-2 border-stone-200 animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const primaryImage = product.images[activeImageIndex] || product.images[0];
  const discountPercent = product.originalPrice && product.originalPrice > currentPrice
    ? Math.round(((product.originalPrice - currentPrice) / product.originalPrice) * 100)
    : 0;
  const savingsAmount = product.originalPrice && product.originalPrice > currentPrice
    ? product.originalPrice - currentPrice
    : 0;

  const productSchema: Record<string, any> = {
    '@type': 'Product',
    name: product.name,
    image: product.images,
    description: product.description || product.tagline || `${product.name} available at K-SHOP`,
    sku: canonicalProductCode || product.sku || product.id,
    brand: {
      '@type': 'Brand',
      name: product.brand || (product as any).store_name || 'K-SHOP Atelier',
    },
    offers: {
      '@type': 'Offer',
      url: typeof window !== 'undefined' ? window.location.href : `https://kn-ecommerce-production.up.railway.app/product/${product.id}`,
      priceCurrency: 'INR',
      price: currentPrice,
      priceValidUntil: '2027-12-31',
      availability: currentStock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  };

  const breadcrumbsSchema = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://kn-ecommerce-production.up.railway.app' },
      { '@type': 'ListItem', position: 2, name: 'Catalog', item: 'https://kn-ecommerce-production.up.railway.app/products' },
      { '@type': 'ListItem', position: 3, name: product.name, item: `https://kn-ecommerce-production.up.railway.app/product/${product.id}` },
    ],
  };

  return (
    <div className="min-h-screen bg-[#FFF9F2]/30 py-4 sm:py-8 pb-32 sm:pb-12">
      <SEOHead
        title={product.name}
        description={product.description?.slice(0, 155) || product.tagline || `Discover ${product.name} on K-SHOP Sovereign Marketplace.`}
        canonicalPath={`/product/${product.id}`}
        image={primaryImage}
        type="product"
        jsonLd={[productSchema, breadcrumbsSchema]}
      />

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 space-y-6">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-[#4E453E] overflow-x-auto whitespace-nowrap scrollbar-none py-1">
          <Link to="/" className="hover:text-[#8F0025] transition-colors shrink-0">Home</Link>
          <ChevronRight className="w-3 h-3 text-[#E8DCCF] shrink-0" />
          <Link to="/products" className="hover:text-[#8F0025] transition-colors shrink-0">Catalog</Link>
          {product.category && (
            <>
              <ChevronRight className="w-3 h-3 text-[#E8DCCF] shrink-0" />
              <Link to={`/products?category=${encodeURIComponent(product.category)}`} className="hover:text-[#8F0025] transition-colors shrink-0">
                {product.category}
              </Link>
            </>
          )}
          <ChevronRight className="w-3 h-3 text-[#E8DCCF] shrink-0" />
          <span className="text-[#171717] font-semibold truncate max-w-[160px] sm:max-w-md">
            {product.name}
          </span>
        </nav>

        {/* ── MAIN PRODUCT SHOWCASE (Flipkart Balanced Layout: 45% Gallery / 55% Info) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Left Column (45% on desktop): Media Stage & Gallery */}
          <div className="lg:col-span-5 space-y-3 lg:sticky lg:top-24">
            <div
              className="relative aspect-square w-full rounded-2xl overflow-hidden bg-white border border-[#E8DCCF] shadow-2xs group"
              style={{ aspectRatio: '1 / 1' }}
            >
              {activeMediaTab === '3d' ? (
                <Suspense
                  fallback={
                    <div className="w-full h-full flex flex-col items-center justify-center bg-[#FFF9F2]/50 gap-2">
                      <div className="w-8 h-8 rounded-full border-2 border-[#8F0025] border-t-transparent animate-spin" />
                      <span className="text-xs text-[#4E453E] font-semibold">Loading 3D Visualizer...</span>
                    </div>
                  }
                >
                  <Product3DViewer product={product} className="w-full h-full" autoRotate={true} />
                </Suspense>
              ) : (
                <>
                  <img
                    src={getOptimizedImageUrl(primaryImage, { width: 800, quality: 80 })}
                    srcSet={`${getOptimizedImageUrl(primaryImage, { width: 400, quality: 80 })} 400w, ${getOptimizedImageUrl(primaryImage, { width: 800, quality: 80 })} 800w, ${getOptimizedImageUrl(primaryImage, { width: 1200, quality: 85 })} 1200w`}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 550px"
                    alt={product.name}
                    width={600}
                    height={600}
                    fetchPriority="high"
                    decoding="async"
                    onClick={() => setIsLightboxOpen(true)}
                    className="absolute inset-0 w-full h-full object-cover cursor-zoom-in transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Previous / Next Navigation Arrows */}
                  {product.images.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={prevImage}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-stone-800 shadow-sm border border-[#E8DCCF] flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 sm:opacity-100 z-10"
                        aria-label="Previous image"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={nextImage}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-stone-800 shadow-sm border border-[#E8DCCF] flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 sm:opacity-100 z-10"
                        aria-label="Next image"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </>
              )}

              {/* Quick Share Button */}
              <button
                type="button"
                onClick={handleShare}
                className="absolute top-3 left-3 bg-white/95 backdrop-blur-xs p-2 rounded-xl text-[#4E453E] hover:text-[#8F0025] hover:bg-white shadow-sm border border-[#E8DCCF] z-10 transition-all flex items-center justify-center active:scale-95"
                aria-label="Share product"
                title="Share this product"
              >
                <Share2 className="w-4 h-4 text-[#8F0025]" />
              </button>

              {/* Quick Lightbox Zoom Button */}
              <button
                type="button"
                onClick={() => setIsLightboxOpen(true)}
                className="absolute top-3 left-12 bg-white/95 backdrop-blur-xs p-2 rounded-xl text-[#4E453E] hover:text-[#8F0025] hover:bg-white shadow-sm border border-[#E8DCCF] z-10 transition-all flex items-center justify-center active:scale-95 hidden sm:flex"
                aria-label="Zoom in"
                title="Expand image"
              >
                <Maximize2 className="w-4 h-4 text-stone-700" />
              </button>

              {/* Mobile Image Counter Badge */}
              {product.images.length > 1 && (
                <div className="absolute bottom-3 right-3 bg-stone-900/70 backdrop-blur-xs text-white px-2 py-0.5 rounded-full text-[10px] font-mono font-bold z-10">
                  {activeImageIndex + 1} / {product.images.length}
                </div>
              )}

              {/* Media Mode Switcher (2D / 3D) */}
              <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-xs p-1 rounded-xl flex gap-1 shadow-sm border border-[#E8DCCF] z-10">
                <button
                  type="button"
                  onClick={() => setActiveMediaTab('photo')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    activeMediaTab === 'photo'
                      ? 'bg-[#8F0025] text-white shadow-xs'
                      : 'text-[#4E453E] hover:bg-[#FFF9F2]'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" /> Photos
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMediaTab('3d')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    activeMediaTab === '3d'
                      ? 'bg-[#8F0025] text-white shadow-xs'
                      : 'text-[#4E453E] hover:bg-[#FFF9F2]'
                  }`}
                >
                  <Box className="w-3.5 h-3.5" /> 3D View
                </button>
              </div>

              {/* Spatial Visualizer Trigger */}
              <button
                type="button"
                onClick={() => setIsInteriorModalOpen(true)}
                className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-xs px-3 py-1.5 rounded-lg text-xs font-semibold text-[#171717] hover:bg-white hover:text-[#8F0025] transition-all flex items-center gap-1.5 shadow-sm border border-[#E8DCCF]"
              >
                <Compass className="w-3.5 h-3.5 text-[#8F0025]" />
                <span>Visualize in Space</span>
              </button>
            </div>

            {/* Photo Gallery Thumbnails */}
            {activeMediaTab === 'photo' && product.images.length > 1 && (
              <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
                {product.images.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveImageIndex(idx)}
                    className={`w-16 h-16 rounded-xl overflow-hidden border transition-all shrink-0 ${
                      activeImageIndex === idx
                        ? 'border-[#8F0025] ring-2 ring-[#8F0025]/20 shadow-xs scale-105'
                        : 'border-[#E8DCCF] opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={getOptimizedImageUrl(img, { width: 128, height: 128, quality: 75 })}
                      alt=""
                      width={64}
                      height={64}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Stock Count Banner under Image */}
            <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-white border border-[#E8DCCF] shadow-xs text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${currentStock <= 0 ? 'bg-rose-500' : currentStock <= 5 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                <span className="text-[#4E453E] font-semibold">Campus Stock:</span>
              </div>
              <span className={`font-bold ${currentStock <= 0 ? 'text-rose-700' : currentStock <= 5 ? 'text-amber-800' : 'text-emerald-700'}`}>
                {currentStock > 0
                  ? (currentStock <= 5 ? `Only ${currentStock} left in stock!` : `${currentStock} Units Available`)
                  : 'Out of Stock'}
              </span>
            </div>
          </div>

          {/* Right Column (55% on desktop): Flipkart-Flow Product Information */}
          <div className="lg:col-span-7 bg-white rounded-2xl p-5 sm:p-6 lg:p-7 border border-[#E8DCCF] shadow-xs space-y-5">
            {/* 1. Brand & Seller Badge + Rating */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-[#8F0025]">
                    {product.brand || product.sellerName || 'PRADEEP STORE'}
                  </span>
                  <span className="text-[#E8DCCF]">•</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4E453E]">
                    {product.category || 'Atelier'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#855A00] bg-[#FFF9F2] border border-[#855A00]/30 px-1.5 py-0.5 rounded-full">
                    <ShieldCheck className="w-2.5 h-2.5 text-[#855A00]" /> Verified Partner
                  </span>
                </div>

                {/* Rating Badge with Review Scroll Trigger */}
                <button
                  type="button"
                  onClick={scrollToReviews}
                  className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FFF9F2] hover:bg-cream-100 border border-[#E8DCCF] text-[11px] font-semibold transition-colors"
                >
                  <Star className="w-3 h-3 text-[#855A00] fill-[#855A00]" />
                  <span className="text-[#171717] font-bold">
                    {product.rating ? Number(product.rating).toFixed(1) : '5.0'}
                  </span>
                  <span className="text-[#4E453E] underline">({product.reviewCount || 0} reviews)</span>
                </button>
              </div>

              {/* 2. Product Title */}
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-serif font-bold text-[#171717] tracking-tight leading-snug">
                {product.name}
              </h1>

              {product.tagline && product.tagline !== product.name && (
                <p className="text-xs sm:text-sm text-[#4E453E] mt-1 font-medium">
                  {product.tagline}
                </p>
              )}
            </div>

            {/* 3. Price & Discount with Savings */}
            <div className="p-4 rounded-xl bg-[#FFF9F2] border border-[#E8DCCF] space-y-3">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-2xl sm:text-3xl font-serif font-bold text-[#171717]">
                  {formatINR(currentPrice)}
                </span>
                {product.originalPrice && product.originalPrice > currentPrice && (
                  <>
                    <span className="text-sm text-[#4E453E] line-through font-mono">
                      {formatINR(product.originalPrice)}
                    </span>
                    <span className="text-xs font-bold bg-[#8F0025]/10 text-[#8F0025] px-2 py-0.5 rounded-full border border-[#8F0025]/20 font-mono">
                      {discountPercent}% OFF
                    </span>
                  </>
                )}
              </div>

              {savingsAmount > 0 && (
                <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  <span>You save {formatINR(savingsAmount)} on this item</span>
                </p>
              )}

              <div className="pt-2.5 border-t border-[#E8DCCF] flex items-center justify-between text-xs flex-wrap gap-2">
                <span className="text-[#4E453E] font-semibold uppercase tracking-wider text-[10px]">
                  Payment Protocol:
                </span>
                <span className="font-bold text-[#8F0025] flex items-center gap-1 text-xs">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#8F0025]" /> Cash on Delivery (COD) Only
                </span>
              </div>
            </div>

            {/* 4. Flipkart Value Propositions / Offers */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-white border border-[#E8DCCF] flex flex-col items-center text-center gap-1">
                <Truck className="w-4 h-4 text-[#8F0025]" />
                <span className="font-bold text-[#171717] text-[11px]">Free Delivery</span>
                <span className="text-[10px] text-[#4E453E]">Within 2 Days</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-[#E8DCCF] flex flex-col items-center text-center gap-1">
                <RotateCcw className="w-4 h-4 text-[#8F0025]" />
                <span className="font-bold text-[#171717] text-[11px]">7 Days Return</span>
                <span className="text-[10px] text-[#4E453E]">Easy Replacement</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-[#E8DCCF] flex flex-col items-center text-center gap-1">
                <ShieldCheck className="w-4 h-4 text-[#8F0025]" />
                <span className="font-bold text-[#171717] text-[11px]">COD Only</span>
                <span className="text-[10px] text-[#4E453E]">Pay On Delivery</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-[#E8DCCF] flex flex-col items-center text-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-[#8F0025]" />
                <span className="font-bold text-[#171717] text-[11px]">100% Genuine</span>
                <span className="text-[10px] text-[#4E453E]">Direct from Seller</span>
              </div>
            </div>

            {/* 5. Dynamic Variant Selection (Interactive Options) */}
            {variants.length > 1 && (
              <div className="space-y-2 p-3.5 rounded-xl bg-[#FFF9F2]/70 border border-[#E8DCCF]">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#4E453E] uppercase tracking-wider text-[10px]">
                    Available Options / Colors:
                  </span>
                  <span className="font-bold text-[#8F0025]">
                    {currentVariant?.color || currentVariant?.size || `Option ${selectedVariantIndex + 1}`}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {variants.map((v, idx) => {
                    const isSelected = selectedVariantIndex === idx;
                    const label = v.color || v.size || `Option ${idx + 1}`;
                    const isOutOfStock = (v.stock ?? 0) <= 0;

                    return (
                      <button
                        key={v.id || idx}
                        type="button"
                        onClick={() => {
                          setSelectedVariantIndex(idx);
                          setQuantity(1);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-2 ${
                          isSelected
                            ? 'bg-[#8F0025] text-white border-[#8F0025] shadow-xs ring-1 ring-[#8F0025]'
                            : isOutOfStock
                            ? 'bg-stone-50 text-stone-400 border-stone-200 hover:border-stone-300'
                            : 'bg-white text-[#171717] border-[#E8DCCF] hover:border-[#8F0025]/50'
                        }`}
                      >
                        <span>{label}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold font-mono ${
                            isSelected
                              ? 'bg-white/20 text-white'
                              : isOutOfStock
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-stone-100 text-stone-600'
                          }`}
                        >
                          {v.stock} left
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 6. Quantity Selector & Stock Status */}
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#4E453E]">
                    Quantity:
                  </span>
                  <div className="flex items-center border border-[#E8DCCF] rounded-lg bg-white shadow-xs">
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      disabled={currentStock <= 0 || quantity <= 1}
                      className="p-1.5 text-[#171717] hover:bg-[#FFF9F2] rounded-l-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-3 text-xs font-bold text-[#171717] font-mono">
                      {currentStock <= 0 ? 0 : quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.min(currentStock, quantity + 1))}
                      disabled={currentStock <= 0 || quantity >= currentStock}
                      className="p-1.5 text-[#171717] hover:bg-[#FFF9F2] rounded-r-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Increase quantity"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Stock Status Badge */}
                <div>
                  {currentStock > 0 ? (
                    currentStock <= 5 ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Hurry, only {currentStock} left in stock!
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {currentStock} in campus stock
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                      Out of Stock
                    </span>
                  )}
                </div>
              </div>

              {/* 7. Delivery Location / 2-Day Pincode Checker */}
              <div className="p-3.5 rounded-xl bg-[#FFF9F2]/70 border border-[#E8DCCF] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#4E453E] uppercase tracking-wider text-[10px] flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-[#8F0025]" /> Campus Delivery Check
                  </span>
                  <span className="text-[10px] text-stone-500">COD Campus Network</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={pincode}
                    maxLength={6}
                    onChange={(e) => {
                      setPincode(e.target.value.replace(/\D/g, ''));
                      setIsPincodeChecked(false);
                    }}
                    placeholder="Enter 6-digit Pincode"
                    className="flex-1 px-3 py-1.5 bg-white border border-[#E8DCCF] rounded-lg text-xs font-mono focus:outline-none focus:border-[#8F0025]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (pincode.length >= 6) {
                        setIsPincodeChecked(true);
                        showToast(`Delivery available for ${pincode}`);
                      } else {
                        showToast('Please enter a valid 6-digit pincode', 'error');
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#8F0025] text-white text-xs font-bold hover:bg-[#72001e] transition-colors"
                  >
                    Check
                  </button>
                </div>
                {isPincodeChecked && (
                  <p className="text-xs text-stone-700 flex items-center gap-1.5 pt-1">
                    <Truck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>
                      Delivery by <strong>{deliveryInfo.dateString}</strong> (2-Day Delivery) | <strong className="text-emerald-700">Free</strong>
                    </span>
                  </p>
                )}
              </div>

              {/* 8. Action Buttons (Add to Cart & Buy Now COD) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={currentStock <= 0}
                  className={`h-11 sm:h-12 px-4 rounded-xl font-bold tracking-wider uppercase text-xs sm:text-sm flex items-center justify-center gap-2 transition-all ${
                    currentStock <= 0
                      ? 'bg-stone-200 text-stone-400 border border-stone-200 cursor-not-allowed'
                      : 'bg-[#8F0025] hover:bg-[#72001e] text-white shadow-sm hover:shadow'
                  }`}
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>{currentStock <= 0 ? 'Out of Stock' : 'Add to Bag'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleBuyNow}
                  disabled={currentStock <= 0}
                  className={`h-11 sm:h-12 px-4 rounded-xl font-bold tracking-wider uppercase text-xs sm:text-sm flex items-center justify-center gap-2 transition-all ${
                    currentStock <= 0
                      ? 'bg-stone-100 text-stone-400 border-2 border-stone-200 cursor-not-allowed shadow-none'
                      : 'bg-[#FFF9F2] hover:bg-[#F9ECE0] text-[#171717] border-2 border-[#8F0025] shadow-xs active:scale-[0.99]'
                  }`}
                >
                  <Zap className={`w-4 h-4 ${currentStock <= 0 ? 'text-stone-300' : 'text-[#8F0025]'}`} />
                  <span>{currentStock <= 0 ? 'Unavailable' : 'Buy Now (COD)'}</span>
                </button>
              </div>

              {/* 9. Wishlist & Share Action Row */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => toggleWishlist(product.id)}
                  className={`flex-1 h-10 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                    inWishlist
                      ? 'bg-rose-50 border-rose-200 text-[#8F0025]'
                      : 'border-[#E8DCCF] bg-white text-[#171717] hover:bg-[#FFF9F2]'
                  }`}
                >
                  <Heart className={`w-3.5 h-3.5 ${inWishlist ? 'fill-[#8F0025] text-[#8F0025]' : 'text-[#4E453E]'}`} />
                  <span>{inWishlist ? 'Saved in Wishlist' : 'Add to Wishlist'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleShare}
                  className="flex-1 h-10 rounded-xl border border-[#E8DCCF] bg-white text-[#171717] hover:bg-[#FFF9F2] text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-2xs active:scale-[0.98]"
                  aria-label="Share product"
                >
                  <Share2 className="w-3.5 h-3.5 text-[#8F0025]" />
                  <span>Share Product</span>
                </button>
              </div>
            </div>

            {/* 10. Verified Seller Information Card */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-[#FFF9F2]/70 border border-[#E8DCCF] space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white border border-[#E8DCCF] flex items-center justify-center text-[#8F0025] shadow-xs shrink-0">
                    <Store className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] uppercase font-bold text-[#4E453E] tracking-wider">
                        Authorized Seller
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#855A00] bg-white border border-[#855A00]/40 px-1.5 py-0.5 rounded-full">
                        <ShieldCheck className="w-2.5 h-2.5 text-[#855A00]" /> Verified Partner
                      </span>
                    </div>
                    <h4 className="font-serif font-bold text-[#171717] text-sm sm:text-base">
                      {product.sellerName || 'PRADEEP STORE'}
                    </h4>
                    <div className="flex items-center gap-2 text-[11px] text-[#4E453E] mt-0.5 flex-wrap">
                      <span className="font-mono text-stone-600">ID: <strong>KNSR-4494</strong></span>
                      <span className="flex items-center gap-1 text-[#855A00] font-semibold">
                        <Star className="w-2.5 h-2.5 fill-[#855A00]" /> {product.sellerRating ? Number(product.sellerRating).toFixed(1) : '5.0'}
                      </span>
                    </div>
                  </div>
                </div>

                {product.sellerId && (
                  <Link
                    to={`/products?sellerId=${encodeURIComponent(product.sellerId)}`}
                    className="px-3 py-1.5 rounded-lg bg-white border border-[#E8DCCF] text-[11px] font-bold text-[#8F0025] hover:bg-[#FFF9F2] hover:border-[#8F0025] transition-all flex items-center gap-1 shadow-xs shrink-0"
                  >
                    <span>View Store</span>
                    <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── EXPANDABLE SECTIONS BELOW (Flipkart Style) ── */}

        {/* 1. Product Highlights & Key Features */}
        {dynamicFeatures.length > 0 && (
          <div className="bg-white rounded-2xl p-5 sm:p-7 border border-[#E8DCCF] shadow-xs space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#8F0025] block">
              Highlights
            </span>
            <h2 className="text-lg sm:text-xl font-serif font-bold text-[#171717]">
              Product Highlights
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              {dynamicFeatures.map((feat, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs sm:text-sm text-[#171717]">
                  <CheckCircle2 className="w-4 h-4 text-[#8F0025] shrink-0 mt-0.5" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 2. Product Description */}
        <div className="bg-white rounded-2xl p-5 sm:p-7 border border-[#E8DCCF] shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E8DCCF] flex-wrap gap-2">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#8F0025] block mb-0.5">
                Overview
              </span>
              <h2 className="text-lg sm:text-xl font-serif font-bold text-[#171717]">
                Product Description
              </h2>
            </div>
            {product.category && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#FFF9F2] text-[#4E453E] border border-[#E8DCCF]">
                {product.category}
              </span>
            )}
          </div>

          <div className="text-xs sm:text-sm text-[#171717] leading-relaxed whitespace-pre-line font-normal">
            {isDescriptionLong && !isDescriptionExpanded
              ? `${product.description.slice(0, 360)}...`
              : (product.description || 'No detailed description available for this product.')}
          </div>

          {isDescriptionLong && (
            <div>
              <button
                type="button"
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#8F0025] hover:underline transition-colors"
              >
                <span>{isDescriptionExpanded ? 'Read Less' : 'Read Full Description'}</span>
                {isDescriptionExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* 3. Specifications Table Frame */}
        {displaySpecifications.length > 0 && (
          <div className="bg-white rounded-2xl p-5 sm:p-7 border border-[#E8DCCF] shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#E8DCCF]">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#8F0025] block mb-0.5">
                  Technical Specifications
                </span>
                <h2 className="text-lg sm:text-xl font-serif font-bold text-[#171717]">
                  Product Details & Specifications
                </h2>
              </div>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#FFF9F2] text-[#8F0025] border border-[#E8DCCF] self-start sm:self-auto font-mono">
                {displaySpecifications.length} Specifications
              </span>
            </div>

            <div className="border border-[#E8DCCF] rounded-xl overflow-hidden shadow-xs bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#FFF9F2] border-b border-[#E8DCCF]">
                      <th className="py-2.5 sm:py-3 px-3.5 sm:px-4 text-[11px] font-bold uppercase tracking-wider text-[#4E453E] w-2/5 sm:w-1/3 border-r border-[#E8DCCF]">
                        Specification Parameter
                      </th>
                      <th className="py-2.5 sm:py-3 px-3.5 sm:px-4 text-[11px] font-bold uppercase tracking-wider text-[#4E453E]">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DCCF] text-xs sm:text-sm font-mono">
                    {displaySpecifications.map((spec, i) => (
                      <tr
                        key={i}
                        className="odd:bg-white even:bg-[#FFF9F2]/40 hover:bg-[#FFF9F2] transition-colors"
                      >
                        <td className="py-2.5 sm:py-3 px-3.5 sm:px-4 font-semibold text-[#171717] uppercase tracking-wide text-xs border-r border-[#E8DCCF] bg-[#FFF9F2]/20 font-sans">
                          {spec.name}
                        </td>
                        <td className="py-2.5 sm:py-3 px-3.5 sm:px-4 text-[#171717] font-medium text-xs sm:text-sm">
                          {spec.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 4. Flipkart-Style Ratings & Customer Reviews Breakdown */}
        <div id="ratings-reviews-section" className="bg-white rounded-2xl p-5 sm:p-7 border border-[#E8DCCF] shadow-xs space-y-5">
          <div className="border-b border-[#E8DCCF] pb-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#8F0025] block mb-0.5">
              Verified Feedback
            </span>
            <h2 className="text-lg sm:text-xl font-serif font-bold text-[#171717]">
              Ratings & Customer Reviews
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            {/* Overall Score */}
            <div className="md:col-span-4 p-5 rounded-2xl bg-[#FFF9F2] border border-[#E8DCCF] text-center space-y-2">
              <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#8F0025] text-white font-bold text-xl">
                <span>{product.rating ? Number(product.rating).toFixed(1) : '5.0'}</span>
                <Star className="w-5 h-5 fill-amber-300 text-amber-300" />
              </div>
              <p className="text-xs text-[#4E453E] font-medium">
                Based on verified campus Cash on Delivery orders
              </p>
              <p className="text-[11px] text-stone-500 font-mono">
                100% Verified Buyers
              </p>
            </div>

            {/* 5-Star Distribution Breakdown */}
            <div className="md:col-span-8 space-y-2 text-xs">
              {[
                { stars: 5, pct: 100 },
                { stars: 4, pct: 0 },
                { stars: 3, pct: 0 },
                { stars: 2, pct: 0 },
                { stars: 1, pct: 0 },
              ].map((row) => (
                <div key={row.stars} className="flex items-center gap-3">
                  <span className="w-8 text-stone-600 font-bold flex items-center gap-0.5">
                    {row.stars} <Star className="w-3 h-3 text-[#855A00] fill-[#855A00]" />
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-stone-100 overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-stone-500 font-mono">{row.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 5. Customer Questions & Answers (Campus COD FAQ) */}
        <div className="bg-white rounded-2xl p-5 sm:p-7 border border-[#E8DCCF] shadow-xs space-y-4">
          <div className="border-b border-[#E8DCCF] pb-3 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#8F0025] block mb-0.5">
                Support & FAQs
              </span>
              <h2 className="text-lg sm:text-xl font-serif font-bold text-[#171717]">
                Customer Questions & Answers
              </h2>
            </div>
            <HelpCircle className="w-5 h-5 text-[#8F0025]" />
          </div>

          <div className="divide-y divide-[#E8DCCF]">
            {[
              {
                q: 'How does Cash on Delivery (COD) work on K-Shop?',
                a: 'You pay 100% cash in hand directly to our campus delivery executive upon receiving and inspecting the physical package. There are no online advance payment gateways.',
              },
              {
                q: 'When will this product be delivered?',
                a: `All campus orders are fulfilled within 2 days. If ordered today, this item will be delivered by ${deliveryInfo.dateString}.`,
              },
              {
                q: 'What is the return and replacement policy?',
                a: 'This product includes a 7-day replacement guarantee. If there is any defect or mismatch, you can request an instant return/replacement through your order history.',
              },
              {
                q: 'Are all products authentic?',
                a: 'Yes, every product on K-Shop is handcrafted and directly fulfilled by accredited campus partner sellers under admin quality inspection.',
              },
            ].map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div key={idx} className="py-3">
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between text-left text-xs sm:text-sm font-semibold text-[#171717] hover:text-[#8F0025] transition-colors"
                  >
                    <span>Q: {faq.q}</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-[#8F0025]" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
                  </button>
                  {isOpen && (
                    <p className="mt-2 text-xs sm:text-sm text-[#4E453E] leading-relaxed pl-4 border-l-2 border-[#8F0025]">
                      {faq.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Spatial Visualizer Modal (Lazy-Loaded) */}
        {isInteriorModalOpen && (
          <Suspense fallback={null}>
            <InteriorVisualizerModal
              isOpen={isInteriorModalOpen}
              onClose={() => setIsInteriorModalOpen(false)}
              product={product}
            />
          </Suspense>
        )}

        {/* Lightbox Zoom Modal */}
        {isLightboxOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
            onClick={() => setIsLightboxOpen(false)}
          >
            <div className="relative max-w-4xl max-h-[90vh] w-full flex items-center justify-center">
              <button
                type="button"
                onClick={() => setIsLightboxOpen(false)}
                className="absolute -top-12 right-0 p-2 text-white/80 hover:text-white transition-colors"
                aria-label="Close fullscreen"
              >
                <X className="w-6 h-6" />
              </button>
              <img
                src={getOptimizedImageUrl(primaryImage, { width: 1400, quality: 90 })}
                alt={product.name}
                className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── MOBILE BOTTOM STICKY ACTION BAR (Flipkart Style Flush to Bottom) ── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-[#E8DCCF] shadow-[0_-4px_20px_rgba(0,0,0,0.08)] sm:hidden px-3.5 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-2.5"
      >
        <div className="shrink-0">
          <span className="text-[10px] uppercase font-bold text-[#4E453E] block leading-tight">
            Total Price
          </span>
          <span className="text-lg font-serif font-bold text-[#171717] leading-none">
            {formatINR(currentPrice * quantity)}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-1 justify-end">
          <button
            type="button"
            onClick={handleShare}
            className="p-2.5 rounded-xl border border-[#E8DCCF] bg-white text-[#4E453E] hover:text-[#8F0025] active:bg-[#FFF9F2] transition-colors shrink-0"
            aria-label="Share product"
            title="Share"
          >
            <Share2 className="w-4 h-4 text-[#8F0025]" />
          </button>

          <button
            type="button"
            onClick={handleAddToCart}
            disabled={currentStock <= 0}
            className={`px-3.5 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1 transition-colors ${
              currentStock <= 0
                ? 'bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed'
                : 'border-[#8F0025] text-[#8F0025] bg-white active:bg-[#8F0025]/5'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>{currentStock <= 0 ? 'Out of Stock' : 'Bag'}</span>
          </button>

          <button
            type="button"
            onClick={handleBuyNow}
            disabled={currentStock <= 0}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all ${
              currentStock <= 0
                ? 'bg-stone-200 text-stone-400 cursor-not-allowed shadow-none'
                : 'bg-[#8F0025] hover:bg-[#72001e] text-white shadow-2xs active:scale-[0.98]'
            }`}
          >
            <Zap className={`w-3.5 h-3.5 ${currentStock <= 0 ? 'text-stone-300' : 'fill-amber-300 text-amber-300'}`} />
            <span>{currentStock <= 0 ? 'Unavailable' : 'Buy COD'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
