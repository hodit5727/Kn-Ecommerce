import React, { createContext, useContext, useState, useEffect } from 'react';
import { wishlistService } from '../services/cartService';
import { useToast } from './ToastContext';
import { useAuth } from '../auth/AuthContext';

interface WishlistContextType {
  wishlistIds: string[];
  wishlistCount: number;
  isInWishlist: (productId: string) => boolean;
  /** Returns true only when the draft write actually succeeded — callers must
   *  not show a success state when it returns false. */
  toggleWishlist: (productId: string) => boolean;
}

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

export const WishlistProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const { user, isAuthenticated, openAuthModal } = useAuth();

  const [wishlistIds, setWishlistIds] = useState<string[]>(() => {
    if (!user) return [];
    try {
      return wishlistService.getWishlist(user.id);
    } catch {
      return [];
    }
  });

  // Synchronize wishlist strictly with authenticated user identity
  useEffect(() => {
    if (!isAuthenticated || !user) {
      setWishlistIds([]);
      return;
    }

    try {
      const userWishlist = wishlistService.getWishlist(user.id);
      setWishlistIds(userWishlist);
    } catch (err) {
      setWishlistIds([]);
      showToast(
        err instanceof Error ? err.message : 'Unable to read your saved wishlist draft.',
        'error'
      );
      try {
        wishlistService.clearWishlist(user.id);
      } catch {}
    }
  }, [isAuthenticated, user?.id, showToast]);

  useEffect(() => {
    const handleUpdate = (e: CustomEvent<string[]>) => {
      if (user) {
        setWishlistIds(e.detail);
      } else {
        setWishlistIds([]);
      }
    };
    window.addEventListener('hod_wishlist_updated' as any, handleUpdate);
    return () => window.removeEventListener('hod_wishlist_updated' as any, handleUpdate);
  }, [user]);

  const toggleWishlist = (productId: string): boolean => {
    if (!isAuthenticated || !user) {
      showToast('Please sign in to save items to your wishlist.', 'info');
      openAuthModal();
      return false;
    }

    try {
      const updated = wishlistService.toggleWishlist(productId, user.id);
      setWishlistIds(updated);
      return true;
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Unable to update your wishlist. Please try again.',
        'error'
      );
      return false;
    }
  };

  const isInWishlist = (productId: string) => {
    if (!isAuthenticated || !user) return false;
    return wishlistIds.includes(productId);
  };

  return (
    <WishlistContext.Provider
      value={{
        wishlistIds,
        wishlistCount: wishlistIds.length,
        isInWishlist,
        toggleWishlist,
      }}
    >
      {children}
    </WishlistContext.Provider>
  );
};

export const useWishlist = (): WishlistContextType => {
  const context = useContext(WishlistContext);
  if (!context) throw new Error('useWishlist must be used within WishlistProvider');
  return context;
};
