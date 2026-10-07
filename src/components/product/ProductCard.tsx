import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Product } from '../../types/product';
import { Heart, ShoppingBag, Eye, Star, Zap, Flame } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { useToast } from '../../context/ToastContext';
import { Badge } from '../common/Badge';
import { formatINR } from '../../lib/currency';

interface ProductCardProps {
  product: Product;
  onQuickView?: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onQuickView }) => {
  const { addToCart } = useCart();
  const { isInWishlist, toggleWishlist } = useWishlist();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [isHovered, setIsHovered] = useState(false);

  const inWishlist = isInWishlist(product.id);

  const handleWishlistToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (toggleWishlist(product.id)) {
      showToast(
        inWishlist ? `Removed ${product.name} from wishlist` : `Added ${product.name} to wishlist`,
        'info'
      );
    }
  };

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (product.stock <= 0) {
      showToast('Item is presently out of stock.', 'error');
      return;
    }
    if (!addToCart(product, 1)) return;
    showToast(`Added ${product.name} to bag`);
  };

  const handleBuyNow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (product.stock <= 0) {
      showToast('Item is presently out of stock.', 'error');
      return;
    }
    if (!addToCart(product, 1)) return;
    navigate('/checkout');
  };

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative bg-white rounded-xl sm:rounded-2xl border border-cream-200/90 shadow-2xs hover:shadow-soft flex flex-col overflow-hidden transition-all duration-200 w-full max-w-[230px]"
    >
      {/* Product Image Stage - Compact aspect ratio with smooth framing */}
      <div className="relative aspect-square max-h-[190px] w-full bg-stone-50/80 overflow-hidden flex items-center justify-center">
        <Link to={`/products/${product.id}`} className="block w-full h-full">
          <img
            src={product.images[0]}
            alt={product.name}
            className="w-full h-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
            loading="lazy"
          />
        </Link>

        {/* Badges Overlay */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none z-10">
          {product.isTrending && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-orange-600 text-white text-[8px] font-bold tracking-wider uppercase shadow-xs">
              <Flame className="w-2 h-2 fill-white text-white" />
              Trending
            </span>
          )}
          {product.discountPercent && (
            <Badge variant="rosered" size="sm">
              -{product.discountPercent}%
            </Badge>
          )}
          {product.isNewArrival && !product.isTrending && (
            <Badge variant="cream" size="sm">
              New
            </Badge>
          )}
          {product.stock > 0 && product.stock <= 5 && (
            <Badge variant="amber" size="sm">
              {product.stock} left
            </Badge>
          )}
        </div>

        {/* Wishlist Button - Min 36px touch area */}
        <button
          onClick={handleWishlistToggle}
          aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
          className={`absolute top-1.5 right-1.5 p-1.5 rounded-full transition-all duration-200 min-w-[32px] min-h-[32px] flex items-center justify-center ${
            inWishlist
              ? 'bg-rose-50 text-rose-600 shadow-xs'
              : 'bg-white/85 hover:bg-white text-stone-600 hover:text-burgundy shadow-2xs'
          } backdrop-blur-xs z-10 cursor-pointer`}
        >
          <Heart className={`w-3.5 h-3.5 ${inWishlist ? 'fill-current' : ''}`} />
        </button>

        {/* Quick View Hover Pill (Desktop only) */}
        {onQuickView && (
          <button
            onClick={() => onQuickView(product)}
            className="hidden sm:flex absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-semibold text-stone-800 bg-white/95 border border-cream-200 opacity-0 group-hover:opacity-100 transition-opacity duration-200 items-center gap-1 shadow-md hover:bg-white z-10 cursor-pointer"
          >
            <Eye className="w-2.5 h-2.5 text-burgundy" /> Inspect
          </button>
        )}
      </div>

      {/* Product Information */}
      <div className="p-2 sm:p-2.5 flex flex-col flex-1 bg-white">
        {/* Category & Rating */}
        <div className="flex items-center justify-between text-[10px] text-stone-500 mb-1">
          <span className="uppercase tracking-wider font-semibold text-[9px] text-burgundy truncate max-w-[65%]">
            {product.category}
          </span>
          <div className="flex items-center gap-0.5 text-stone-700 shrink-0">
            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
            <span className="font-bold text-[10px]">
              {product.rating ? Number(product.rating).toFixed(1) : '5.0'}
            </span>
          </div>
        </div>

        {/* Product Title */}
        <Link
          to={`/products/${product.id}`}
          className="font-serif font-bold text-stone-900 text-xs hover:text-burgundy line-clamp-2 mb-1 transition-colors leading-snug"
          title={product.name}
        >
          {product.name}
        </Link>

        {/* Brand or Seller */}
        <p className="text-[10px] text-stone-400 mb-1 truncate">
          {product.brand || product.sellerName || 'Sovereign Guild'}
        </p>

        {/* Stock Status Indicator */}
        <div className="flex items-center gap-1 text-[10px] font-medium mb-1.5">
          {product.stock > 0 ? (
            <span className={`inline-flex items-center gap-1 ${product.stock <= 5 ? 'text-amber-800 font-bold' : 'text-emerald-700 font-semibold'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${product.stock <= 5 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="truncate">
                {product.stock <= 5 ? `Only ${product.stock} left` : 'In Stock'}
              </span>
            </span>
          ) : (
            <span className="text-rose-600 font-semibold">Out of stock</span>
          )}
        </div>

        {/* Pricing & COD Badge */}
        <div className="mt-auto pt-1.5 border-t border-cream-100 flex items-center justify-between flex-wrap gap-1">
          <div className="flex items-baseline gap-1">
            <span className="text-xs sm:text-sm font-bold text-stone-900 tracking-tight">
              {formatINR(product.price)}
            </span>
            {product.originalPrice && product.originalPrice > product.price && (
              <span className="text-[9px] text-stone-400 line-through">
                {formatINR(product.originalPrice)}
              </span>
            )}
          </div>
          <span className="text-[8px] text-emerald-800 bg-emerald-50 px-1 py-0.5 rounded font-bold border border-emerald-100 shrink-0">
            COD
          </span>
        </div>

        {/* Action Buttons: Compact Flipkart/Amazon style */}
        <div className="mt-2 pt-1.5 border-t border-cream-100 grid grid-cols-2 gap-1">
          <button
            onClick={handleAddToCart}
            disabled={product.stock <= 0}
            className="min-h-[30px] sm:min-h-[32px] px-1 rounded-lg border border-cream-300 hover:border-burgundy bg-cream-50 hover:bg-cream-100 text-stone-800 hover:text-burgundy text-[10px] font-bold flex items-center justify-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="Add to shopping bag"
          >
            <ShoppingBag className="w-2.5 h-2.5 text-burgundy shrink-0" />
            <span className="truncate">Add</span>
          </button>
          <button
            onClick={handleBuyNow}
            disabled={product.stock <= 0}
            className="min-h-[30px] sm:min-h-[32px] px-1 rounded-lg bg-burgundy hover:bg-burgundy-800 text-white text-[10px] font-bold flex items-center justify-center gap-1 shadow-2xs transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="Proceed to checkout"
          >
            <Zap className="w-2.5 h-2.5 fill-amber-300 text-amber-300 shrink-0" />
            <span className="truncate">Buy</span>
          </button>
        </div>
      </div>
    </div>
  );
};
