import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RoleGuard } from '../rbac/RoleGuard';

// Customer Layout (Eager)
import { CustomerLayout } from '../components/layout/CustomerLayout';

// Administrative & Seller Layouts (Lazy loaded on demand)
const SellerLayout = lazy(() => import('../components/layout/SellerLayout').then(m => ({ default: m.SellerLayout })));
const AdminLayout = lazy(() => import('../components/layout/AdminLayout').then(m => ({ default: m.AdminLayout })));

// Core Storefront Page (Eagerly loaded for instant first paint)
import { HomePage } from '../pages/customer/HomePage';

// Storefront Secondary & Conversion Pages (Eagerly import ProductDetailPage for instant zero-delay render)
import { ProductDetailPage } from '../pages/customer/ProductDetailPage';
const ProductsPage = lazy(() => import('../pages/customer/ProductsPage').then(m => ({ default: m.ProductsPage })));
const CartPage = lazy(() => import('../pages/customer/CartPage').then(m => ({ default: m.CartPage })));
const CheckoutPage = lazy(() => import('../pages/customer/CheckoutPage').then(m => ({ default: m.CheckoutPage })));
const OrdersPage = lazy(() => import('../pages/customer/OrdersPage').then(m => ({ default: m.OrdersPage })));
const LoginPage = lazy(() => import('../pages/auth/LoginPage').then(m => ({ default: m.LoginPage })));

// Customer Secondary Pages (Lazy loaded on demand)
const OrderDetailPage = lazy(() => import('../pages/customer/OrderDetailPage').then(m => ({ default: m.OrderDetailPage })));
const RefundsPage = lazy(() => import('../pages/customer/RefundsPage').then(m => ({ default: m.RefundsPage })));
const WishlistPage = lazy(() => import('../pages/customer/WishlistPage').then(m => ({ default: m.WishlistPage })));
const ProfilePage = lazy(() => import('../pages/customer/ProfilePage').then(m => ({ default: m.ProfilePage })));
const BecomeSellerPage = lazy(() => import('../pages/customer/BecomeSellerPage').then(m => ({ default: m.BecomeSellerPage })));
const SellerVerificationPage = lazy(() => import('../pages/customer/SellerVerificationPage').then(m => ({ default: m.SellerVerificationPage })));
const SupportPage = lazy(() => import('../pages/customer/SupportPage').then(m => ({ default: m.SupportPage })));
const UnauthorizedPage = lazy(() => import('../pages/auth/UnauthorizedPage').then(m => ({ default: m.UnauthorizedPage })));

// Seller Portal Pages (Lazy loaded only when /seller is accessed)
const SellerDashboardPage = lazy(() => import('../pages/seller/SellerDashboardPage').then(m => ({ default: m.SellerDashboardPage })));
const SellerProductsPage = lazy(() => import('../pages/seller/SellerProductsPage').then(m => ({ default: m.SellerProductsPage })));
const SellerAddProductPage = lazy(() => import('../pages/seller/SellerAddProductPage').then(m => ({ default: m.SellerAddProductPage })));
const SellerInventoryPage = lazy(() => import('../pages/seller/SellerInventoryPage').then(m => ({ default: m.SellerInventoryPage })));
const SellerOrdersPage = lazy(() => import('../pages/seller/SellerOrdersPage').then(m => ({ default: m.SellerOrdersPage })));
const SellerRevenuePage = lazy(() => import('../pages/seller/SellerRevenuePage').then(m => ({ default: m.SellerRevenuePage })));
const SellerTransactionsPage = lazy(() => import('../pages/seller/SellerTransactionsPage').then(m => ({ default: m.SellerTransactionsPage })));
const SellerSettlementsPage = lazy(() => import('../pages/seller/SellerSettlementsPage').then(m => ({ default: m.SellerSettlementsPage })));
const SellerRefundsPage = lazy(() => import('../pages/seller/SellerRefundsPage').then(m => ({ default: m.SellerRefundsPage })));
const SellerSettingsPage = lazy(() => import('../pages/seller/SellerSettingsPage').then(m => ({ default: m.SellerSettingsPage })));

// Admin Governance Pages (Lazy loaded only when /admin is accessed)
const AdminDashboardPage = lazy(() => import('../pages/admin/AdminDashboardPage').then(m => ({ default: m.AdminDashboardPage })));
const AdminOrdersPage = lazy(() => import('../pages/admin/AdminOrdersPage').then(m => ({ default: m.AdminOrdersPage })));
const AdminProductsPage = lazy(() => import('../pages/admin/AdminProductsPage').then(m => ({ default: m.AdminProductsPage })));
const AdminTrendingPage = lazy(() => import('../pages/admin/AdminTrendingPage').then(m => ({ default: m.AdminTrendingPage })));
const AdminCustomersPage = lazy(() => import('../pages/admin/AdminCustomersPage').then(m => ({ default: m.AdminCustomersPage })));
const AdminSellersPage = lazy(() => import('../pages/admin/AdminSellersPage').then(m => ({ default: m.AdminSellersPage })));
const AdminRefundsPage = lazy(() => import('../pages/admin/AdminRefundsPage').then(m => ({ default: m.AdminRefundsPage })));
const AdminTransactionsPage = lazy(() => import('../pages/admin/AdminTransactionsPage').then(m => ({ default: m.AdminTransactionsPage })));
const AdminSettlementsPage = lazy(() => import('../pages/admin/AdminSettlementsPage').then(m => ({ default: m.AdminSettlementsPage })));
const AdminAnnouncementsPage = lazy(() => import('../pages/admin/AdminAnnouncementsPage').then(m => ({ default: m.AdminAnnouncementsPage })));
const AdminSettingsPage = lazy(() => import('../pages/admin/AdminSettingsPage').then(m => ({ default: m.AdminSettingsPage })));
const AdminCouponsPage = lazy(() => import('../pages/admin/AdminCouponsPage').then(m => ({ default: m.AdminCouponsPage })));
const AdminOperatorsPage = lazy(() => import('../pages/admin/AdminOperatorsPage').then(m => ({ default: m.AdminOperatorsPage })));
const AdminMonitoringPage = lazy(() => import('../pages/admin/AdminMonitoringPage').then(m => ({ default: m.AdminMonitoringPage })));
const AdminLoginPage = lazy(() => import('../pages/admin/AdminLoginPage').then(m => ({ default: m.AdminLoginPage })));

// Delivery Mobile Portal Pages (Lazy loaded only when /delivery is accessed)
const DeliveryLoginPage = lazy(() => import('../pages/delivery/DeliveryLoginPage').then(m => ({ default: m.DeliveryLoginPage })));
const DeliveryDashboardPage = lazy(() => import('../pages/delivery/DeliveryDashboardPage').then(m => ({ default: m.DeliveryDashboardPage })));

const RouteLoadingFallback = () => (
  <div className="min-h-[40vh] flex flex-col items-center justify-center p-8 gap-3">
    <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin" />
    <span className="text-xs text-stone-400 font-medium">Loading view...</span>
  </div>
);

export const AppRoutes: React.FC = () => {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
    <Routes>
      {/* Customer Storefront Routes */}
      <Route element={<CustomerLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
        <Route path="/refunds" element={<RefundsPage />} />
        <Route path="/wishlist" element={<WishlistPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/become-seller" element={<BecomeSellerPage />} />
        <Route path="/become-seller/verify" element={<SellerVerificationPage />} />
        <Route path="/support" element={<SupportPage />} />
      </Route>

      {/* Seller Portal Protected Routes */}
      <Route
        path="/seller"
        element={
          <RoleGuard allowedRoles={['SELLER', 'ADMIN']}>
            <SellerLayout />
          </RoleGuard>
        }
      >
        <Route index element={<SellerDashboardPage />} />
        <Route path="products" element={<SellerProductsPage />} />
        <Route path="products/new" element={<SellerAddProductPage />} />
        <Route path="inventory" element={<SellerInventoryPage />} />
        <Route path="orders" element={<SellerOrdersPage />} />
        <Route path="revenue" element={<SellerRevenuePage />} />
        <Route path="transactions" element={<SellerTransactionsPage />} />
        <Route path="settlements" element={<SellerSettlementsPage />} />
        <Route path="refunds" element={<SellerRefundsPage />} />
        <Route path="settings" element={<SellerSettingsPage />} />
      </Route>

      {/* Admin Governance Protected Routes */}
      <Route
        path="/admin"
        element={
          <RoleGuard allowedRoles={['ADMIN']}>
            <AdminLayout />
          </RoleGuard>
        }
      >
        <Route index element={<AdminDashboardPage />} />
        <Route path="orders" element={<AdminOrdersPage />} />
        <Route path="products" element={<AdminProductsPage />} />
        <Route path="trending" element={<AdminTrendingPage />} />
        <Route path="customers" element={<AdminCustomersPage />} />
        <Route path="sellers" element={<AdminSellersPage />} />
        <Route path="refunds" element={<AdminRefundsPage />} />
        <Route path="coupons" element={<AdminCouponsPage />} />
        <Route path="transactions" element={<AdminTransactionsPage />} />
        <Route path="settlements" element={<AdminSettlementsPage />} />
        <Route path="announcements" element={<AdminAnnouncementsPage />} />
        <Route path="operators" element={<AdminOperatorsPage />} />
        <Route path="monitoring" element={<AdminMonitoringPage />} />
        <Route path="seller-verifications" element={<Navigate to="/admin/sellers" replace />} />
        <Route path="settings" element={<AdminSettingsPage />} />
      </Route>

      {/* Delivery Mobile App & Operator Routes */}
      <Route path="/delivery/login" element={<DeliveryLoginPage />} />
      <Route path="/delivery" element={<DeliveryDashboardPage />} />

      {/* Auth & Security Routes */}
      <Route path="/login" element={<LoginPage />} />
      {/* Dedicated admin login (spec §4): email + server-verified password */}
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
};
