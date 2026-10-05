import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { productService } from '../../services/productService';
import { Product } from '../../types/product';
import { Product3DViewer } from '../../components/3d/Product3DViewer';
import { InteriorVisualizerModal } from '../../components/3d/InteriorVisualizerModal';
import { ErrorState } from '../../components/common/ErrorState';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { useToast } from '../../context/ToastContext';
import { formatINR } from '../../lib/currency';
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
  ChevronDown,
  ChevronUp,
  Zap
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
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState<boolean>(false);

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

  const variants = React.useMemo(() => {
    return Array.isArray(product?.variants) && product!.variants.length > 0 ? product!.variants : [];
  }, [product]);

  const currentVariant = variants[selectedVariantIndex] || null;
  const currentStock = currentVariant ? currentVariant.stock : (product?.stock ?? 0);
  const currentPrice = currentVariant ? currentVariant.price : (product?.price ?? 0);
  const currentSku = currentVariant?.sku || product?.sku || product?.productCode || '';

  const displaySpecifications = React.useMemo(() => {
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

    // 2. Core attributes if not already in specifications
    if (product.brand) addSpec('Brand', product.brand);
    if (product.category) addSpec('Category', product.category);
    if (product.productCode) addSpec('Product Code', product.productCode);
    if (currentSku && currentSku !== product.productCode) addSpec('Model / SKU', currentSku);
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
      addSpec('Available Stock', `${currentStock} Units`);
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
  }, [product]);

  const dynamicFeatures = React.useMemo(() => {
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
      showToast(`Added ${quantity} × ${product.name}${currentVariant?.color ? ` (${currentVariant.color})` : ''} to cart.`);
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
      <div className="max-w-7xl mx-auto px-4 py-16 flex items-center justify-center min-h-[50vh]">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full border-4 border-[#8F0025] border-t-transparent animate-spin mx-auto" />
          <p className="font-serif font-semibold text-[#171717]">Loading Product Details...</p>
        </div>
      </div>
    );
  }

  const primaryImage = product.images[activeImageIndex] || product.images[0];

  return (
    <div className="min-h-screen bg-[#FFF9F2]/30 py-4 sm:py-8 pb-32 sm:pb-12">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-[#6B625C] overflow-x-auto whitespace-nowrap scrollbar-none py-1">
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

        {/* ── MAIN PRODUCT SHOWCASE (Compact 50/50 Layout) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 lg:gap-8 items-start">
          {/* Left Column: Media Stage & 3D Interactive Viewport */}
          <div className="space-y-3 lg:sticky lg:top-6">
            <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-white border border-[#E8DCCF] shadow-2xs">
              {activeMediaTab === '3d' ? (
                <Product3DViewer product={product} className="w-full h-full" autoRotate={true} />
              ) : (
                <img
                  src={primaryImage}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              )}

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
                      : 'text-[#6B625C] hover:bg-[#FFF9F2]'
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
                      : 'text-[#6B625C] hover:bg-[#FFF9F2]'
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
              <div className="flex gap-2.5 overflow-x-auto pb-1">
                {product.images.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveImageIndex(idx)}
                    className={`w-16 h-16 rounded-xl overflow-hidden border transition-all shrink-0 ${
                      activeImageIndex === idx
                        ? 'border-[#8F0025] ring-2 ring-[#8F0025]/20 shadow-xs'
                        : 'border-[#E8DCCF] opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Stock Count Banner under Image */}
            <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-white border border-[#E8DCCF] shadow-xs text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${currentStock <= 5 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                <span className="text-[#6B625C] font-semibold">Campus Stock:</span>
              </div>
              <span className={`font-bold ${currentStock <= 5 ? 'text-amber-800' : 'text-emerald-700'}`}>
                {currentStock > 0
                  ? (currentStock <= 5 ? `Only ${currentStock} left in stock!` : `${currentStock} Units Available`)
                  : 'Out of Stock'}
              </span>
            </div>
          </div>

          {/* Right Column: Compact Product Information Card */}
          <div className="bg-white rounded-2xl p-5 sm:p-6 lg:p-7 border border-[#E8DCCF] shadow-xs space-y-5">
            {/* Header: Brand, Category & Rating */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  {product.brand && (
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[#8F0025]">
                      {product.brand}
                    </span>
                  )}
                  {product.brand && product.category && (
                    <span className="text-[#E8DCCF]">•</span>
                  )}
                  {product.category && (
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B625C]">
                      {product.category}
                    </span>
                  )}
                </div>

                {/* Rating Badge */}
                <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FFF9F2] border border-[#E8DCCF] text-[11px] font-semibold">
                  <Star className="w-3 h-3 text-[#B8860B] fill-[#B8860B]" />
                  <span className="text-[#171717] font-bold">
                    {product.rating ? Number(product.rating).toFixed(1) : '5.0'}
                  </span>
                  <span className="text-[#6B625C]">({product.reviewCount || 0})</span>
                </div>
              </div>

              {/* Product Title */}
              <h1 className="text-lg sm:text-xl lg:text-2xl font-serif font-bold text-[#171717] tracking-tight leading-snug">
                {product.name}
              </h1>

              {product.tagline && product.tagline !== product.name && (
                <p className="text-xs text-[#6B625C] mt-1 font-medium">
                  {product.tagline}
                </p>
              )}
            </div>

            {/* Price Section */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-[#FFF9F2] border border-[#E8DCCF] space-y-2.5">
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <span className="text-2xl sm:text-3xl font-serif font-bold text-[#171717]">
                  {formatINR(currentPrice)}
                </span>
                {product.originalPrice && product.originalPrice > currentPrice && (
                  <>
                    <span className="text-xs sm:text-sm text-[#6B625C] line-through">
                      {formatINR(product.originalPrice)}
                    </span>
                    <span className="text-[10px] font-bold bg-[#8F0025]/10 text-[#8F0025] px-2 py-0.5 rounded-full border border-[#8F0025]/20">
                      {Math.round(((product.originalPrice - currentPrice) / product.originalPrice) * 100)}% OFF
                    </span>
                  </>
                )}
              </div>

              <div className="pt-2 border-t border-[#E8DCCF] flex items-center justify-between text-xs flex-wrap gap-2">
                <span className="text-[#6B625C] font-semibold uppercase tracking-wider text-[10px]">
                  Payment Protocol:
                </span>
                <span className="font-bold text-[#8F0025] flex items-center gap-1 text-xs">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#8F0025]" /> Cash on Delivery (COD) Only
                </span>
              </div>
            </div>

            {/* Color / Variant Selection (if multiple options available) */}
            {variants.length > 1 && (
              <div className="space-y-2 p-3.5 rounded-xl bg-[#FFF9F2]/70 border border-[#E8DCCF]">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#6B625C] uppercase tracking-wider text-[10px]">
                    Available Options / Colors:
                  </span>
                  <span className="font-bold text-[#8F0025]">
                    {currentVariant?.color || currentVariant?.size || 'Selected'}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {variants.map((v, idx) => {
                    const isSelected = selectedVariantIndex === idx;
                    const label = v.color || v.size || `Option ${idx + 1}`;
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
                            : 'bg-white text-[#171717] border-[#E8DCCF] hover:border-[#8F0025]/50'
                        }`}
                      >
                        <span>{label}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'
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

            {/* Quantity Selector & Stock Indicator */}
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#6B625C]">
                    Quantity:
                  </span>
                  <div className="flex items-center border border-[#E8DCCF] rounded-lg bg-white shadow-xs">
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="p-1.5 text-[#171717] hover:bg-[#FFF9F2] rounded-l-lg transition-colors"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-3 text-xs font-bold text-[#171717]">{quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.min(currentStock, quantity + 1))}
                      disabled={quantity >= currentStock}
                      className="p-1.5 text-[#171717] hover:bg-[#FFF9F2] rounded-r-lg transition-colors disabled:opacity-30"
                      aria-label="Increase quantity"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Stock Status Badge */}
                <div>
                  {currentStock > 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      {currentStock} in campus stock
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200">
                      Out of stock
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={currentStock <= 0}
                  className="h-11 sm:h-12 px-4 rounded-xl bg-[#8F0025] hover:bg-[#72001e] text-white font-bold tracking-wider uppercase text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm hover:shadow transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>Add to Cart</span>
                </button>
                <button
                  type="button"
                  onClick={handleBuyNow}
                  disabled={currentStock <= 0}
                  className="h-11 sm:h-12 px-4 rounded-xl bg-[#FFF9F2] hover:bg-[#F9ECE0] text-[#171717] border-2 border-[#8F0025] font-bold tracking-wider uppercase text-xs sm:text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
                >
                  <span>Buy Now (COD)</span>
                </button>
              </div>

              {/* Wishlist Button */}
              <button
                type="button"
                onClick={() => toggleWishlist(product.id)}
                className={`w-full h-10 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  inWishlist
                    ? 'bg-rose-50 border-rose-200 text-[#8F0025]'
                    : 'border-[#E8DCCF] bg-white text-[#171717] hover:bg-[#FFF9F2]'
                }`}
              >
                <Heart className={`w-3.5 h-3.5 ${inWishlist ? 'fill-[#8F0025] text-[#8F0025]' : 'text-[#6B625C]'}`} />
                <span>{inWishlist ? 'Saved in Wishlist' : 'Save to Wishlist'}</span>
              </button>
            </div>

            {/* Seller Information Card */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-[#FFF9F2]/70 border border-[#E8DCCF] space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white border border-[#E8DCCF] flex items-center justify-center text-[#8F0025] shadow-xs shrink-0">
                    <Store className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] uppercase font-bold text-[#6B625C] tracking-wider">
                        Seller
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#B8860B] bg-white border border-[#B8860B]/40 px-1.5 py-0.5 rounded-full">
                        <ShieldCheck className="w-2.5 h-2.5 text-[#B8860B]" /> Verified
                      </span>
                    </div>
                    <h4 className="font-serif font-bold text-[#171717] text-sm sm:text-base">
                      {product.sellerName || 'Campus Partner Seller'}
                    </h4>
                    <div className="flex items-center gap-2 text-[11px] text-[#6B625C] mt-0.5 flex-wrap">
                      {product.sellerId && (
                        <span>ID: <strong className="text-[#171717] font-mono">{String(product.sellerId).slice(0, 8).toUpperCase()}</strong></span>
                      )}
                      <span className="flex items-center gap-1 text-[#B8860B] font-semibold">
                        <Star className="w-2.5 h-2.5 fill-[#B8860B]" /> {product.sellerRating ? Number(product.sellerRating).toFixed(1) : '5.0'}
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

            {/* Delivery & Return Protocols */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#6B625C]">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#FFF9F2]/50 border border-[#E8DCCF]">
                <Truck className="w-3.5 h-3.5 text-[#8F0025] shrink-0" />
                <span>
                  Delivery in <strong>{product.deliveryEstimateDays || 2} days</strong>.
                </span>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#FFF9F2]/50 border border-[#E8DCCF]">
                <RotateCcw className="w-3.5 h-3.5 text-[#8F0025] shrink-0" />
                <span>
                  <strong>{product.returnPolicyDays || 7}-day return policy</strong>.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── PRODUCT DESCRIPTION CARD (Compact Card Below) ── */}
        <div className="bg-white rounded-2xl p-5 sm:p-7 lg:p-8 border border-[#E8DCCF] shadow-xs space-y-4">
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
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#FFF9F2] text-[#6B625C] border border-[#E8DCCF]">
                {product.category}
              </span>
            )}
          </div>

          {/* Dynamic Product Description (Compact 14-16px text) */}
          <div className="text-xs sm:text-sm text-[#171717] leading-relaxed font-normal whitespace-pre-line">
            {isDescriptionLong && !isDescriptionExpanded
              ? `${product.description.slice(0, 360)}...`
              : (product.description || 'No detailed description available for this product.')}
          </div>

          {/* Read More / Read Less Interaction */}
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

          {/* Dynamic Key Features */}
          {dynamicFeatures.length > 0 && (
            <div className="pt-4 border-t border-[#E8DCCF] space-y-2.5">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#6B625C]">
                Key Features
              </h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {dynamicFeatures.map((feat, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs sm:text-sm text-[#171717]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#8F0025] shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── SPECIFICATIONS TABLE FRAME (Compact Dynamic Grid) ── */}
        {displaySpecifications.length > 0 && (
          <div className="bg-white rounded-2xl p-5 sm:p-7 lg:p-8 border border-[#E8DCCF] shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#E8DCCF]">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#8F0025] block mb-0.5">
                  Technical Specifications
                </span>
                <h2 className="text-lg sm:text-xl font-serif font-bold text-[#171717]">
                  Product Details & Specifications
                </h2>
              </div>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#FFF9F2] text-[#8F0025] border border-[#E8DCCF] self-start sm:self-auto">
                {displaySpecifications.length} Specifications
              </span>
            </div>

            {/* Table Frame */}
            <div className="border border-[#E8DCCF] rounded-xl overflow-hidden shadow-xs bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#FFF9F2] border-b border-[#E8DCCF]">
                      <th className="py-2.5 sm:py-3 px-3.5 sm:px-4 text-[11px] font-bold uppercase tracking-wider text-[#6B625C] w-2/5 sm:w-1/3 border-r border-[#E8DCCF]">
                        Specification Parameter
                      </th>
                      <th className="py-2.5 sm:py-3 px-3.5 sm:px-4 text-[11px] font-bold uppercase tracking-wider text-[#6B625C]">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DCCF] text-xs sm:text-sm">
                    {displaySpecifications.map((spec, i) => (
                      <tr
                        key={i}
                        className="odd:bg-white even:bg-[#FFF9F2]/40 hover:bg-[#FFF9F2] transition-colors"
                      >
                        <td className="py-2.5 sm:py-3 px-3.5 sm:px-4 font-semibold text-[#171717] uppercase tracking-wide text-xs border-r border-[#E8DCCF] bg-[#FFF9F2]/20">
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

        {/* Spatial Visualizer Modal */}
        <InteriorVisualizerModal
          isOpen={isInteriorModalOpen}
          onClose={() => setIsInteriorModalOpen(false)}
          product={product}
        />
      </div>

      {/* ── MOBILE BOTTOM STICKY ACTION BAR ── */}
      <div
        className="fixed bottom-14 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-cream-200/90 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] sm:hidden p-3 flex items-center justify-between gap-3"
      >
        <div className="shrink-0">
          <span className="text-[10px] uppercase font-bold text-[#6B625C] block leading-tight">
            Total Price
          </span>
          <span className="text-xl font-serif font-bold text-[#171717] leading-none">
            {formatINR(currentPrice * quantity)}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-[240px]">
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={currentStock <= 0}
            className="flex-1 py-2.5 rounded-xl border border-[#8F0025] text-[#8F0025] bg-white text-xs font-bold flex items-center justify-center gap-1 active:bg-[#8F0025]/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Bag</span>
          </button>
          <button
            type="button"
            onClick={handleBuyNow}
            disabled={currentStock <= 0}
            className="flex-1 py-2.5 rounded-xl bg-[#8F0025] hover:bg-[#72001e] text-white text-xs font-bold flex items-center justify-center gap-1 shadow-2xs active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Zap className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
            <span>Buy COD</span>
          </button>
        </div>
      </div>
    </div>
  );
};
