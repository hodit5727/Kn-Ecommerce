import React, { useState, useEffect } from 'react';
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
  ArrowLeftRight
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

  const isOrders = location.pathname.startsWith('/orders');
  const isProfile = location.pathname === '/profile' || location.pathname === '/account' || location.pathname === '/dashboard';
  const isWishlist = location.pathname.startsWith('/wishlist');
  const isRefunds = location.pathname.startsWith('/refunds');

  const handleSwitchToSeller = () => {
    switchRole('SELLER');
    navigate('/seller');
  };


  return (
    <aside className="w-full md:w-72 shrink-0 space-y-4 md:sticky md:top-24 self-start">
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
            {user?.fullName.charAt(0).toUpperCase() || 'K'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <span className="text-[11px] text-stone-500 block leading-tight font-medium">Hello,</span>
          <h2 className="font-serif font-bold text-stone-900 text-sm truncate leading-tight mt-0.5">
            {user?.fullName}
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
              onClick={handleSwitchToSeller}
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

        {/* SECTION: LOGOUT */}
        <div className="p-3">
          <button
            onClick={() => {
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
    </aside>
  );
};
