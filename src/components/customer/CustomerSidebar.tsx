import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useWishlist } from '../../context/WishlistContext';
import { useToast } from '../../context/ToastContext';
import {
  User,
  Package,
  Heart,
  RotateCcw,
  Store,
  LogOut,
  ChevronRight,
  ShieldCheck,
  KeyRound,
  ArrowLeftRight,
  Menu,
  X,
  Truck
} from 'lucide-react';

interface CustomerSidebarProps {
  activeOrdersCount?: number;
}

export const CustomerSidebar: React.FC<CustomerSidebarProps> = ({ activeOrdersCount: propCount }) => {
  const { user, activeRole, switchRole, logout } = useAuth();
  const { showToast } = useToast();
  const { wishlistCount } = useWishlist();
  const location = useLocation();
  const navigate = useNavigate();

  const [activeCount, setActiveCount] = useState<number>(propCount ?? 0);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (propCount !== undefined) {
      setActiveCount(propCount);
      return;
    }
    if (!user) return;
    import('../../services/orderService').then(({ orderService }) => {
      orderService.getOrders(user.id)
        .then((orders) => {
          const active = orders.filter((o) => o.orderStatus !== 'COD_CANCELLED' && o.orderStatus !== 'COD_DELIVERED').length;
          setActiveCount(active);
        })
        .catch(() => {});
    });
  }, [user, propCount]);

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileDrawerOpen(false);
  }, [location.pathname]);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileDrawerOpen(false);
    };
    if (isMobileDrawerOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileDrawerOpen]);

  const isOrders = location.pathname.startsWith('/orders');
  const isProfile = location.pathname === '/profile' || location.pathname === '/account' || location.pathname === '/dashboard';
  const isWishlist = location.pathname.startsWith('/wishlist');
  const isRefunds = location.pathname.startsWith('/refunds');

  const handleSwitchToSeller = () => {
    switchRole('SELLER');
    navigate('/seller');
  };

  const sidebarNavContent = (
    <div className="space-y-4">
      {/* 1. User Info Header Card (Flipkart Style) */}
      <div className="bg-white rounded-2xl p-4 border border-cream-200 shadow-soft flex items-center gap-3">
        {user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt="Profile photo"
            className="w-12 h-12 rounded-full object-cover border-2 border-cream-300 shadow-xs"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-burgundy text-ivory font-serif font-bold flex items-center justify-center border-2 border-cream-300 shadow-xs shrink-0">
            {user?.fullName?.charAt(0).toUpperCase() || 'K'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <span className="text-[11px] text-stone-500 block leading-tight font-medium">Hello,</span>
          <h2 className="font-serif font-bold text-stone-900 text-sm truncate leading-tight mt-0.5">
            {user?.fullName || 'Valued Patron'}
          </h2>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-[10px] text-burgundy font-semibold uppercase tracking-wider">
              {activeRole} Patron
            </span>
            <span className="font-mono text-[10px] font-bold text-stone-700 bg-cream-100 px-1.5 py-0.5 rounded border border-cream-200">
              {user?.customerId || (user?.businessId?.startsWith('KNCR-') ? user.businessId : user?.businessId?.replace(/^KNSR-/, 'KNCR-')) || 'KNCR-0001'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Navigation Card (Flipkart Menu Structure) */}
      <div className="bg-white rounded-2xl border border-cream-200 shadow-soft overflow-hidden divide-y divide-cream-100">
        {/* SECTION: MY ORDERS */}
        <div className="p-3">
          <Link
            to="/orders"
            onClick={() => setIsMobileDrawerOpen(false)}
            className={`flex items-center justify-between px-3 py-2.5 rounded-xl transition-all font-medium text-xs ${
              isOrders
                ? 'bg-burgundy text-white shadow-xs font-semibold'
                : 'text-stone-700 hover:bg-cream-100 hover:text-stone-900'
            }`}
          >
            <div className="flex items-center gap-3">
              <Package className={`w-4 h-4 ${isOrders ? 'text-white' : 'text-burgundy'}`} />
              <span className="uppercase tracking-wider font-bold text-[11px]">My Orders</span>
            </div>
            <div className="flex items-center gap-2">
              {activeCount > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold shadow-xs ${
                    isOrders
                      ? 'bg-white text-burgundy'
                      : 'bg-burgundy text-white'
                  }`}
                  title={`${activeCount} active order${activeCount > 1 ? 's' : ''}`}
                >
                  {activeCount}
                </span>
              )}
              <ChevronRight className={`w-3.5 h-3.5 ${isOrders ? 'text-white/80' : 'text-stone-400'}`} />
            </div>
          </Link>
        </div>

        {/* SECTION: ACCOUNT SETTINGS */}
        <div className="p-3 space-y-1">
          <div className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
            <User className="w-3 h-3 text-stone-400" />
            <span>Account Settings</span>
          </div>
          <Link
            to="/profile"
            onClick={() => setIsMobileDrawerOpen(false)}
            className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all font-medium ${
              isProfile
                ? 'bg-cream-200 text-burgundy font-bold'
                : 'text-stone-600 hover:bg-cream-100 hover:text-stone-900'
            }`}
          >
            <span>Profile Information</span>
            <ChevronRight className="w-3 h-3 text-stone-400" />
          </Link>
          <a
            href="#security-pin"
            onClick={(e) => {
              setIsMobileDrawerOpen(false);
              if (!isProfile) {
                navigate('/profile#security-pin');
              }
            }}
            className="flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all text-stone-600 hover:bg-cream-100 hover:text-stone-900 font-medium"
          >
            <span>Security PIN & Password</span>
            <KeyRound className="w-3 h-3 text-stone-400" />
          </a>
        </div>

        {/* SECTION: MY STUFF */}
        <div className="p-3 space-y-1">
          <div className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
            <Heart className="w-3 h-3 text-stone-400" />
            <span>My Stuff</span>
          </div>
          <Link
            to="/wishlist"
            onClick={() => setIsMobileDrawerOpen(false)}
            className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all font-medium ${
              isWishlist
                ? 'bg-cream-200 text-burgundy font-bold'
                : 'text-stone-600 hover:bg-cream-100 hover:text-stone-900'
            }`}
          >
            <span>My Wishlist</span>
            {wishlistCount > 0 ? (
              <span className="px-1.5 py-0.5 rounded-full bg-burgundy text-white text-[10px] font-bold leading-none">
                {wishlistCount}
              </span>
            ) : (
              <ChevronRight className="w-3 h-3 text-stone-400" />
            )}
          </Link>
          <Link
            to="/refunds"
            onClick={() => setIsMobileDrawerOpen(false)}
            className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all font-medium ${
              isRefunds
                ? 'bg-cream-200 text-burgundy font-bold'
                : 'text-stone-600 hover:bg-cream-100 hover:text-stone-900'
            }`}
          >
            <span>Refunds & Returns</span>
            <ChevronRight className="w-3 h-3 text-stone-400" />
          </Link>
        </div>

        {/* SECTION: SWITCH TO SELLER / BECOME A SELLER */}
        <div className="p-3">
          {user?.isSellerApproved ? (
            <button
              onClick={() => {
                setIsMobileDrawerOpen(false);
                handleSwitchToSeller();
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold text-burgundy bg-burgundy-50 border border-burgundy-200 hover:bg-burgundy-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-burgundy" />
                <span>Switch to Seller Portal</span>
              </div>
              <ArrowLeftRight className="w-3.5 h-3.5 text-burgundy" />
            </button>
          ) : (
            <Link
              to="/become-seller"
              onClick={() => setIsMobileDrawerOpen(false)}
              className="flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold text-stone-700 hover:bg-cream-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-burgundy" />
                <span>Become a Seller</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
            </Link>
          )}
        </div>

        {/* SECTION: DELIVERY AGENT PORTAL (Visible if user has delivery or admin role) */}
        {(user?.role === 'DELIVERY_PERSON' ||
          user?.roles?.includes('DELIVERY_PERSON') ||
          user?.role === 'ADMIN' ||
          user?.roles?.includes('ADMIN') ||
          user?.roles?.includes('SUPER_ADMIN')) && (
          <div className="p-3">
            <Link
              to="/delivery"
              onClick={() => setIsMobileDrawerOpen(false)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-emerald-700" />
                <span>Delivery Staff Dashboard</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-emerald-700" />
            </Link>
          </div>
        )}

        {/* SECTION: LOGOUT */}
        <div className="p-3">
          <button
            onClick={() => {
              setIsMobileDrawerOpen(false);
              logout().catch((err: unknown) => {
                showToast(
                  err instanceof Error ? err.message : 'Sign out failed. Please try again.',
                  'error',
                );
              });
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-rosered-700 hover:bg-rosered-50 transition-colors text-left"
          >
            <LogOut className="w-4 h-4 text-rosered-600" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ── MOBILE TRIGGER BAR (Visible on screens < md) ── */}
      <div className="md:hidden w-full mb-3">
        <button
          type="button"
          onClick={() => setIsMobileDrawerOpen(true)}
          className="w-full bg-white rounded-2xl p-3 border border-cream-200 shadow-soft flex items-center justify-between text-left active:bg-cream-50 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            {/* Menu trigger button on LEFT */}
            <div className="flex items-center gap-1.5 text-burgundy text-xs font-bold shrink-0 bg-burgundy/10 px-3 py-2 rounded-xl border border-burgundy/20 shadow-xs">
              <Menu className="w-4 h-4" />
              <span>Menu</span>
            </div>

            {/* User Profile Summary */}
            <div className="flex items-center gap-2.5 min-w-0">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt="Profile photo"
                  className="w-8 h-8 rounded-xl object-cover border border-cream-300 shadow-xs shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-xl bg-burgundy text-white font-serif font-bold text-xs flex items-center justify-center border border-cream-300 shadow-xs shrink-0">
                  {user?.fullName?.charAt(0).toUpperCase() || 'K'}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-stone-900 truncate block">{user?.fullName || 'My Account'}</span>
                  <span className="text-[9px] text-burgundy font-bold uppercase tracking-wider bg-cream-100 px-1.5 py-0.5 rounded border border-cream-200 shrink-0">
                    {activeRole}
                  </span>
                </div>
                <p className="text-[10px] text-stone-500 truncate block mt-0.5">
                  Orders ({activeCount}) &bull; Settings
                </p>
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-stone-400 shrink-0 ml-1" />
        </button>
      </div>

      {/* ── MOBILE BACKDROP OVERLAY (Closes when clicking / touching outside on the right) ── */}
      {isMobileDrawerOpen && (
        <div
          onClick={() => setIsMobileDrawerOpen(false)}
          onTouchStart={() => setIsMobileDrawerOpen(false)}
          className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-50 md:hidden transition-opacity cursor-pointer animate-in fade-in duration-200"
          aria-label="Close sidebar overlay"
        />
      )}

      {/* ── MOBILE FULL LEFT SLIDING DRAWER ── */}
      <div
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (touchStartX.current !== null) {
            const diff = touchStartX.current - e.changedTouches[0].clientX;
            if (diff > 50) {
              // Swiped left by at least 50px -> close/shrink drawer
              setIsMobileDrawerOpen(false);
            }
            touchStartX.current = null;
          }
        }}
        className={`fixed inset-y-0 left-0 z-50 w-72 sm:w-80 bg-white border-r border-cream-200 flex flex-col transform transition-transform duration-200 ease-in-out md:hidden shadow-2xl overflow-y-auto ${
          isMobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Drawer Header with Title & Close Button */}
        <div className="p-4 border-b border-cream-200 bg-ivory flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-burgundy text-white font-serif font-bold text-xs flex items-center justify-center">
              K
            </span>
            <span className="font-serif font-bold text-sm text-stone-900">Account Menu</span>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileDrawerOpen(false)}
            className="p-1.5 rounded-xl text-stone-500 hover:text-stone-900 hover:bg-cream-200 transition-colors"
            aria-label="Close Sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1">
          {sidebarNavContent}
        </div>
      </div>

      {/* ── DESKTOP SIDEBAR (Visible on md and above) ── */}
      <aside className="hidden md:block md:w-72 shrink-0 space-y-4 md:sticky md:top-24 self-start">
        {sidebarNavContent}
      </aside>
    </>
  );
};
