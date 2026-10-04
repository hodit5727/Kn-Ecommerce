import React, { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { IS_UI_PREVIEW } from '../../lib/uiPreview';
import {
  LayoutDashboard,
  Package,
  PlusCircle,
  Boxes,
  ShoppingBag,
  TrendingUp,
  Receipt,
  RotateCcw,
  Settings,
  ArrowLeftRight,
  LogOut,
  Menu,
  X,
  Bell,
  Store,
  ChevronRight
} from 'lucide-react';


export const SellerLayout: React.FC = () => {
  const { user, switchRole, logout } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navigation = [
    { name: 'Overview', href: '/seller', icon: LayoutDashboard },
    { name: 'Product Catalog', href: '/seller/products', icon: Package },
    { name: 'Add Product', href: '/seller/products/new', icon: PlusCircle },
    { name: 'Inventory & SKU', href: '/seller/inventory', icon: Boxes },
    { name: 'My Orders', href: '/seller/orders', icon: ShoppingBag },
    { name: 'Revenue Analytics', href: '/seller/revenue', icon: TrendingUp },
    { name: 'Transactions', href: '/seller/transactions', icon: Receipt },
    // "Settlement Payouts" intentionally absent (spec §23): payout is
    // backend/admin-controlled and must never appear in seller navigation.
    { name: 'Refund Claims', href: '/seller/refunds', icon: RotateCcw },
    { name: 'Store Settings', href: '/seller/settings', icon: Settings },
  ];

  const handleSwitchToCustomer = () => {
    switchRole('CUSTOMER');
    navigate('/');
  };


  return (
    <div className="min-h-screen bg-stone-50 flex flex-col md:flex-row text-stone-900">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-cream-200 sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-lg text-stone-600 hover:bg-stone-100"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-burgundy text-white font-serif font-bold text-xs flex items-center justify-center">
              K
            </span>
            <span className="font-serif font-bold text-sm text-stone-900">Seller Studio</span>
          </div>
        </div>
        <button
          onClick={handleSwitchToCustomer}
          className="text-[11px] font-semibold text-burgundy flex items-center gap-1 px-2.5 py-1 rounded-full bg-burgundy-50 border border-burgundy-200"
        >
          <ArrowLeftRight className="w-3 h-3" /> Customer Mode
        </button>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-cream-200 flex flex-col transform transition-transform duration-200 ease-in-out md:translate-x-0 md:static ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand & Store Header */}
        <div className="p-6 border-b border-cream-200 bg-ivory">
          <Link to="/" className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-burgundy flex items-center justify-center text-white font-serif font-bold text-sm">
              K
            </div>
            <span className="font-serif font-extrabold text-stone-900 text-base">K-SHOP LUXURY</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cream-200 text-burgundy flex items-center justify-center font-bold font-serif text-base border border-cream-300">
              <Store className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="font-serif font-bold text-xs text-stone-900 truncate">
                {user?.sellerStoreName || 'Maison Aethelgard'}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="font-mono text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  {user?.sellerId || (user?.businessId?.startsWith('KNSR-') ? user.businessId : user?.businessId?.replace(/^KNCR-/, 'KNSR-')) || 'KNSR-0001'}
                </span>
                <span className="text-[9px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-50/50 px-1.5 py-0.5 rounded-full inline-block border border-emerald-200">
                  Accredited
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Mode Switcher Action Button */}
        <div className="p-4 border-b border-cream-200">
          <button
            onClick={handleSwitchToCustomer}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-ivory border border-cream-300 hover:border-burgundy/40 text-stone-800 text-xs font-semibold transition-all group"
          >
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-3.5 h-3.5 text-burgundy group-hover:rotate-180 transition-transform duration-300" />
              <span>Switch to Customer Mode</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
          </button>
        </div>

        {/* Navigation items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-burgundy text-white shadow-sm'
                    : 'text-stone-600 hover:bg-cream-50 hover:text-stone-900'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </div>

        {/* User footer info */}
        <div className="p-4 border-t border-cream-200 bg-ivory flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-burgundy text-ivory text-xs font-bold flex items-center justify-center shrink-0">
                {user?.fullName.charAt(0).toUpperCase() || 'S'}
              </div>
            )}
            <div className="truncate">
              <p className="text-xs font-semibold text-stone-900 truncate">{user?.fullName}</p>
              <p className="text-[10px] text-stone-500 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={() => {
              logout().catch((err: unknown) => {
                showToast(
                  err instanceof Error ? err.message : 'Sign out failed. Please try again.',
                  'error',
                );
              });
            }}
            className="p-1.5 text-stone-400 hover:text-rosered-600 hover:bg-white rounded-lg transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8">
        {/* UI Preview Mode banner (DEV + ?uiPreview=1 only; stripped from prod builds) */}
        {IS_UI_PREVIEW && (
          <div className="mb-4 -mt-1 p-2 rounded-xl bg-indigo-50 border border-indigo-200 text-[11px] font-bold text-indigo-700 text-center uppercase tracking-widest">
            UI Preview Mode — layout check only · no real seller data · backend pending
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
};
