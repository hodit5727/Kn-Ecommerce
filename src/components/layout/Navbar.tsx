import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { AuthModal } from '../auth/AuthModal';
import {
  ShoppingBag,
  Heart,
  User,
  Store,
  LogOut,
  ChevronDown,
  Sparkles,
  Package,
  Layers,
  RotateCcw,
  Smartphone,
  Laptop,
  Shirt,
  BookOpen,
  Watch,
  UtensilsCrossed,
  Apple,
  LayoutGrid,
  Home as HomeIcon,
  Bell,
} from 'lucide-react';
import { productService } from '../../services/productService';
import { announcementService } from '../../services/announcementService';
import type { Announcement } from '../../types/announcement';
import { useToast } from '../../context/ToastContext';
import { IS_UI_PREVIEW } from '../../lib/uiPreview';
import { Button } from '../common/Button';

const CATEGORY_NAV_ITEMS = [
  { id: 'Home', label: 'Home', icon: HomeIcon },
  { id: 'Timepieces', label: 'Watches', icon: Watch },
  { id: 'Fashion', label: 'Fashion', icon: Shirt },
  { id: 'Mobiles', label: 'Mobiles', icon: Smartphone },
  { id: 'Electronics', label: 'Electronics', icon: Laptop },
  { id: 'Beauty', label: 'Beauty', icon: Sparkles },
  { id: 'Books', label: 'Books', icon: BookOpen },
];

const ALL_CATEGORIES_MENU = [
  { id: 'All', label: 'All Products / Full Catalog', icon: LayoutGrid },
  { id: 'Timepieces', label: 'Watches & Timepieces', icon: Watch },
  { id: 'Fashion', label: 'Fashion & Apparel', icon: Shirt },
  { id: 'Mobiles', label: 'Mobiles & Tablets', icon: Smartphone },
  { id: 'Electronics', label: 'Laptops & Computers', icon: Laptop },
  { id: 'Beauty', label: 'Beauty & Personal Care', icon: Sparkles },
  { id: 'Home & Kitchen', label: 'Home & Living', icon: UtensilsCrossed },
  { id: 'Books', label: 'Books & Stationery', icon: BookOpen },
  { id: 'Grocery & Beverages', label: 'Gourmet & Beverages', icon: Apple },
];

export const Navbar: React.FC = () => {
  const { user, activeRole, switchRole, logout, isAuthModalOpen, openAuthModal, closeAuthModal, sessionError, clearSessionError } = useAuth();
  const { showToast } = useToast();
  const { openCartDrawer, itemCount } = useCart();
  const { wishlistCount } = useWishlist();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [activeOrdersCount, setActiveOrdersCount] = useState<number>(0);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  // 'All' is a UI filter control, not catalog data — real categories come
  // from the backend below (no hardcoded category fixtures).
  const [categories, setCategories] = useState<string[]>(['All']);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Fetch active customer orders for notification badge
  useEffect(() => {
    if (!user) {
      setActiveOrdersCount(0);
      return;
    }
    import('../../services/orderService').then(({ orderService }) => {
      orderService.getOrders(user.id)
        .then((orders) => {
          const active = orders.filter(
            (o) => o.orderStatus !== 'COD_CANCELLED' && o.orderStatus !== 'COD_DELIVERED'
          ).length;
          setActiveOrdersCount(active);
        })
        .catch(() => {});
    });
  }, [user]);

  // Fetch admin announcements broadcast
  useEffect(() => {
    announcementService.getAnnouncements()
      .then((items) => {
        const active = (items || []).filter((a) => a.status === 'ACTIVE');
        setAnnouncements(active);
        setUnreadAnnouncements(active.length);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    productService.getCategories().then((cats) => {
      if (cats && cats.length > 0) {
        setCategories(cats);
      }
    }).catch((error: unknown) => {
      // Surface the failure to the user instead of swallowing it.
      showToast(
        error instanceof Error ? error.message : 'Unable to load product categories.',
        'error'
      );
    });
  }, []);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      setSearchQuery(q);
    } else if (location.pathname !== '/products') {
      setSearchQuery('');
    }
  }, [searchParams, location.pathname]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/products?q=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      navigate('/products');
    }
  };

  const handleCategorySelect = (categoryId: string) => {
    if (categoryId === 'Home') {
      navigate('/home');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      navigate(`/home?category=${encodeURIComponent(categoryId)}`);
      setTimeout(() => {
        const el = document.getElementById('catalog-index');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
      }, 50);
    }
  };

  const currentCategoryParam = searchParams.get('category');
  const isHomeActive = location.pathname === '/' || location.pathname === '/home';
  const hasSpecificCategory = !!currentCategoryParam && currentCategoryParam.toLowerCase() !== 'all';

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-cream-200/90 transition-all">
        {/* UI Preview Mode banner (DEV + ?uiPreview=1 only; stripped from prod builds) */}
        {IS_UI_PREVIEW && (
          <div className="bg-indigo-600 text-white text-[10px] sm:text-[11px] py-1.5 px-4 text-center font-bold uppercase tracking-widest">
            UI Preview Mode — layout check only · no real OTP · no data saved
          </div>
        )}
        {/* Session verification error (server unavailable / sign-out failure) */}
        {sessionError && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-[11px] px-4 py-1.5 flex items-center justify-between gap-3">
            <span className="truncate">{sessionError}</span>
            <button
              onClick={clearSessionError}
              aria-label="Dismiss"
              className="shrink-0 font-bold text-amber-700 hover:text-amber-900"
            >
              ✕
            </button>
          </div>
        )}

        {/* Top announcement bar */}
        <div className="bg-burgundy text-cream-100 text-[11px] font-medium py-1.5 px-4 text-center tracking-wider uppercase flex items-center justify-center gap-2">
          <span>Haute Horlogerie & Artisanal Marketplace</span>
          <span className="opacity-40">•</span>
          <span className="text-amber-200 font-semibold">Cash On Delivery Protocol</span>
          <span className="opacity-40">•</span>
          <span>Complimentary White-Glove Courier Over ₹10,000</span>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* Brand Monogram */}
            <Link to="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl bg-burgundy flex items-center justify-center text-ivory font-serif font-bold text-xl shadow-soft group-hover:bg-burgundy-800 transition-colors">
                K
              </div>
              <div>
                <span className="font-serif font-extrabold text-2xl tracking-wider text-stone-900 block leading-none">
                  K-SHOP
                </span>
                <span className="text-[9px] uppercase tracking-widest text-burgundy font-bold">
                  Sovereign Luxury
                </span>
              </div>
            </Link>

            {/* Category Icons & Dropdown - Centered in Navbar Middle */}
            <div className="flex-1 flex items-center justify-center px-2 sm:px-6 overflow-x-auto scrollbar-none">
              <div className="flex items-center gap-2.5 sm:gap-4 lg:gap-6 shrink-0">
                {/* All Categories Dropdown Menu */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                    className={`flex items-center gap-1.5 py-1.5 px-3 rounded-xl border text-xs font-semibold transition-all focus:outline-none ${
                      isCategoryDropdownOpen
                        ? 'bg-burgundy text-white border-burgundy shadow-sm'
                        : 'bg-cream-100/80 hover:bg-cream-200/80 border-cream-300 text-stone-800'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">All</span>
                    <span>Categories</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        isCategoryDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {/* Dropdown Menu Modal */}
                  {isCategoryDropdownOpen && (
                    <div
                      className="absolute left-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-cream-200 py-2 z-50 text-xs animate-fadeIn"
                      onClick={() => setIsCategoryDropdownOpen(false)}
                    >
                      <div className="px-3.5 py-2 border-b border-cream-100 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                          Select Category
                        </span>
                        <span className="text-[9px] font-bold bg-cream-100 text-burgundy px-1.5 py-0.5 rounded">
                          {ALL_CATEGORIES_MENU.length} Options
                        </span>
                      </div>
                      <div className="max-h-72 overflow-y-auto py-1 divide-y divide-cream-50">
                        {ALL_CATEGORIES_MENU.map((cat) => {
                          const CatIcon = cat.icon;
                          const isCatActive = cat.id === 'All'
                            ? !hasSpecificCategory
                            : currentCategoryParam?.toLowerCase() === cat.id.toLowerCase();
                          return (
                            <button
                              key={cat.id}
                              onClick={() => {
                                handleCategorySelect(cat.id);
                                setIsCategoryDropdownOpen(false);
                              }}
                              className={`w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-cream-50 text-left transition-colors text-xs ${
                                isCatActive ? 'bg-cream-100/70 font-bold text-burgundy' : 'text-stone-700'
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-6 h-6 rounded-lg bg-cream-100 text-burgundy flex items-center justify-center shrink-0">
                                  <CatIcon className="w-3.5 h-3.5" />
                                </div>
                                <span>{cat.label}</span>
                              </div>
                              {isCatActive && (
                                <span className="w-1.5 h-1.5 rounded-full bg-burgundy shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {CATEGORY_NAV_ITEMS.map((item) => {
                  const IconComponent = item.icon;
                  const isSelected = item.id === 'Home'
                    ? isHomeActive && !hasSpecificCategory
                    : currentCategoryParam?.toLowerCase() === item.id.toLowerCase();

                  return (
                    <button
                      key={item.id}
                      onClick={() => handleCategorySelect(item.id)}
                      className="flex flex-col items-center gap-1 py-1 px-2 rounded-xl group transition-all shrink-0 relative focus:outline-none"
                    >
                      {/* Icon container */}
                      <div
                        className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${
                          isSelected
                            ? 'bg-burgundy text-white shadow-soft scale-105'
                            : 'bg-cream-100/80 text-stone-700 group-hover:bg-amber-100 group-hover:text-burgundy group-hover:scale-105'
                        }`}
                      >
                        <IconComponent className="w-4 h-4 transition-transform" />
                      </div>

                      {/* Label */}
                      <span
                        className={`text-[10px] sm:text-[11px] font-semibold tracking-wide transition-colors ${
                          isSelected ? 'text-burgundy font-bold' : 'text-stone-600 group-hover:text-burgundy'
                        }`}
                      >
                        {item.label}
                      </span>

                      {/* Active Underline Indicator */}
                      {isSelected && (
                        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-burgundy rounded-full shadow-xs" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {/* Become a Seller / Seller Hub link */}
              {user?.isSellerApproved ? (
                <Link
                  to="/seller"
                  onClick={() => switchRole('SELLER')}
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-cream-300 hover:border-burgundy/50 bg-ivory text-stone-800 hover:text-burgundy text-xs font-semibold transition-all"
                  title="Switch to Seller Portal"
                >
                  <Store className="w-4 h-4 text-burgundy" />
                  <span>Seller Portal</span>
                </Link>
              ) : (
                <Link
                  to="/become-seller"
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-cream-300 hover:border-burgundy/50 bg-ivory text-stone-800 hover:text-burgundy text-xs font-semibold transition-all"
                  title="Become an accredited artisan seller"
                >
                  <Store className="w-4 h-4 text-burgundy" />
                  <span>Become a Seller</span>
                </Link>
              )}

              {/* Notification Bell Action (Admin Announcements) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsNotificationsOpen(!isNotificationsOpen);
                    if (isUserMenuOpen) setIsUserMenuOpen(false);
                  }}
                  className="relative p-2.5 rounded-xl text-stone-700 hover:text-burgundy hover:bg-ivory transition-colors"
                  title="Announcements & Notices"
                >
                  <Bell className="w-5 h-5" />
                  {unreadAnnouncements > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-burgundy text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                      {unreadAnnouncements}
                    </span>
                  )}
                </button>

                {/* Notifications Dropdown */}
                {isNotificationsOpen && (
                  <div
                    className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-cream-200 py-3 z-50 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-4 py-2 border-b border-cream-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-burgundy" />
                        <h4 className="font-serif font-bold text-stone-900 text-sm">Announcements & Notices</h4>
                      </div>
                      {unreadAnnouncements > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-burgundy/10 text-burgundy font-bold">
                          {unreadAnnouncements} Active
                        </span>
                      )}
                    </div>

                    <div className="max-h-80 overflow-y-auto divide-y divide-cream-100 p-2">
                      {announcements.length === 0 ? (
                        <div className="py-8 text-center text-stone-400">
                          <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          <p className="font-medium text-xs">No active announcements</p>
                          <p className="text-[11px] text-stone-400 mt-0.5">Admin notices will appear here</p>
                        </div>
                      ) : (
                        announcements.map((ann) => (
                          <div key={ann.id} className="p-3 hover:bg-cream-50/60 rounded-xl transition-colors space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-stone-900 text-xs truncate">{ann.title}</span>
                              <span
                                className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                  ann.priority === 'URGENT'
                                    ? 'bg-red-100 text-red-700'
                                    : ann.priority === 'HIGH'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-cream-100 text-stone-700'
                                }`}
                              >
                                {ann.priority}
                              </span>
                            </div>
                            <p className="text-stone-600 text-[11px] leading-relaxed line-clamp-3">
                              {ann.message}
                            </p>
                            <div className="text-[10px] text-stone-400 pt-1">
                              {new Date(ann.createdAt).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Wishlist Action */}
              <Link
                to="/wishlist"
                className="relative p-2.5 rounded-xl text-stone-700 hover:text-burgundy hover:bg-ivory transition-colors"
                title="Wishlist"
              >
                <Heart className="w-5 h-5" />
                {wishlistCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-burgundy text-white text-[10px] font-bold flex items-center justify-center">
                    {wishlistCount}
                  </span>
                )}
              </Link>

              {/* Shopping Bag Action */}
              <button
                onClick={openCartDrawer}
                className="relative p-2.5 rounded-xl text-stone-700 hover:text-burgundy hover:bg-ivory transition-colors"
                title="Shopping Bag"
              >
                <ShoppingBag className="w-5 h-5" />
                {itemCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-burgundy text-white text-[10px] font-bold flex items-center justify-center">
                    {itemCount}
                  </span>
                )}
              </button>

              {/* User: Login button or profile menu */}
              {!user ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={openAuthModal}
                  className="flex items-center gap-1.5"
                >
                  <User className="w-4 h-4" />
                  <span>Login</span>
                </Button>
              ) : (
                <div className="relative">
                  <button
                    onClick={() => {
                      setIsUserMenuOpen(!isUserMenuOpen);
                      if (isNotificationsOpen) setIsNotificationsOpen(false);
                    }}
                    className="flex items-center gap-2 p-1.5 rounded-xl border border-cream-300 hover:border-burgundy/50 bg-white transition-all shadow-xs"
                  >
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt="User"
                        className="w-7 h-7 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-burgundy text-ivory text-xs font-bold flex items-center justify-center">
                        {user.fullName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="text-left hidden lg:block">
                      <span className="text-[11px] font-semibold text-stone-900 block leading-tight truncate max-w-[100px]">
                        {user.fullName.split(' ')[0]}
                      </span>
                      <span className="text-[9px] uppercase font-bold text-burgundy block leading-none">
                        {activeRole}
                      </span>
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                  </button>

                  {/* Dropdown Menu */}
                  {isUserMenuOpen && (
                    <div
                      className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-cream-200 py-2 z-50 text-xs"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      <div className="px-4 py-3 border-b border-cream-200">
                        <p className="font-serif font-bold text-stone-900 text-sm">{user?.fullName}</p>
                        <p className="text-stone-500 text-[11px] truncate">{user?.email}</p>
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded-full bg-cream-100 text-stone-800 text-[10px] font-bold">
                            {activeRole}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-stone-700 bg-stone-100 px-2 py-0.5 rounded-md border border-stone-200">
                            {activeRole === 'SELLER'
                              ? `Seller: ${user?.sellerId || (user?.businessId?.replace(/^KNCR-/, 'KNSR-')) || 'KNSR-0001'}`
                              : `Patron: ${user?.customerId || (user?.businessId?.replace(/^KNSR-/, 'KNCR-')) || 'KNCR-0001'}`}
                          </span>
                        </div>
                      </div>

                      <div className="py-1">
                        <Link to="/products" className="flex items-center gap-2 px-4 py-2 hover:bg-cream-50 text-stone-700 font-medium">
                          <Layers className="w-4 h-4 text-stone-400" /> Curated Catalog
                        </Link>
                        <Link to="/orders" className="flex items-center justify-between px-4 py-2 hover:bg-cream-50 text-stone-700">
                          <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-stone-400" /> My Orders
                          </div>
                          {activeOrdersCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-burgundy text-white text-[10px] font-bold leading-none">
                              {activeOrdersCount}
                            </span>
                          )}
                        </Link>
                        <Link to="/refunds" className="flex items-center gap-2 px-4 py-2 hover:bg-cream-50 text-stone-700">
                          <RotateCcw className="w-4 h-4 text-stone-400" /> Refunds & Returns
                        </Link>
                        <Link to="/profile" className="flex items-center gap-2 px-4 py-2 hover:bg-cream-50 text-stone-700">
                          <User className="w-4 h-4 text-stone-400" /> Account Profile
                        </Link>
                        <button
                          onClick={() => {
                            logout().catch((err: unknown) => {
                              showToast(
                                err instanceof Error ? err.message : 'Sign out failed. Please try again.',
                                'error',
                              );
                            });
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 hover:bg-rosered-50 text-rosered-700 text-left"
                        >
                          <LogOut className="w-4 h-4 text-rosered-600" /> Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Auth Modal */}
      {isAuthModalOpen && <AuthModal onClose={closeAuthModal} />}
    </>
  );
};
