import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import {
  Home,
  Layers,
  Heart,
  ShoppingBag,
  User,
  Package
} from 'lucide-react';

export const MobileBottomNav: React.FC = () => {
  const location = useLocation();
  const { user, openAuthModal } = useAuth();
  const { openCartDrawer, itemCount } = useCart();
  const { wishlistCount } = useWishlist();

  const isHome = location.pathname === '/' || location.pathname === '/home';
  const isCatalog = location.pathname === '/products';
  const isWishlist = location.pathname === '/wishlist';
  const isOrders = location.pathname === '/orders';
  const isProfile = location.pathname === '/profile';

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-cream-200/90 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] md:hidden transition-all"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="grid grid-cols-5 h-14 items-center">
        {/* 1. Home */}
        <Link
          to="/"
          className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors ${
            isHome ? 'text-burgundy' : 'text-stone-500 hover:text-stone-800'
          }`}
          title="Home"
        >
          <Home className={`w-5 h-5 ${isHome ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
          <span className="text-[10px] font-semibold tracking-tight mt-0.5">Home</span>
        </Link>

        {/* 2. Catalog / Categories */}
        <Link
          to="/products"
          className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors ${
            isCatalog ? 'text-burgundy' : 'text-stone-500 hover:text-stone-800'
          }`}
          title="Curated Catalog"
        >
          <Layers className={`w-5 h-5 ${isCatalog ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
          <span className="text-[10px] font-semibold tracking-tight mt-0.5">Catalog</span>
        </Link>

        {/* 3. Wishlist */}
        <Link
          to="/wishlist"
          className={`relative flex flex-col items-center justify-center h-full min-h-[44px] transition-colors ${
            isWishlist ? 'text-burgundy' : 'text-stone-500 hover:text-stone-800'
          }`}
          title="Wishlist"
        >
          <div className="relative">
            <Heart className={`w-5 h-5 ${isWishlist ? 'fill-burgundy stroke-[2.5]' : 'stroke-[1.75]'}`} />
            {wishlistCount > 0 && (
              <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-burgundy text-white text-[9px] font-bold flex items-center justify-center">
                {wishlistCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-semibold tracking-tight mt-0.5">Wishlist</span>
        </Link>

        {/* 4. Cart / Bag */}
        <button
          type="button"
          onClick={openCartDrawer}
          className="relative flex flex-col items-center justify-center h-full min-h-[44px] text-stone-500 hover:text-stone-800 transition-colors"
          title="Shopping Bag"
        >
          <div className="relative">
            <ShoppingBag className="w-5 h-5 stroke-[1.75]" />
            {itemCount > 0 && (
              <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-burgundy text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
                {itemCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-semibold tracking-tight mt-0.5">Bag</span>
        </button>

        {/* 5. Account / Login */}
        {user ? (
          <Link
            to="/profile"
            className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors ${
              isProfile ? 'text-burgundy' : 'text-stone-500 hover:text-stone-800'
            }`}
            title="Profile"
          >
            <User className={`w-5 h-5 ${isProfile ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
            <span className="text-[10px] font-semibold tracking-tight mt-0.5 truncate max-w-[54px]">
              {user.fullName.split(' ')[0]}
            </span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={openAuthModal}
            className="flex flex-col items-center justify-center h-full min-h-[44px] text-stone-500 hover:text-burgundy transition-colors"
            title="Sign in"
          >
            <User className="w-5 h-5 stroke-[1.75]" />
            <span className="text-[10px] font-semibold tracking-tight mt-0.5">Sign In</span>
          </button>
        )}
      </div>
    </nav>
  );
};
