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
  Search,
  X as CloseIcon,
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
    } else if (categoryId === 'All') {
      navigate('/products');
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
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-cream-200/90 shadow-2xs transition-all">
        {/* UI Preview Mode banner */}
        {IS_UI_PREVIEW && (
          <div className="bg-indigo-600 text-white text-[10px] sm:text-[11px] py-1 px-4 text-center font-bold uppercase tracking-widest">
            UI Preview Mode — layout check only · no real OTP
          </div>
        )}
        {/* Session verification error */}
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

        {/* ── TOP ANNOUNCEMENT BAR ─────────────────────────────────────── */}
        {/* Desktop View */}
        <div className="hidden md:flex bg-burgundy text-cream-100 text-[11px] font-medium py-1.5 px-4 text-center tracking-wider uppercase items-center justify-center gap-3">
          <span>Haute Horlogerie & Artisanal Marketplace</span>
          <span className="opacity-40">•</span>
          <span className="text-amber-200 font-semibold">Cash On Delivery Protocol</span>
          <span className="opacity-40">•</span>
          <span>Complimentary White-Glove Courier Over ₹10,000</span>
        </div>

        {/* Mobile View: Compact Single Line Ticker */}
        <div className="flex md:hidden bg-burgundy text-cream-100 text-[10px] font-semibold py-1.5 px-3 text-center tracking-wider uppercase items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap">
          <span className="text-amber-200 font-bold">100% COD PROTOCOL</span>
          <span className="opacity-40">•</span>
          <span className="truncate">WHITE-GLOVE COURIER OVER ₹10,000</span>
        </div>

        {/* ── MAIN NAVBAR ROW ──────────────────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16 md:h-20 gap-2 sm:gap-4">
            
            {/* Brand Logo (Clean Typography - Square box removed as requested) */}
            <Link to="/" className="flex flex-col items-start leading-none group shrink-0 focus:outline-none">
              <span className="font-serif font-black text-xl sm:text-2xl tracking-wider text-stone-900 group-hover:text-burgundy transition-colors">
                K-SHOP
              </span>
              <span className="text-[8px] sm:text-[9px] uppercase tracking-widest text-burgundy font-bold mt-0.5">
                Sovereign Luxury
              </span>
            </Link>

            {/* Desktop Center Categories Navigation (Hidden on Mobile) */}
            <div className="hidden md:flex flex-1 items-center justify-center px-4 overflow-x-auto scrollbar-none">
              <div className="flex items-center gap-2 lg:gap-4 shrink-0">
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
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${
                          isSelected
                            ? 'bg-burgundy text-white shadow-soft scale-105'
                            : 'bg-cream-100/80 text-stone-700 group-hover:bg-amber-100 group-hover:text-burgundy'
                        }`}
                      >
                        <IconComponent className="w-4 h-4 transition-transform" />
                      </div>
                      <span
                        className={`text-[10px] font-semibold tracking-wide transition-colors ${
                          isSelected ? 'text-burgundy font-bold' : 'text-stone-600 group-hover:text-burgundy'
                        }`}
                      >
                        {item.label}
                      </span>
                      {isSelected && (
                        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-burgundy rounded-full shadow-xs" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Desktop Search Bar (md:block) */}
            <div className="hidden lg:block w-56 xl:w-72">
              <form onSubmit={handleSearchSubmit} className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search catalog..."
                  className="w-full bg-cream-50/80 border border-cream-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
                />
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-2.5" />
              </form>
            </div>

            {/* Right Action Icons (Notifications, Wishlist, Cart, Profile) */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {/* Seller Hub link (Desktop only) */}
              {user?.isSellerApproved ? (
                <Link
                  to="/seller"
                  onClick={() => switchRole('SELLER')}
                  className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-cream-300 hover:border-burgundy/50 bg-ivory text-stone-800 hover:text-burgundy text-xs font-semibold transition-all"
                  title="Seller Hub"
                >
                  <Store className="w-3.5 h-3.5 text-burgundy" />
                  <span>Seller</span>
                </Link>
              ) : (
                <Link
                  to="/become-seller"
                  className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-cream-300 hover:border-burgundy/50 bg-ivory text-stone-800 hover:text-burgundy text-xs font-semibold transition-all"
                  title="Become a Seller"
                >
                  <Store className="w-3.5 h-3.5 text-burgundy" />
                  <span>Sell</span>
                </Link>
              )}

              {/* Notification Bell (Hidden on small mobile) */}
              <div className="relative hidden sm:block">
                <button
                  type="button"
                  onClick={() => {
                    setIsNotificationsOpen(!isNotificationsOpen);
                    if (isUserMenuOpen) setIsUserMenuOpen(false);
                  }}
                  className="relative p-2 rounded-xl text-stone-700 hover:text-burgundy hover:bg-cream-50 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  title="Announcements & Notices"
                >
                  <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                  {unreadAnnouncements > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-burgundy text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
                      {unreadAnnouncements}
                    </span>
                  )}
                </button>

                {/* Notifications Dropdown */}
                {isNotificationsOpen && (
                  <div
                    className="absolute right-0 mt-2 w-72 sm:w-80 bg-white rounded-2xl shadow-2xl border border-cream-200 py-3 z-50 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-4 py-2 border-b border-cream-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-burgundy" />
                        <h4 className="font-serif font-bold text-stone-900 text-sm">Notices</h4>
                      </div>
                      {unreadAnnouncements > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-burgundy/10 text-burgundy font-bold">
                          {unreadAnnouncements} Active
                        </span>
                      )}
                    </div>

                    <div className="max-h-72 overflow-y-auto divide-y divide-cream-100 p-2">
                      {announcements.length === 0 ? (
                        <div className="py-6 text-center text-stone-400">
                          <p className="font-medium text-xs">No active notices</p>
                        </div>
                      ) : (
                        announcements.map((ann) => (
                          <div key={ann.id} className="p-2.5 hover:bg-cream-50/60 rounded-xl transition-colors space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-stone-900 text-xs truncate">{ann.title}</span>
                              <span
                                className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                  ann.priority === 'URGENT'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-cream-100 text-stone-700'
                                }`}
                              >
                                {ann.priority}
                              </span>
                            </div>
                            <p className="text-stone-600 text-[11px] leading-relaxed line-clamp-2">
                              {ann.message}
                            </p>
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
                className="relative p-2 rounded-xl text-stone-700 hover:text-burgundy hover:bg-cream-50 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                title="Wishlist"
              >
                <Heart className="w-4 h-4 sm:w-5 sm:h-5" />
                {wishlistCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-burgundy text-white text-[9px] font-bold flex items-center justify-center">
                    {wishlistCount}
                  </span>
                )}
              </Link>

              {/* Shopping Bag Action */}
              <button
                onClick={openCartDrawer}
                className="relative p-2 rounded-xl text-stone-700 hover:text-burgundy hover:bg-cream-50 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                title="Shopping Bag"
              >
                <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5" />
                {itemCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-burgundy text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
                    {itemCount}
                  </span>
                )}
              </button>

              {/* User: Login button (Desktop) or compact avatar/icon (Mobile) */}
              {!user ? (
                <>
                  {/* Mobile Compact Login Button */}
                  <button
                    type="button"
                    onClick={openAuthModal}
                    className="flex md:hidden p-2 rounded-xl text-stone-700 hover:text-burgundy hover:bg-cream-50 transition-colors min-h-[44px] min-w-[44px] items-center justify-center"
                    title="Sign in"
                  >
                    <User className="w-5 h-5" />
                  </button>

                  {/* Desktop Full Login Button */}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={openAuthModal}
                    className="hidden md:flex items-center gap-1.5"
                  >
                    <User className="w-4 h-4" />
                    <span>Login</span>
                  </Button>
                </>
              ) : (
                <div className="relative">
                  <button
                    onClick={() => {
                      setIsUserMenuOpen(!isUserMenuOpen);
                      if (isNotificationsOpen) setIsNotificationsOpen(false);
                    }}
                    className="flex items-center gap-1.5 p-1 rounded-xl border border-cream-300 hover:border-burgundy/50 bg-white transition-all shadow-xs min-h-[44px] min-w-[44px] justify-center"
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
                    <div className="text-left hidden lg:block pr-1">
                      <span className="text-[11px] font-semibold text-stone-900 block leading-tight truncate max-w-[85px]">
                        {user.fullName.split(' ')[0]}
                      </span>
                      <span className="text-[8px] uppercase font-bold text-burgundy block leading-none">
                        {activeRole}
                      </span>
                    </div>
                    <ChevronDown className="w-3 h-3 text-stone-400 hidden sm:block" />
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
                          <span className="font-mono text-[9px] font-bold text-stone-700 bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200">
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
                          className="w-full flex items-center gap-2 px-4 py-2 hover:bg-rosered-50 text-rosered-700 text-left font-semibold"
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

          {/* ── ROW 2 ON MOBILE: Full-Width Search Bar ─────────────────── */}
          <div className="block md:hidden pb-2.5">
            <form onSubmit={handleSearchSubmit} className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search watches, jewelry, audio, fashion..."
                className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-9 pr-8 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy placeholder:text-stone-400"
              />
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-stone-400 hover:text-stone-600 p-0.5"
                >
                  <CloseIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </form>
          </div>

          {/* ── ROW 3 ON MOBILE: Horizontal Category Scroll Pills ──────── */}
          <div className="block md:hidden pb-2 overflow-x-auto scrollbar-none">
            <div className="flex items-center gap-1.5 whitespace-nowrap text-xs">
              <button
                type="button"
                onClick={() => handleCategorySelect('All')}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all shrink-0 ${
                  !hasSpecificCategory
                    ? 'bg-burgundy text-white shadow-2xs'
                    : 'bg-cream-100 text-stone-700 border border-cream-200'
                }`}
              >
                All Catalog
              </button>
              {CATEGORY_NAV_ITEMS.filter((it) => it.id !== 'Home').map((cat) => {
                const isSelected = currentCategoryParam?.toLowerCase() === cat.id.toLowerCase();
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleCategorySelect(cat.id)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all shrink-0 ${
                      isSelected
                        ? 'bg-burgundy text-white shadow-2xs'
                        : 'bg-cream-100 text-stone-700 border border-cream-200 hover:bg-cream-200'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* Auth Modal */}
      {isAuthModalOpen && <AuthModal onClose={closeAuthModal} />}
    </>
  );
};
