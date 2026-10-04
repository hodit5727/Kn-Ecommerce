import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RoleGuard } from '../rbac/RoleGuard';

// Layouts
import { CustomerLayout } from '../components/layout/CustomerLayout';
import { SellerLayout } from '../components/layout/SellerLayout';
import { AdminLayout } from '../components/layout/AdminLayout';

// Customer Pages
import { HomePage } from '../pages/customer/HomePage';
import { ProductsPage } from '../pages/customer/ProductsPage';
import { ProductDetailPage } from '../pages/customer/ProductDetailPage';
import { CartPage } from '../pages/customer/CartPage';
import { CheckoutPage } from '../pages/customer/CheckoutPage';
import { OrdersPage } from '../pages/customer/OrdersPage';
import { OrderDetailPage } from '../pages/customer/OrderDetailPage';
import { RefundsPage } from '../pages/customer/RefundsPage';
import { WishlistPage } from '../pages/customer/WishlistPage';
import { ProfilePage } from '../pages/customer/ProfilePage';
import { BecomeSellerPage } from '../pages/customer/BecomeSellerPage';
import { SellerVerificationPage } from '../pages/customer/SellerVerificationPage';
import { SupportPage } from '../pages/customer/SupportPage';

// Seller Pages
import { SellerDashboardPage } from '../pages/seller/SellerDashboardPage';
import { SellerProductsPage } from '../pages/seller/SellerProductsPage';
import { SellerAddProductPage } from '../pages/seller/SellerAddProductPage';
import { SellerInventoryPage } from '../pages/seller/SellerInventoryPage';
import { SellerOrdersPage } from '../pages/seller/SellerOrdersPage';
import { SellerRevenuePage } from '../pages/seller/SellerRevenuePage';
import { SellerTransactionsPage } from '../pages/seller/SellerTransactionsPage';
import { SellerSettlementsPage } from '../pages/seller/SellerSettlementsPage';
import { SellerRefundsPage } from '../pages/seller/SellerRefundsPage';
import { SellerSettingsPage } from '../pages/seller/SellerSettingsPage';

// Admin Pages
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage';
import { AdminOrdersPage } from '../pages/admin/AdminOrdersPage';
import { AdminProductsPage } from '../pages/admin/AdminProductsPage';
import { AdminCustomersPage } from '../pages/admin/AdminCustomersPage';
import { AdminSellersPage } from '../pages/admin/AdminSellersPage';
import { AdminRefundsPage } from '../pages/admin/AdminRefundsPage';
import { AdminTransactionsPage } from '../pages/admin/AdminTransactionsPage';
import { AdminSettlementsPage } from '../pages/admin/AdminSettlementsPage';
import { AdminAnnouncementsPage } from '../pages/admin/AdminAnnouncementsPage';
import { AdminSettingsPage } from '../pages/admin/AdminSettingsPage';
import { AdminCouponsPage } from '../pages/admin/AdminCouponsPage';
import { AdminOperatorsPage } from '../pages/admin/AdminOperatorsPage';
import { AdminMonitoringPage } from '../pages/admin/AdminMonitoringPage';

// Delivery Mobile Portal Pages
import { DeliveryLoginPage } from '../pages/delivery/DeliveryLoginPage';
import { DeliveryDashboardPage } from '../pages/delivery/DeliveryDashboardPage';

// Auth Pages
import { LoginPage } from '../pages/auth/LoginPage';
import { AdminLoginPage } from '../pages/admin/AdminLoginPage';
import { UnauthorizedPage } from '../pages/auth/UnauthorizedPage';

export const AppRoutes: React.FC = () => {
  return (
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
  );
};
