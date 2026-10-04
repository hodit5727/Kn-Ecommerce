import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Product } from '../../types/product';
import { Product3DViewer } from '../3d/Product3DViewer';
import { Button } from '../common/Button';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { useToast } from '../../context/ToastContext';
import { Heart, ShoppingBag, Box, Image as ImageIcon, Star, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatINR } from '../../lib/currency';

interface QuickViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
}

export const QuickViewModal: React.FC<QuickViewModalProps> = ({ isOpen, onClose, product }) => {
  const [viewMode, setViewMode] = useState<'photo' | '3d'>('photo');
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);
  const { addToCart } = useCart();
  const { isInWishlist, toggleWishlist } = useWishlist();
  const { showToast } = useToast();

  if (!product) return null;

  const inWishlist = isInWishlist(product.id);

  const handleAddToCart = () => {
    if (product.stock <= 0) {
      showToast('Item is presently out of stock.', 'error');
      return;
    }
    if (!addToCart(product, 1)) return; // failure toast already surfaced by CartContext
    showToast(`Added ${product.name} to bag`);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="4xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        {/* Visual Stage */}
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden bg-stone-50 border border-cream-200 aspect-square">
            {viewMode === '3d' ? (
              <Product3DViewer product={product} className="h-full w-full" />
            ) : (
              <img
                src={product.images[activeImageIndex] || product.images[0]}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            )}

            {/* 2D / 3D Mode Toggle */}
            <div className="absolute top-3 right-3 airboard p-1 rounded-xl flex gap-1 shadow-sm">
              <button
                onClick={() => setViewMode('photo')}
                className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                  viewMode === 'photo' ? 'bg-burgundy text-white' : 'text-stone-700 hover:bg-cream-100'
                }`}
                title="Photo gallery"
              >
                <ImageIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('3d')}
                className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                  viewMode === '3d' ? 'bg-burgundy text-white' : 'text-stone-700 hover:bg-cream-100'
                }`}
                title="3D Inspection"
              >
                <Box className="w-3.5 h-3.5" /> 3D
              </button>
            </div>
          </div>

          {/* Thumbnail Gallery (when in photo mode) */}
          {viewMode === 'photo' && product.images.length > 1 && (
            <div className="flex gap-2">
              {product.images.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveImageIndex(idx)}
                  className={`w-16 h-16 rounded-xl overflow-hidden border-2 transition-all ${
                    activeImageIndex === idx ? 'border-burgundy' : 'border-stone-200 opacity-70'
                  }`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product Details & Actions */}
        <div className="space-y-4">
          <div>
            <span className="text-xs uppercase tracking-wider font-semibold text-burgundy block mb-1">
              {product.brand} • {product.category}
            </span>
            <h3 className="text-xl font-serif font-bold text-stone-900 leading-snug">
              {product.name}
            </h3>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex items-center text-amber-500">
                <Star className="w-4 h-4 fill-current" />
                <span className="text-xs font-bold text-stone-900 ml-1">{product.rating}</span>
              </div>
              <span className="text-xs text-stone-400">•</span>
              <span className="text-xs text-stone-500">{product.reviewCount} Reviews</span>
            </div>
          </div>

          <div className="pt-2 border-t border-cream-200">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-serif font-bold text-stone-900">
                {formatINR(product.price)}
              </span>
              {product.originalPrice && (
                <span className="text-sm text-stone-400 line-through">
                  {formatINR(product.originalPrice)}
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              Available exclusively via <strong className="text-stone-800">Cash on Delivery (COD)</strong>
            </p>
          </div>

          <p className="text-xs text-stone-600 line-clamp-3 leading-relaxed">
            {product.description}
          </p>

          {/* Quick Specifications */}
          <div className="bg-ivory p-3.5 rounded-xl border border-cream-200 space-y-1.5 text-xs">
            {product.specifications.slice(0, 3).map((spec, i) => (
              <div key={i} className="flex justify-between text-stone-600">
                <span className="font-medium text-stone-500">{spec.name}:</span>
                <span className="font-semibold text-stone-900">{spec.value}</span>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              onClick={handleAddToCart}
              leftIcon={<ShoppingBag className="w-4 h-4" />}
            >
              Add to Bag
            </Button>
            <button
              onClick={() => toggleWishlist(product.id)}
              className={`p-3 rounded-xl border transition-colors ${
                inWishlist ? 'bg-rosered-50 border-rosered-200 text-rosered-600' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
              title="Save to wishlist"
            >
              <Heart className={`w-5 h-5 ${inWishlist ? 'fill-current' : ''}`} />
            </button>
          </div>

          <div className="text-center pt-1">
            <Link
              to={`/products/${product.id}`}
              onClick={onClose}
              className="text-xs font-semibold text-burgundy hover:underline"
            >
              View Full Architectural Dossier →
            </Link>
          </div>
        </div>
      </div>
    </Modal>
  );
};
