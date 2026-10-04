/**
 * Cart & wishlist service — STRICTLY USER-SCOPED LOCAL DRAFT PERSISTENCE.
 *
 * ─── Security & Privacy Architecture ───────────────────────────────────────
 * - NO shared or unauthenticated carts: Carts and wishlists are strictly
 *   isolated per authenticated user ID (`hod_cart_${userId}`).
 * - Unauthenticated visitors / guests have NO cart and NO wishlist (`[]`).
 *   An anonymous user can never see or modify any customer's cart (Zero IDOR).
 * - Legacy un-scoped keys (`hod_cart_items_v2`, `hod_cart_items`, etc.) are
 *   permanently purged on initialization so no cross-session or guest leakage
 *   can ever occur.
 * - This is CLIENT DRAFT STATE only. Final checkout and order creation are
 *   always verified and enforced server-side by the Express backend.
 */
import type { CartItem } from '../types/cart';
import type { Product } from '../types/product';

const LEGACY_KEYS = [
  'hod_cart_items_v2',
  'hod_cart_items',
  'hod_wishlist_ids_v2',
  'hod_wishlist_ids',
];

// One-time cleanup of all un-scoped legacy keys across browser sessions
let legacyPurged = false;
function purgeLegacyDrafts(): void {
  if (legacyPurged) return;
  legacyPurged = true;
  try {
    for (const key of LEGACY_KEYS) {
      localStorage.removeItem(key);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[cart] legacy draft cleanup failed:', err instanceof Error ? err.message : err);
  }
}

function getCartKey(userId?: string | null): string | null {
  if (!userId || typeof userId !== 'string' || !userId.trim()) return null;
  return `hod_cart_${userId.trim()}`;
}

function getWishlistKey(userId?: string | null): string | null {
  if (!userId || typeof userId !== 'string' || !userId.trim()) return null;
  return `hod_wishlist_${userId.trim()}`;
}

function readRaw(key: string, label: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    throw new Error(`Browser storage is unavailable, so your ${label} draft could not be read.`);
  }
}

function writeRaw(key: string, label: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    throw new Error(`Browser storage is unavailable, so your ${label} draft could not be saved.`);
  }
}

function parseDraft<T>(key: string, label: string): T | null {
  const raw = readRaw(key, label);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Your saved ${label} draft is corrupted and could not be read.`);
  }
}

export const cartService = {
  /**
   * Returns the user's isolated cart draft.
   * If no user is authenticated, returns an empty array immediately.
   */
  getCart(userId?: string | null): CartItem[] {
    purgeLegacyDrafts();
    const key = getCartKey(userId);
    if (!key) return [];
    const stored = parseDraft<CartItem[]>(key, 'cart');
    if (stored === null) return [];
    if (!Array.isArray(stored)) {
      throw new Error('Your saved cart draft is corrupted and could not be read.');
    }
    return stored;
  },

  saveCart(items: CartItem[], userId?: string | null): void {
    const key = getCartKey(userId);
    if (!key) {
      throw new Error('Authentication required to save items to your cart.');
    }
    writeRaw(key, 'cart', JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('hod_cart_updated', { detail: items }));
  },

  addItem(product: Product, quantity = 1, userId?: string | null): CartItem[] {
    if (!userId) {
      throw new Error('Please sign in to add items to your cart.');
    }
    const cart = this.getCart(userId);
    const existingIndex = cart.findIndex((item) => item.product.id === product.id);
    if (existingIndex > -1) {
      cart[existingIndex].quantity += quantity;
    } else {
      cart.push({
        id: `cart-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        product,
        quantity,
        addedAt: new Date().toISOString(),
      });
    }
    this.saveCart(cart, userId);
    return cart;
  },

  updateQuantity(itemId: string, quantity: number, userId?: string | null): CartItem[] {
    if (!userId) {
      throw new Error('Authentication required to update cart.');
    }
    let cart = this.getCart(userId);
    if (quantity <= 0) {
      cart = cart.filter((i) => i.id !== itemId);
    } else {
      cart = cart.map((i) => (i.id === itemId ? { ...i, quantity } : i));
    }
    this.saveCart(cart, userId);
    return cart;
  },

  removeItem(itemId: string, userId?: string | null): CartItem[] {
    if (!userId) {
      throw new Error('Authentication required to remove cart items.');
    }
    const cart = this.getCart(userId).filter((i) => i.id !== itemId);
    this.saveCart(cart, userId);
    return cart;
  },

  clearCart(userId?: string | null): void {
    if (!userId) return;
    this.saveCart([], userId);
  },
};

export const wishlistService = {
  /**
   * Returns the user's isolated wishlist items.
   * If no user is authenticated, returns an empty array immediately.
   */
  getWishlist(userId?: string | null): string[] {
    purgeLegacyDrafts();
    const key = getWishlistKey(userId);
    if (!key) return [];
    const stored = parseDraft<string[]>(key, 'wishlist');
    if (stored === null) return [];
    if (!Array.isArray(stored)) {
      throw new Error('Your saved wishlist draft is corrupted and could not be read.');
    }
    return stored;
  },

  saveWishlist(ids: string[], userId?: string | null): void {
    const key = getWishlistKey(userId);
    if (!key) {
      throw new Error('Authentication required to save your wishlist.');
    }
    writeRaw(key, 'wishlist', JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent('hod_wishlist_updated', { detail: ids }));
  },

  toggleWishlist(productId: string, userId?: string | null): string[] {
    if (!userId) {
      throw new Error('Please sign in to update your wishlist.');
    }
    let list = this.getWishlist(userId);
    if (list.includes(productId)) {
      list = list.filter((id) => id !== productId);
    } else {
      list.push(productId);
    }
    this.saveWishlist(list, userId);
    return list;
  },

  isInWishlist(productId: string, userId?: string | null): boolean {
    if (!userId) return false;
    return this.getWishlist(userId).includes(productId);
  },

  clearWishlist(userId?: string | null): void {
    if (!userId) return;
    this.saveWishlist([], userId);
  },
};
