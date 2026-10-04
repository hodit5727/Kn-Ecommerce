import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { CartItem } from '../types/cart';
import { Product } from '../types/product';
import { cartService } from '../services/cartService';
import { useToast } from './ToastContext';
import { useAuth } from '../auth/AuthContext';

interface CartContextType {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  isCartDrawerOpen: boolean;
  openCartDrawer: () => void;
  closeCartDrawer: () => void;
  /** Returns true only when the draft was actually persisted — callers must
   *  show success UI (toasts, navigation) only when this returns true. */
  addToCart: (product: Product, quantity?: number) => boolean;
  updateQuantity: (itemId: string, quantity: number) => void;
  /** Returns true only when the draft write actually succeeded — success UI
   *  (toasts) must only be shown when this returns true. */
  removeFromCart: (itemId: string) => boolean;
  clearCart: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const { user, isAuthenticated, openAuthModal } = useAuth();

  const [items, setItems] = useState<CartItem[]>(() => {
    if (!user) return [];
    try {
      return cartService.getCart(user.id);
    } catch {
      return [];
    }
  });

  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState<boolean>(false);

  // Synchronize cart strictly with authenticated user identity
  // Whenever user logs in, logs out, or switches accounts, cart is refreshed or cleared immediately.
  useEffect(() => {
    if (!isAuthenticated || !user) {
      setItems([]);
      setIsCartDrawerOpen(false);
      return;
    }

    try {
      const userCart = cartService.getCart(user.id);
      setItems(userCart);
    } catch (err) {
      setItems([]);
      showToast(
        err instanceof Error ? err.message : 'Unable to read your saved cart draft.',
        'error'
      );
      try {
        cartService.clearCart(user.id);
      } catch {}
    }
  }, [isAuthenticated, user?.id, showToast]);

  useEffect(() => {
    const handleUpdate = (e: CustomEvent<CartItem[]>) => {
      if (user) {
        setItems(e.detail);
      } else {
        setItems([]);
      }
    };
    window.addEventListener('hod_cart_updated' as any, handleUpdate);
    return () => window.removeEventListener('hod_cart_updated' as any, handleUpdate);
  }, [user]);

  const reportError = useCallback((err: unknown, fallback: string) => {
    showToast(err instanceof Error ? err.message : fallback, 'error');
  }, [showToast]);

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  const deliveryFee = subtotal > 10000 || subtotal === 0 ? 0 : 75; // Complimentary courier over ₹10k
  const totalAmount = subtotal + deliveryFee;

  const addToCart = (product: Product, quantity = 1): boolean => {
    if (!isAuthenticated || !user) {
      showToast('Please sign in to add items to your cart.', 'info');
      openAuthModal();
      return false;
    }

    try {
      const updated = cartService.addItem(product, quantity, user.id);
      setItems(updated);
      setIsCartDrawerOpen(true);
      return true;
    } catch (err) {
      reportError(err, 'Unable to update your cart. Please try again.');
      return false;
    }
  };

  const updateQuantity = (itemId: string, quantity: number) => {
    if (!isAuthenticated || !user) {
      showToast('Please sign in to manage your cart.', 'info');
      openAuthModal();
      return;
    }

    try {
      const updated = cartService.updateQuantity(itemId, quantity, user.id);
      setItems(updated);
    } catch (err) {
      reportError(err, 'Unable to update the cart quantity. Please try again.');
    }
  };

  const removeFromCart = (itemId: string): boolean => {
    if (!isAuthenticated || !user) return false;

    try {
      const updated = cartService.removeItem(itemId, user.id);
      setItems(updated);
      return true;
    } catch (err) {
      reportError(err, 'Unable to remove the item from your cart. Please try again.');
      return false;
    }
  };

  const clearCart = () => {
    if (!user) {
      setItems([]);
      return;
    }

    try {
      cartService.clearCart(user.id);
      setItems([]);
    } catch (err) {
      reportError(err, 'Unable to clear your cart. Please try again.');
    }
  };

  const handleOpenCartDrawer = () => {
    if (!isAuthenticated || !user) {
      showToast('Please sign in to view your acquisition bag.', 'info');
      openAuthModal();
      return;
    }
    setIsCartDrawerOpen(true);
  };

  return (
    <CartContext.Provider
      value={{
        items,
        itemCount,
        subtotal,
        deliveryFee,
        totalAmount,
        isCartDrawerOpen,
        openCartDrawer: handleOpenCartDrawer,
        closeCartDrawer: () => setIsCartDrawerOpen(false),
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = (): CartContextType => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
};
