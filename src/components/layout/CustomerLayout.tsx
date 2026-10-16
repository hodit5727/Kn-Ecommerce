import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { CartDrawer } from '../cart/CartDrawer';
import { MobileBottomNav } from './MobileBottomNav';
import { CookieConsent } from '../common/CookieConsent';

export const CustomerLayout: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-ivory text-stone-900 pb-16 md:pb-0">
      {/* Functional Accessibility Skip Link (WCAG 2.1 AA) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2.5 focus:bg-burgundy focus:text-white focus:rounded-xl focus:shadow-xl focus:outline-none focus:ring-2 focus:ring-amber-400 font-bold text-xs transition-all"
      >
        Skip to main content
      </a>

      <Navbar />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <MobileBottomNav />
      <CookieConsent />
    </div>
  );
};
