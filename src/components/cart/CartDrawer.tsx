import React from 'react';
import { Drawer } from '../common/Drawer';
import { useCart } from '../../context/CartContext';
import { Trash2, Plus, Minus, ArrowRight, ShieldCheck, Truck } from 'lucide-react';
import { Button } from '../common/Button';
import { useNavigate } from 'react-router-dom';
import { formatINR } from '../../lib/currency';

import { useAuth } from '../../auth/AuthContext';

export const CartDrawer: React.FC = () => {
  const {
    items,
    isCartDrawerOpen,
    closeCartDrawer,
    updateQuantity,
    removeFromCart,
    subtotal,
    deliveryFee,
    totalAmount,
  } = useCart();
  const { isAuthenticated, user, openAuthModal } = useAuth();
  const navigate = useNavigate();

  const handleProceedToCheckout = () => {
    closeCartDrawer();
    navigate('/checkout');
  };

  return (
    <Drawer
      isOpen={isCartDrawerOpen}
      onClose={closeCartDrawer}
      title="Acquisition Bag"
      subtitle={
        !isAuthenticated || !user
          ? 'Sign in required'
          : `${items.length} exquisite item${items.length === 1 ? '' : 's'} reserved`
      }
      width="md"
    >
      <div className="flex flex-col h-full justify-between">
        {!isAuthenticated || !user ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-16 h-16 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-burgundy mb-4 shadow-soft">
              <ShieldCheck className="w-8 h-8 text-burgundy" />
            </div>
            <h4 className="font-serif font-semibold text-stone-900 text-lg">Sign In Required</h4>
            <p className="text-xs text-stone-500 mt-2 max-w-xs mb-6 leading-relaxed">
              Your acquisition bag is strictly bound to your authenticated account. Please log in to add items and manage your reservations.
            </p>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                closeCartDrawer();
                openAuthModal();
              }}
              className="w-full max-w-xs"
            >
              Sign In / Register
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-cream-100 flex items-center justify-center text-burgundy mb-4">
              <Truck className="w-8 h-8" />
            </div>
            <h4 className="font-serif font-semibold text-stone-900 text-lg">Your bag is empty</h4>
            <p className="text-xs text-stone-500 mt-1 max-w-xs mb-6">
              Discover curated haute horlogerie, artisanal furnishings, and fine jewels.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                closeCartDrawer();
                navigate('/products');
              }}
            >
              Explore Collection
            </Button>
          </div>
        ) : (
          <>
            {/* Items List */}
            <div className="space-y-4 divide-y divide-cream-200/60 overflow-y-auto pr-1">
              {items.map((item) => (
                <div key={item.id} className="pt-4 first:pt-0 flex gap-4">
                  <img
                    src={item.product.images[0]}
                    alt={item.product.name}
                    className="w-20 h-20 rounded-xl object-cover bg-stone-100 border border-cream-200 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-burgundy block">
                      {item.product.brand}
                    </span>
                    <h5 className="text-xs font-serif font-semibold text-stone-900 truncate">
                      {item.product.name}
                    </h5>
                    <p className="text-xs font-bold text-stone-900 mt-1">
                      {formatINR(item.product.price)}
                    </p>

                    <div className="flex items-center justify-between mt-2.5">
                      {/* Quantity Controller */}
                      <div className="flex items-center border border-cream-300 rounded-lg bg-ivory">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="p-1 hover:bg-cream-100 text-stone-600 rounded-l-lg transition-colors"
                          title="Decrease quantity"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="px-2.5 text-xs font-semibold text-stone-800">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={item.quantity >= item.product.stock}
                          className="p-1 hover:bg-cream-100 text-stone-600 rounded-r-lg transition-colors disabled:opacity-30"
                          title="Increase quantity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="text-stone-400 hover:text-rosered-600 p-1 transition-colors"
                        title="Remove item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* COD Summary & Checkout */}
            <div className="pt-5 border-t border-cream-200 mt-6 space-y-3 bg-ivory -mx-6 -mb-6 p-6">
              {/* COD Badge */}
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white border border-cream-200 text-xs text-stone-700">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Payment Protocol: <strong className="text-stone-900">Cash on Delivery Only</strong>
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-stone-600">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-semibold text-stone-900">{formatINR(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>White-Glove Courier</span>
                  <span>{deliveryFee === 0 ? <strong className="text-emerald-700">Complimentary</strong> : formatINR(deliveryFee)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-cream-200/80 text-sm font-bold text-stone-900">
                  <span>Due on Delivery</span>
                  <span className="text-base text-burgundy">{formatINR(totalAmount)}</span>
                </div>
              </div>

              <Button
                variant="primary"
                size="md"
                className="w-full"
                onClick={handleProceedToCheckout}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Proceed to COD Checkout
              </Button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
};
