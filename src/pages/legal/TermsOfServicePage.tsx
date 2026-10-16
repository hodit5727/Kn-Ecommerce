import React from 'react';
import { SEOHead } from '../../components/seo/SEOHead';
import { FileCheck, Shield, AlertCircle, Scale, Truck, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';

export const TermsOfServicePage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <SEOHead
        title="Terms of Service & COD Escrow Protocols"
        description="Official terms of service governing purchases, Cash on Delivery escrow protocols, seller accreditation rules, and dispute resolution on K-Shop."
        canonicalPath="/terms-of-service"
      />

      {/* Header */}
      <div className="border-b border-cream-200 pb-6 space-y-2">
        <div className="flex items-center gap-2 text-burgundy text-xs font-bold uppercase tracking-wider">
          <Scale className="w-4 h-4" />
          <span>Governance & Compliance Standard</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Terms of Service
        </h1>
        <p className="text-xs text-stone-500">
          Last Updated: October 16, 2026 • Sovereign Marketplace Rules v2.1
        </p>
      </div>

      {/* Content Sections */}
      <div className="space-y-6 text-xs sm:text-sm text-stone-700 leading-relaxed">
        <section className="space-y-3 bg-white p-6 rounded-2xl border border-cream-200 shadow-soft">
          <h2 className="text-base font-serif font-bold text-stone-900 flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-burgundy" />
            1. Acceptance of Sovereign Terms
          </h2>
          <p>
            By accessing or ordering through <strong>K-Shop</strong>, you agree to be bound by these Terms of Service. If you disagree with any portion of these terms, you may discontinue use of the marketplace immediately.
          </p>
        </section>

        <section className="space-y-3 bg-white p-6 rounded-2xl border border-cream-200 shadow-soft">
          <h2 className="text-base font-serif font-bold text-stone-900 flex items-center gap-2">
            <Truck className="w-4 h-4 text-burgundy" />
            2. Cash on Delivery (COD) Escrow Protocol
          </h2>
          <p>
            To provide zero-risk transactions for all patrons, K-Shop operates exclusively on a <strong>100% Cash on Delivery (COD) escrow standard</strong>:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-stone-600 text-xs">
            <li>No advance payment or credit card credentials are ever requested or stored on this platform.</li>
            <li>Patrons inspect delivered goods in the presence of the campus delivery personnel before handing over physical currency.</li>
            <li>Cash collection is verified digitally by the delivery personnel before updating the order to <code>DELIVERED</code>.</li>
            <li>Merchant funds are held in escrow for a 7-day observation period before becoming eligible for wire settlement.</li>
          </ul>
        </section>

        <section className="space-y-3 bg-white p-6 rounded-2xl border border-cream-200 shadow-soft">
          <h2 className="text-base font-serif font-bold text-stone-900 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-burgundy" />
            3. Return, Exchange & Refund Policies
          </h2>
          <p>
            Every piece catalogued on K-Shop is backed by a mandatory <strong>7-Day Campus Return & Refund Guarantee</strong>:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-stone-600 text-xs">
            <li>Patrons may submit a formal return claim via the <Link to="/refunds" className="text-burgundy font-semibold underline">Refunds & Claims Portal</Link> within 7 days of delivery.</li>
            <li>Returned items must include original presentation boxes, security tags, certificates of provenance, and accessories.</li>
            <li>Once approved by administrative arbitration, refund cash or bank settlement is processed within 48 banking hours.</li>
          </ul>
        </section>

        <section className="space-y-3 bg-white p-6 rounded-2xl border border-cream-200 shadow-soft">
          <h2 className="text-base font-serif font-bold text-stone-900 flex items-center gap-2">
            <Shield className="w-4 h-4 text-burgundy" />
            4. Seller Accreditation & 5% Platform Fee
          </h2>
          <p>
            Only merchants who complete document validation and live face verification are accredited to list items on K-Shop:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-stone-600 text-xs">
            <li>A standardized <strong>5% platform commission fee</strong> is retained on fulfilled sales to fund campus courier logistics, white-glove inspection, and platform infrastructure.</li>
            <li>The net 95% balance is wired directly to the seller&apos;s verified bank account upon escrow maturation.</li>
            <li>Counterfeiting, fake documentation, or unauthorized product alteration results in permanent seller revocation and forfeiture of escrowed balances.</li>
          </ul>
        </section>

        <section className="space-y-3 bg-white p-6 rounded-2xl border border-cream-200 shadow-soft">
          <h2 className="text-base font-serif font-bold text-stone-900 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-burgundy" />
            5. Dispute Arbitration & Governance
          </h2>
          <p>
            Disputes between patrons and sellers are arbitrated independently by the K-Shop Administration. For assistance, contact our concierge at <Link to="/contact" className="text-burgundy font-semibold underline">Campus Contact Governance</Link>.
          </p>
        </section>
      </div>
    </div>
  );
};
