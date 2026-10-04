import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/common/Button';
import { formatINR } from '../../lib/currency';
import {
  Trash2,
  Plus,
  Minus,
  Heart,
  ArrowRight,
  ShieldCheck,
  Truck,
  PackageOpen,
  Store
} from 'lucide-react';

import { useAuth } from '../../auth/AuthContext';

export const CartPage: React.FC = () => {
  const { items, updateQuantity, removeFromCart, subtotal, deliveryFee, totalAmount } = useCart();
  const { toggleWishlist, isInWishlist } = useWishlist();
  const { user, isAuthenticated, openAuthModal } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSaveToWishlist = (product: any, itemId: string) => {
    // Claim "moved" only when BOTH draft writes actually succeeded —
    // failures already surfaced their own error toast (AGENTS.md rule 8).
    if (!isInWishlist(product.id) && !toggleWishlist(product.id)) return;
    if (!removeFromCart(itemId)) return;
    showToast(`Moved ${product.name} to personal wishlist.`);
  };

  if (!isAuthenticated || !user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 rounded-3xl bg-amber-50 border border-amber-200 flex items-center justify-center text-burgundy mx-auto mb-6 shadow-soft">
          <ShieldCheck className="w-10 h-10 text-burgundy" />
        </div>
        <h1 className="font-serif font-bold text-2xl text-stone-900 mb-2">
          Sign In to Access Your Acquisition Bag
        </h1>
        <p className="text-sm text-stone-500 max-w-md mx-auto mb-8 leading-relaxed">
          Your cart items are strictly bound to your authenticated account. Please log in to view reserved items and proceed to checkout.
        </p>
        <Button variant="primary" size="lg" onClick={openAuthModal}>
          Sign In / Register
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 rounded-3xl bg-cream-100 flex items-center justify-center text-burgundy mx-auto mb-6 shadow-soft">
          <PackageOpen className="w-10 h-10" />
        </div>
        <h1 className="font-serif font-bold text-2xl text-stone-900 mb-2">
          Your Acquisition Bag is Empty
        </h1>
        <p className="text-sm text-stone-500 max-w-md mx-auto mb-8 leading-relaxed">
          No luxury pieces have been reserved. Explore our curated selection of haute horlogerie,
          architectural seating, and fine jewels.
        </p>
        <Button variant="primary" size="lg" onClick={() => navigate('/products')}>
          Discover the Collection
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Title */}
      <div className="border-b border-cream-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
          Review Requisition
        </span>
        <h1 className="text-3xl font-serif font-bold text-stone-900">
          Acquisition Bag ({items.length} item{items.length === 1 ? '' : 's'})
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Cart Items Table / List */}
        <div className="lg:col-span-8 bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft divide-y divide-cream-200">
          {items.map((item) => (
            <div key={item.id} className="py-6 first:pt-0 last:pb-0 flex flex-col sm:flex-row gap-6">
              <Link to={`/products/${item.product.id}`} className="shrink-0">
                <img
                  src={item.product.images[0]}
                  alt={item.product.name}
                  className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl object-cover bg-stone-50 border border-cream-200"
                />
              </Link>

              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="text-[10px] uppercase font-bold tracking-wider text-burgundy block">
                        {item.product.category}
                      </span>
                      <Link
                        to={`/products/${item.product.id}`}
                        className="font-serif font-bold text-base text-stone-900 hover:text-burgundy transition-colors"
                      >
                        {item.product.name}
                      </Link>
                      <div className="flex items-center gap-1.5 text-xs text-stone-500 mt-1">
                        <Store className="w-3.5 h-3.5 text-stone-400" />
                        <span>Artisan: <strong>{item.product.sellerName}</strong></span>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-lg font-bold text-stone-900 font-serif">
                        {formatINR(item.product.price * item.quantity)}
                      </p>
                      <p className="text-xs text-stone-400">
                        {formatINR(item.product.price)} each
                      </p>
                    </div>
                  </div>
                </div>

                {/* Bottom row: Quantity Controller & Actions */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-cream-100">
                  <div className="flex items-center border border-cream-300 rounded-xl bg-ivory">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="p-2 text-stone-600 hover:bg-cream-100 rounded-l-xl transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-4 text-xs font-bold text-stone-900">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      disabled={item.quantity >= item.product.stock}
                      className="p-2 text-stone-600 hover:bg-cream-100 rounded-r-xl transition-colors disabled:opacity-30"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => handleSaveToWishlist(item.product, item.id)}
                      className="text-xs text-stone-600 hover:text-burgundy flex items-center gap-1.5 transition-colors"
                    >
                      <Heart className="w-4 h-4 text-stone-400" />
                      <span className="hidden sm:inline">Save for Wishlist</span>
                    </button>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-xs text-stone-400 hover:text-rosered-600 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="hidden sm:inline">Remove</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Order Summary Column (Strict Cash on Delivery) */}
        <div className="lg:col-span-4 bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft space-y-6 sticky top-28">
          <h3 className="font-serif font-bold text-lg text-stone-900 pb-3 border-b border-cream-200">
            Requisition Summary
          </h3>

          <div className="space-y-3 text-xs text-stone-600">
            <div className="flex justify-between">
              <span>Catalog Subtotal</span>
              <span className="font-semibold text-stone-900">{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>White-Glove Courier</span>
              <span>
                {deliveryFee === 0 ? (
                  <strong className="text-emerald-700">Complimentary</strong>
                ) : (
                  formatINR(deliveryFee)
                )}
              </span>
            </div>
            <div className="flex justify-between pt-3 border-t border-cream-200 text-sm font-bold text-stone-900">
              <span>Amount Due on Delivery</span>
              <span className="text-xl font-serif text-burgundy">{formatINR(totalAmount)}</span>
            </div>
          </div>

          {/* Cash on Delivery Notice Card */}
          <div className="p-4 rounded-2xl bg-ivory border border-cream-300 space-y-2 text-xs text-stone-700">
            <div className="flex items-center gap-2 font-bold text-burgundy">
              <ShieldCheck className="w-4 h-4" />
              <span>Cash on Delivery Exclusive</span>
            </div>
            <p className="text-[11px] leading-relaxed text-stone-500">
              Inspect the physical integrity and certificates with our courier before handing over
              cash. No digital card transactions or advance pre-payments are accepted.
            </p>
          </div>

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => navigate('/checkout')}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Proceed to COD Checkout
          </Button>

          <p className="text-center text-[10px] text-stone-400">
            Complimentary insured white-glove transit included.
          </p>
        </div>
      </div>
    </div>
  );
};
