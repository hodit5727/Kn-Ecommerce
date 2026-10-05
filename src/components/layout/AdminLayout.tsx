import React, { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { IS_UI_PREVIEW } from '../../lib/uiPreview';
import {
  ShieldCheck,
  LayoutDashboard,
  ShoppingBag,
  Package,
  Users,
  Store,
  RotateCcw,
  Receipt,
  Landmark,
  Megaphone,
  Settings,
  ArrowLeftRight,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Ticket,
  UserCheck,
  Activity,
} from 'lucide-react';


export const AdminLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  React.useEffect(() => {
    if (!IS_UI_PREVIEW && !user) {
      navigate('/admin/login', { replace: true, state: { from: location } });
    }
  }, [user, navigate, location]);

  const navigation = [
    { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { name: 'Orders', href: '/admin/orders', icon: ShoppingBag },
    { name: 'Products', href: '/admin/products', icon: Package },
    { name: 'Customers', href: '/admin/customers', icon: Users },
    { name: 'Sellers', href: '/admin/sellers', icon: Store },
    { name: 'Returns & Refunds', href: '/admin/refunds', icon: RotateCcw },
    { name: 'Coupons', href: '/admin/coupons', icon: Ticket },
    { name: 'Seller Settlements', href: '/admin/settlements', icon: Landmark },
    { name: 'Transactions', href: '/admin/transactions', icon: Receipt },
    { name: 'Operators & Staff', href: '/admin/operators', icon: UserCheck },
    { name: 'Logs & Monitoring', href: '/admin/monitoring', icon: Activity },
    { name: 'Announcements', href: '/admin/announcements', icon: Megaphone },
    { name: 'Settings', href: '/admin/settings', icon: Settings },
  ];

  const handleSwitchToCustomer = () => {
    navigate('/');
  };


  return (
    <div className="min-h-screen bg-stone-100/70 flex flex-col md:flex-row text-stone-900">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-stone-200 sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-lg text-stone-600 hover:bg-stone-100"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-stone-900 text-white font-serif font-bold text-xs flex items-center justify-center">
              A
            </span>
            <div>
              <span className="font-serif font-bold text-sm text-stone-900 block leading-none">Admin Portal</span>
              <span className="font-mono text-[10px] text-stone-500 block leading-tight mt-0.5">{user?.email || 'hodit5727@gmail.com'}</span>
            </div>
          </div>
        </div>
        <button
          onClick={handleSwitchToCustomer}
          className="text-[11px] font-semibold text-stone-800 flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-100 border border-stone-300"
        >
          <ArrowLeftRight className="w-3 h-3" /> Customer Mode
        </button>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-stone-200 flex flex-col transform transition-transform duration-200 ease-in-out md:translate-x-0 md:static ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="p-5 border-b border-stone-800 bg-stone-900 text-white">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-xl bg-burgundy flex items-center justify-center text-white font-serif font-bold text-sm border border-burgundy-400">
              <ShieldCheck className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <span className="font-serif font-extrabold text-base tracking-wider block leading-none">
                K-SHOP ADMIN
              </span>
              <span className="text-[9px] uppercase tracking-widest text-amber-300 font-bold block mt-1">
                Admin Portal
              </span>
            </div>
          </div>
          {/* Admin Email & Privilege Tag */}
          <div className="p-2 rounded-xl bg-stone-800/80 border border-stone-700 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="font-mono text-[11px] text-stone-200 truncate">{user?.email || 'hodit5727@gmail.com'}</span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 font-bold text-[9px] uppercase tracking-wider shrink-0 ml-1">
              Admin
            </span>
          </div>
        </div>

        {/* Mode Switcher Action Button */}
        <div className="p-3 border-b border-stone-200 bg-stone-50">
          <button
            onClick={handleSwitchToCustomer}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white border border-stone-300 hover:border-burgundy text-stone-800 text-xs font-semibold transition-all group"
          >
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-3.5 h-3.5 text-burgundy group-hover:rotate-180 transition-transform duration-300" />
              <span>Return to Storefront</span>
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
                    ? 'bg-stone-900 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0 text-amber-600" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </div>

        {/* Admin footer */}
        <div className="p-4 border-t border-stone-200 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-burgundy text-ivory text-xs font-bold flex items-center justify-center shrink-0">
                {user?.fullName?.charAt(0)?.toUpperCase() || 'A'}
              </div>
            )}
            <div className="truncate">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-stone-900 truncate">{user?.fullName || 'Administrator'}</p>
                <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-1 py-0.2 rounded border border-amber-200">SUPER ADMIN</span>
              </div>
              <p className="text-[10px] font-mono text-stone-500 truncate">{user?.email || 'hodit5727@gmail.com'}</p>
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
      <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-8 lg:p-10">
        {/* UI Preview Mode banner (DEV + ?uiPreview=1 only; stripped from prod builds) */}
        {IS_UI_PREVIEW && (
          <div className="mb-4 -mt-1 p-2 rounded-xl bg-indigo-50 border border-indigo-200 text-[11px] font-bold text-indigo-700 text-center uppercase tracking-widest">
            UI Preview Mode — layout check only · no real admin data · backend pending
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
};
