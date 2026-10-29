import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldCheck, Truck, RotateCcw, Clock, Award } from 'lucide-react';
import { openCookieSettingsModal } from '../common/CookieConsent';

export const Footer: React.FC = () => {
  const location = useLocation();
  const isHomePage = location.pathname === '/' || location.pathname === '/home';

  return (
    <footer className="bg-white border-t border-cream-200 mt-20">
      {/* Sovereign Trust Pillars - only displayed under Home page */}
      {isHomePage && (
        <div className="border-b border-cream-200/80 bg-ivory">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-white border border-cream-300 text-burgundy shadow-soft">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <p className="font-serif font-semibold text-stone-900 text-sm">Cash on Delivery Protocol</p>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                  Zero advance risk. Inspect the piece with our white-glove courier before settling cash payment.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-white border border-cream-300 text-burgundy shadow-soft">
                <Award className="w-5 h-5" />
              </div>
              <div>
                <p className="font-serif font-semibold text-stone-900 text-sm">Certified Provenance</p>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                  Every horological piece and artisanal artifact undergoes master appraisal and provenance logging.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-white border border-cream-300 text-burgundy shadow-soft">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <p className="font-serif font-semibold text-stone-900 text-sm">Concierge Refund Process</p>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                  Formal dispute arbitration and wire return protocol managed under strict governance.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-white border border-cream-300 text-burgundy shadow-soft">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="font-serif font-semibold text-stone-900 text-sm">RBAC Sovereign Security</p>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                  Multi-tier enterprise authentication with OTP and cryptographic PIN validation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Main Footer Links */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-burgundy flex items-center justify-center text-ivory font-serif font-bold text-lg">
                K
              </div>
              <span className="font-serif font-extrabold text-xl tracking-wider text-stone-900">
                K-SHOP
              </span>
            </div>
            <p className="text-xs text-stone-500 max-w-sm leading-relaxed">
              Your trusted marketplace for verified products, Cash on Delivery (COD) payment,
              safe campus delivery, and easy 7-day hassle-free returns.
            </p>
            <div className="pt-2 text-xs text-stone-600 font-medium">
              100% Genuine Quality Products · Pay on Delivery
            </div>
          </div>

          <div>
            <p className="font-serif font-semibold text-xs uppercase tracking-widest text-stone-900 mb-4">
              Shop Categories
            </p>
            <ul className="space-y-2.5 text-xs text-stone-600">
              <li><Link to="/products?category=Timepieces" className="hover:text-burgundy">Watches</Link></li>
              <li><Link to="/products?category=Fashion" className="hover:text-burgundy">Fashion</Link></li>
              <li><Link to="/products?category=Mobiles" className="hover:text-burgundy">Mobiles</Link></li>
              <li><Link to="/products?category=Electronics" className="hover:text-burgundy">Electronics</Link></li>
              <li><Link to="/products?category=Beauty" className="hover:text-burgundy">Beauty</Link></li>
              <li><Link to="/products" className="hover:text-burgundy font-semibold text-burgundy">All Products →</Link></li>
            </ul>
          </div>

          <div>
            <p className="font-serif font-semibold text-xs uppercase tracking-widest text-stone-900 mb-4">
              Orders & Support
            </p>
            <ul className="space-y-2.5 text-xs text-stone-600">
              <li><Link to="/orders" className="hover:text-burgundy">My Orders & Tracking</Link></li>
              <li><Link to="/refunds" className="hover:text-burgundy">Refunds & Returns</Link></li>
              <li><Link to="/support" className="hover:text-burgundy">Customer Support</Link></li>
              <li><Link to="/become-seller" className="hover:text-burgundy">Sell on K-Shop</Link></li>
              <li><Link to="/seller" className="hover:text-burgundy">Seller Dashboard</Link></li>
              <li>
                <Link to="/delivery/login" className="hover:text-burgundy flex items-center gap-1.5 font-medium text-stone-700">
                  <Truck className="w-3.5 h-3.5 text-burgundy" />
                  <span>Delivery Agent Login</span>
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-serif font-semibold text-xs uppercase tracking-widest text-stone-900 mb-4">
              Policies & Info
            </p>
            <ul className="space-y-2.5 text-xs text-stone-600">
              <li><Link to="/privacy-policy" className="hover:text-burgundy">Privacy Policy</Link></li>
              <li><Link to="/terms-of-service" className="hover:text-burgundy">Terms of Service</Link></li>
              <li><Link to="/faq" className="hover:text-burgundy">Frequently Asked Questions (FAQ)</Link></li>
              <li><Link to="/contact" className="hover:text-burgundy">Contact Us</Link></li>
              <li>
                <button
                  type="button"
                  onClick={openCookieSettingsModal}
                  className="hover:text-burgundy text-left text-xs text-stone-600 cursor-pointer"
                >
                  Cookie Settings
                </button>
              </li>
              <li><Link to="/admin" className="hover:text-burgundy text-stone-500">Admin Login</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-cream-200 flex flex-col sm:flex-row items-center justify-between text-xs text-stone-600 gap-3">
          <p>© 2026 K-Shop Campus Marketplace. All rights reserved.</p>
          <div className="flex items-center gap-3.5 text-xs text-stone-500 flex-wrap">
            <Link to="/privacy-policy" className="hover:text-burgundy">Privacy</Link>
            <span>•</span>
            <Link to="/terms-of-service" className="hover:text-burgundy">Terms</Link>
            <span>•</span>
            <Link to="/contact" className="hover:text-burgundy">Contact</Link>
            <span>•</span>
            <Link to="/faq" className="hover:text-burgundy">FAQ</Link>
            <span>•</span>
            <button
              type="button"
              onClick={openCookieSettingsModal}
              className="hover:text-burgundy cursor-pointer"
            >
              Cookies
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
};
