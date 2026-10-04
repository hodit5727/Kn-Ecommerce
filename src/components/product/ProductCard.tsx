import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Product } from '../../types/product';
import { Heart, ShoppingBag, Eye, Star, Zap } from 'lucide-react';
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
    // Success toast only when the draft write actually succeeded.
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
    if (!addToCart(product, 1)) return; // failure toast already surfaced by CartContext
    showToast(`Added ${product.name} to cart`);
  };

  const handleBuyNow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (product.stock <= 0) {
      showToast('Item is presently out of stock.', 'error');
      return;
    }
    if (!addToCart(product, 1)) return; // never navigate away on a failed write
    navigate('/checkout');
  };

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative bg-white rounded-2xl border border-cream-200/90 shadow-soft card-hover-float flex flex-col overflow-hidden transition-all duration-300"
    >
      {/* Product Image Stage - Compact Aspect Ratio */}
      <div className="relative aspect-[4/3.2] w-full bg-stone-50 overflow-hidden">
        <Link to={`/products/${product.id}`} className="block w-full h-full">
          <img
            src={product.images[0]}
            alt={product.name}
            className="w-full h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
            loading="lazy"
          />
        </Link>

        {/* Badges Overlay */}
        <div className="absolute top-2.5 left-2.5 flex flex-col gap-1 pointer-events-none">
          {product.discountPercent && (
            <Badge variant="rosered" size="sm">
              -{product.discountPercent}%
            </Badge>
          )}
          {product.isNewArrival && (
            <Badge variant="cream" size="sm">
              New
            </Badge>
          )}
          {product.stock > 0 && product.stock <= 10 && (
            <Badge variant={product.stock <= 3 ? 'rosered' : 'amber'} size="sm">
              {product.stock} left
            </Badge>
          )}
        </div>

        {/* Wishlist Button */}
        <button
          onClick={handleWishlistToggle}
          aria-label="Add to wishlist"
          className={`absolute top-2.5 right-2.5 p-2 rounded-full transition-all duration-200 ${
            inWishlist
              ? 'bg-rosered-50 text-rosered-600 shadow-sm'
              : 'bg-white/80 hover:bg-white text-stone-600 hover:text-burgundy shadow-soft'
          } backdrop-blur-xs`}
        >
          <Heart className={`w-3.5 h-3.5 ${inWishlist ? 'fill-current' : ''}`} />
        </button>

        {/* Quick View Hover Pill */}
        {onQuickView && (
          <button
            onClick={() => onQuickView(product)}
            className="absolute bottom-2.5 left-1/2 -translate-x-1/2 airboard px-3 py-1 rounded-full text-[11px] font-semibold text-stone-800 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1.5 shadow-md hover:bg-white"
          >
            <Eye className="w-3 h-3 text-burgundy" /> Inspect
          </button>
        )}
      </div>

      {/* Product Information - Compact */}
      <div className="p-3 sm:p-3.5 flex flex-col flex-1 bg-white">
        <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
          <span className="uppercase tracking-wider font-semibold text-[10px] text-burgundy">
            {product.category}
          </span>
          <div className="flex items-center gap-1 text-stone-700">
            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            <span className="font-semibold text-xs">{product.rating}</span>
          </div>
        </div>

        <Link
          to={`/products/${product.id}`}
          className="font-serif font-semibold text-stone-900 text-xs sm:text-sm hover:text-burgundy line-clamp-1 mb-0.5 transition-colors"
        >
          {product.name}
        </Link>

        <p className="text-[11px] text-stone-400 mb-1 line-clamp-1">{product.brand}</p>

        {/* Dynamic Remaining Stock Quantity Indicator */}
        <div className="flex items-center gap-1.5 text-[11px] font-medium mb-2">
          {product.stock > 0 ? (
            <span className={`inline-flex items-center gap-1 ${product.stock <= 5 ? 'text-amber-800 font-bold' : 'text-emerald-700 font-semibold'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${product.stock <= 5 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
              {product.stock <= 10 ? `Only ${product.stock} left in stock` : `In Stock (${product.stock} units)`}
            </span>
          ) : (
            <span className="text-rosered-600 font-semibold">Out of stock</span>
          )}
        </div>

        {/* Pricing */}
        <div className="mt-auto pt-2 border-t border-cream-200/50 flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-bold text-stone-900 tracking-tight">
              {formatINR(product.price)}
            </span>
            {product.originalPrice && (
              <span className="text-[11px] text-stone-400 line-through">
                {formatINR(product.originalPrice)}
              </span>
            )}
          </div>
          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">
            COD Verified
          </span>
        </div>

        {/* Buy Now & Add to Cart Action Buttons */}
        <div className="mt-2.5 pt-2 border-t border-cream-200/60 grid grid-cols-2 gap-2">
          <button
            onClick={handleAddToCart}
            disabled={product.stock <= 0}
            className="py-1.5 px-2 rounded-xl border border-cream-300 hover:border-burgundy bg-ivory text-stone-800 hover:text-burgundy text-[11px] font-semibold flex items-center justify-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="Add to shopping bag"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-burgundy" />
            <span>Add to Cart</span>
          </button>
          <button
            onClick={handleBuyNow}
            disabled={product.stock <= 0}
            className="py-1.5 px-2 rounded-xl bg-burgundy hover:bg-burgundy-800 text-white text-[11px] font-semibold flex items-center justify-center gap-1 shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="Proceed to checkout"
          >
            <Zap className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
            <span>Buy Now</span>
          </button>
        </div>
      </div>
    </div>
  );
};
