import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldCheck, Truck, RotateCcw, Clock, Award } from 'lucide-react';

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
                <h4 className="font-serif font-semibold text-stone-900 text-sm">Cash on Delivery Protocol</h4>
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
                <h4 className="font-serif font-semibold text-stone-900 text-sm">Certified Provenance</h4>
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
                <h4 className="font-serif font-semibold text-stone-900 text-sm">Concierge Refund Process</h4>
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
                <h4 className="font-serif font-semibold text-stone-900 text-sm">RBAC Sovereign Security</h4>
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
                K-SHOP LUXURY
              </span>
            </div>
            <p className="text-xs text-stone-500 max-w-sm leading-relaxed">
              A high-precision multi-role marketplace engineered for discerning collectors, master ateliers,
              and sovereign governance. Built with White/Ivory aesthetic integrity and Deep Burgundy identity.
            </p>
            <div className="pt-2 text-xs text-stone-400">
              Operating under COD Settlement Standard ISO-9001-COD.
            </div>
          </div>

          <div>
            <h5 className="font-serif font-semibold text-xs uppercase tracking-widest text-stone-900 mb-4">
              The Collection
            </h5>
            <ul className="space-y-2.5 text-xs text-stone-600">
              <li><Link to="/products?category=Timepieces" className="hover:text-burgundy">Haute Horlogerie</Link></li>
              <li><Link to="/products?category=Furniture%20%26%20Decor" className="hover:text-burgundy">Architectural Seating</Link></li>
              <li><Link to="/products?category=High-End%20Audio" className="hover:text-burgundy">Acoustic Reference</Link></li>
              <li><Link to="/products?category=Fine%20Jewelry" className="hover:text-burgundy">Fine Gems & Platinum</Link></li>
              <li><Link to="/products?category=Leather%20Goods" className="hover:text-burgundy">Tuscan Leather</Link></li>
            </ul>
          </div>

          <div>
            <h5 className="font-serif font-semibold text-xs uppercase tracking-widest text-stone-900 mb-4">
              Atelier & Commerce
            </h5>
            <ul className="space-y-2.5 text-xs text-stone-600">
              <li><Link to="/become-seller" className="hover:text-burgundy">Become an Accredited Seller</Link></li>
              <li><Link to="/seller" className="hover:text-burgundy">Seller Portal</Link></li>
              <li><Link to="/orders" className="hover:text-burgundy">Requisition Status</Link></li>
              <li><Link to="/refunds" className="hover:text-burgundy">Arbitration & Claims</Link></li>
              <li><Link to="/support" className="hover:text-burgundy">Patron Concierge</Link></li>
            </ul>
          </div>

          <div>
            <h5 className="font-serif font-semibold text-xs uppercase tracking-widest text-stone-900 mb-4">
              Governance
            </h5>
            <ul className="space-y-2.5 text-xs text-stone-600">
              <li><Link to="/admin" className="hover:text-burgundy">Admin Control Tower</Link></li>
              <li><span className="text-stone-400">Cash on Delivery Terms</span></li>
              <li><span className="text-stone-400">Horological Authenticity</span></li>
              <li><span className="text-stone-400">Privacy & Ledger Records</span></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-cream-200 flex flex-col sm:flex-row items-center justify-between text-xs text-stone-400">
          <p>© 2026 K-Shop Sovereign Marketplace. All rights reserved.</p>
          <p className="mt-2 sm:mt-0 font-medium text-stone-500">
            White/Ivory Palette • Deep Burgundy Identity • Cash on Delivery Only
          </p>
        </div>
      </div>
    </footer>
  );
};
