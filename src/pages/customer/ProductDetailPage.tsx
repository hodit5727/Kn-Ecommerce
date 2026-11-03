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
import { ProductCard } from '../../components/product/ProductCard';

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
  Sparkles,
  Maximize2,
  X,
  FileText,
  Sliders,
} from 'lucide-react';

export const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [recommendedProducts, setRecommendedProducts] = useState<Product[]>([]);
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

  // Flipkart-style "All details" card state
  const [isAllDetailsOpen, setIsAllDetailsOpen] = useState<boolean>(true);
  const [activeDetailTab, setActiveDetailTab] = useState<'specifications' | 'description' | 'policies'>('specifications');

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

      // Fetch genuine recommended products in the same category
      if (data?.category) {
        productService
          .getProducts({ category: data.category })
          .then((catalog) => {
            const related = (catalog || [])
              .filter((p) => p.id !== data.id)
              .slice(0, 4);
            setRecommendedProducts(related);
          })
          .catch(() => {
            setRecommendedProducts([]);
          });
      }
    } catch (err: any) {
      setError(err.message || 'Unable to load product details. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProduct();
    // Scroll to top on navigation to a new product
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // Dynamic 2-Day Delivery Date calculation
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

    // 2. Core attributes (matching Flipkart's General Specifications layout)
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
      addSpec('Available Stock', currentStock > 0 ? `${currentStock} Units` : 'Out of Stock');
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
  const isDescriptionLong = (product?.description || '').length > 320;

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

  const hasGenuineRating = typeof product.rating === 'number' && product.rating > 0;

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

  if (hasGenuineRating && product.reviewCount && product.reviewCount > 0) {
    productSchema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.rating,
      reviewCount: product.reviewCount,
    };
  }

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

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 space-y-8">
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

        {/* ── FLIPKART LANDSCAPE 2-COLUMN SHOWCASE (Image 2 Reference) ── */}
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

            {/* Campus Stock Status Banner under Image */}
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

          {/* Right Column (55% on desktop): THE ALL-IN-ONE CARD ("Orey Card") */}
          <div className="lg:col-span-7 bg-white rounded-2xl p-5 sm:p-6 lg:p-7 border border-[#E8DCCF] shadow-xs space-y-5">
            {/* 1. Header: Brand, Category, Honest Rating (Zero Fake Numbers) */}
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

                {/* Honest Rating: Only render if genuine rating exists in database */}
                {hasGenuineRating ? (
                  <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FFF9F2] border border-[#E8DCCF] text-[11px] font-semibold">
                    <Star className="w-3 h-3 text-[#855A00] fill-[#855A00]" />
                    <span className="text-[#171717] font-bold">
                      {Number(product.rating).toFixed(1)}
                    </span>
                    {product.reviewCount && product.reviewCount > 0 && (
                      <span className="text-[#4E453E]">({product.reviewCount})</span>
                    )}
                  </div>
                ) : (
                  <span className="text-[11px] font-semibold text-stone-500 bg-[#FFF9F2] px-2 py-0.5 rounded-full border border-[#E8DCCF]">
                    No ratings yet
                  </span>
                )}
              </div>

              {/* Product Title */}
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-serif font-bold text-[#171717] tracking-tight leading-snug">
                {product.name}
              </h1>

              {product.tagline && product.tagline !== product.name && (
                <p className="text-xs sm:text-sm text-[#4E453E] mt-1 font-medium">
                  {product.tagline}
                </p>
              )}
            </div>

            {/* 2. Price & Discount with Savings */}
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

            {/* 3. Flipkart Value Propositions / Offers */}
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
                <span className="text-[10px] text-[#4E453E]">Pay In Hand</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-[#E8DCCF] flex flex-col items-center text-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-[#8F0025]" />
                <span className="font-bold text-[#171717] text-[11px]">100% Genuine</span>
                <span className="text-[10px] text-[#4E453E]">Direct from Seller</span>
              </div>
            </div>

            {/* 4. Dynamic Variant Selection (Interactive Options) */}
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

            {/* 5. Delivery Location / 2-Day Pincode Checker */}
            <div className="p-3.5 rounded-xl bg-[#FFF9F2]/70 border border-[#E8DCCF] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#4E453E] uppercase tracking-wider text-[10px] flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-[#8F0025]" /> Campus Delivery Check
                </span>
                <span className="text-[10px] text-stone-500">COD Campus Hub</span>
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
                      showToast(`Delivery verified for ${pincode}`);
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
                <p className="text-xs text-stone-700 flex items-center gap-1.5 pt-0.5">
                  <Truck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>
                    Delivery by <strong>{deliveryInfo.dateString}</strong> (within 2 days) | <strong className="text-emerald-700">Free</strong>
                  </span>
                </p>
              )}
            </div>

            {/* 6. FLIPKART-STYLE "ALL DETAILS" ACCORDION (Exact Reference from Image 2) */}
            <div className="rounded-xl border border-[#E8DCCF] overflow-hidden bg-white shadow-2xs">
              <button
                type="button"
                onClick={() => setIsAllDetailsOpen(!isAllDetailsOpen)}
                className="w-full p-4 flex items-center justify-between text-left bg-stone-50/70 hover:bg-stone-50 transition-colors border-b border-[#E8DCCF]"
              >
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[#8F0025]" />
                  <span className="font-serif font-bold text-stone-900 text-sm sm:text-base">
                    All details
                  </span>
                </div>
                {isAllDetailsOpen ? (
                  <ChevronUp className="w-4 h-4 text-stone-600" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-stone-600" />
                )}
              </button>

              {isAllDetailsOpen && (
                <div className="p-4 space-y-4">
                  {/* Tab Pills (Specifications | Description | Policies) */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                    <button
                      type="button"
                      onClick={() => setActiveDetailTab('specifications')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        activeDetailTab === 'specifications'
                          ? 'bg-stone-900 text-white shadow-xs'
                          : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                      }`}
                    >
                      Specifications
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDetailTab('description')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        activeDetailTab === 'description'
                          ? 'bg-stone-900 text-white shadow-xs'
                          : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                      }`}
                    >
                      Description
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDetailTab('policies')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        activeDetailTab === 'policies'
                          ? 'bg-stone-900 text-white shadow-xs'
                          : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                      }`}
                    >
                      Policies & Seller
                    </button>
                  </div>

                  {/* Tab Content 1: General Specifications (Two-Column Key-Value Layout as in Image 2) */}
                  {activeDetailTab === 'specifications' && (
                    <div className="space-y-3 pt-1">
                      <span className="text-[11px] font-bold text-stone-900 uppercase tracking-wider block">
                        General
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-xs divide-y sm:divide-y-0 divide-stone-100">
                        {displaySpecifications.map((spec, i) => (
                          <div key={i} className="pt-2 sm:pt-0">
                            <span className="text-stone-400 block text-[10px] uppercase font-semibold">
                              {spec.name}
                            </span>
                            <span className="text-stone-900 font-medium font-mono text-xs break-words">
                              {spec.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tab Content 2: Product Description */}
                  {activeDetailTab === 'description' && (
                    <div className="space-y-3 pt-1 text-xs text-stone-800 leading-relaxed">
                      <div className="whitespace-pre-line font-normal">
                        {isDescriptionLong && !isDescriptionExpanded
                          ? `${product.description.slice(0, 320)}...`
                          : (product.description || 'No detailed description available for this item.')}
                      </div>

                      {isDescriptionLong && (
                        <button
                          type="button"
                          onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#8F0025] hover:underline"
                        >
                          <span>{isDescriptionExpanded ? 'Read Less' : 'Read Full Description'}</span>
                          {isDescriptionExpanded ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                      )}

                      {/* Key Features Bullet points */}
                      {dynamicFeatures.length > 0 && (
                        <div className="pt-3 border-t border-stone-100 space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block">
                            Highlights
                          </span>
                          <ul className="space-y-1">
                            {dynamicFeatures.map((feat, idx) => (
                              <li key={idx} className="flex items-start gap-1.5 text-xs text-stone-800">
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#8F0025] shrink-0 mt-0.5" />
                                <span>{feat}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab Content 3: Policies & Verified Seller */}
                  {activeDetailTab === 'policies' && (
                    <div className="space-y-3 pt-1 text-xs text-stone-800">
                      <div className="p-3 rounded-lg bg-stone-50 border border-stone-200/80 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-stone-900">{product.sellerName || 'PRADEEP STORE'}</span>
                          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-bold border border-emerald-200">
                            Verified Seller
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-500">
                          Accredited campus marketplace partner seller.
                        </p>
                      </div>

                      <div className="space-y-2 pt-1">
                        <div className="flex items-start gap-2">
                          <Truck className="w-4 h-4 text-[#8F0025] shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold text-stone-900 block">Campus Fulfillment Hub</span>
                            <span className="text-stone-500 text-[11px]">Direct handover with 2-day delivery across campus.</span>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <RotateCcw className="w-4 h-4 text-[#8F0025] shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold text-stone-900 block">7-Day Replacement Policy</span>
                            <span className="text-stone-500 text-[11px]">Instant replacement request through your customer order timeline.</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 7. Quantity Selector & Out-of-Stock Enforced Actions */}
            <div className="space-y-3 pt-2">
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

              {/* Action Buttons (Add to Bag & Buy Now COD) */}
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

              {/* Wishlist & Share Action Row */}
              <div className="flex items-center gap-2.5 pt-1">
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
          </div>
        </div>

        {/* ── BELOW THE MAIN SECTION: ONLY RECOMMENDED PRODUCTS (As Requested) ── */}
        {recommendedProducts.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-[#E8DCCF]">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#8F0025] block mb-0.5">
                  Similar Curations
                </span>
                <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#171717]">
                  Recommended Products
                </h2>
              </div>
              <Link
                to={`/products?category=${encodeURIComponent(product.category)}`}
                className="text-xs font-bold text-[#8F0025] hover:underline flex items-center gap-1"
              >
                <span>View All in {product.category}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
              {recommendedProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        )}

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
