import React from 'react';
import { SEOHead } from '../../components/seo/SEOHead';
import { ShieldCheck, Lock, Eye, FileText, Database, UserCheck, RefreshCw } from 'lucide-react';
import { openCookieSettingsModal } from '../../components/common/CookieConsent';

export const PrivacyPolicyPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <SEOHead
        title="Privacy Policy & Sovereign Data Governance"
        description="Learn how K-Shop protects your personal information, escrow transaction logs, and academic credentials in compliance with GDPR and data privacy standards."
        canonicalPath="/privacy-policy"
      />

      {/* Header */}
      <div className="border-b border-cream-200 pb-6 space-y-2">
        <div className="flex items-center gap-2 text-burgundy text-xs font-bold uppercase tracking-wider">
          <ShieldCheck className="w-4 h-4" />
          <span>Sovereign Data Governance</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Privacy Policy
        </h1>
        <p className="text-xs text-stone-500">
          Effective Date: October 16, 2026 • Version 1.4 (GDPR & ePrivacy Aligned)
        </p>
      </div>

      {/* Content Sections */}
      <div className="space-y-6 text-xs sm:text-sm text-stone-700 leading-relaxed">
        <section className="space-y-3 bg-white p-6 rounded-2xl border border-cream-200 shadow-soft">
          <h2 className="text-base font-serif font-bold text-stone-900 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-burgundy" />
            1. Data Controller Identification
          </h2>
          <p>
            <strong>K-Shop Sovereign Marketplace</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) operates an autonomous, multi-role campus e-commerce and artisan marketplace. We act as the data controller for personal information collected when you register, browse, purchase via Cash on Delivery escrow, or onboard as an accredited seller.
          </p>
          <p className="text-stone-500 text-xs">
            Official Data Governance Officer: <a href="mailto:privacy@kshop.ac.in" className="text-burgundy font-semibold">privacy@kshop.ac.in</a>
          </p>
        </section>

        <section className="space-y-3 bg-white p-6 rounded-2xl border border-cream-200 shadow-soft">
          <h2 className="text-base font-serif font-bold text-stone-900 flex items-center gap-2">
            <Database className="w-4 h-4 text-burgundy" />
            2. Categories of Personal Data Collected
          </h2>
          <ul className="list-disc pl-5 space-y-2 text-stone-600 text-xs sm:text-sm">
            <li>
              <strong>Identity & Authentication:</strong> Email address, mobile telephone number, full name, 4-digit cryptographic PIN (hashed with bcrypt server-side; plain-text is never stored), and college registration/staff ID for role-based permissions.
            </li>
            <li>
              <strong>Escrow & Order Data:</strong> Cash on Delivery orders, delivery location campus addresses, order line items, transaction passbook entries, and return/refund claim records.
            </li>
            <li>
              <strong>Seller Accreditation Records:</strong> Merchant store names, government identity proofs (stored securely in private storage buckets with time-limited signed access), and biometric liveness verification vectors (zero raw biometrics stored; verified via ephemeral client-side landmark vectors).
            </li>
            <li>
              <strong>Technical & Telemetry Data:</strong> IP addresses (anonymized for security incident response), HTTP user-agents, and client-side error telemetry only when consented.
            </li>
          </ul>
        </section>

        <section className="space-y-3 bg-white p-6 rounded-2xl border border-cream-200 shadow-soft">
          <h2 className="text-base font-serif font-bold text-stone-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-burgundy" />
            3. Legal Basis & Purposes of Processing (GDPR Art. 6)
          </h2>
          <p>
            We process your personal data strictly under valid legal bases:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-stone-600 text-xs">
            <li>
              <strong>Contractual Performance (Art. 6.1.b):</strong> Processing Cash on Delivery order fulfilment, escorting courier deliveries, disbursing seller payouts, and arbitrating refund claims.
            </li>
            <li>
              <strong>Legal Obligation (Art. 6.1.c):</strong> Maintaining accounting passbooks, tax receipts, and audit trail records.
            </li>
            <li>
              <strong>Legitimate Interest (Art. 6.1.f):</strong> Preventing brute-force attacks, multi-tier RBAC privilege escalation prevention, and server incident surveillance.
            </li>
            <li>
              <strong>Patron Consent (Art. 6.1.a):</strong> Non-essential performance telemetry and optional functional preferences.
            </li>
          </ul>
        </section>

        <section className="space-y-3 bg-white p-6 rounded-2xl border border-cream-200 shadow-soft">
          <h2 className="text-base font-serif font-bold text-stone-900 flex items-center gap-2">
            <Eye className="w-4 h-4 text-burgundy" />
            4. Customer Privacy Shield for Sellers
          </h2>
          <p>
            To prevent cross-user tracking and protect customer safety, accredited sellers <strong>never</strong> receive customer private phone numbers, home addresses, or personal profiles. Sellers receive only an anonymized patron code (e.g., <code>KNCR-XXXX</code>) and campus fulfillment drop-point. Campus dispatch logistics are exclusively governed by authorized administrative personnel.
          </p>
        </section>

        <section className="space-y-3 bg-white p-6 rounded-2xl border border-cream-200 shadow-soft">
          <h2 className="text-base font-serif font-bold text-stone-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-burgundy" />
            5. Your Sovereign Data Rights
          </h2>
          <p>
            Under global privacy frameworks and GDPR, you retain full rights over your data:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-xl bg-ivory border border-cream-200">
              <p className="font-bold text-stone-900 text-xs">Right to Access & Rectify</p>
              <p className="text-[11px] text-stone-500 mt-0.5">Inspect and update your registered academic profile anytime via Account Settings.</p>
            </div>
            <div className="p-3 rounded-xl bg-ivory border border-cream-200">
              <p className="font-bold text-stone-900 text-xs">Right to Erasure (&ldquo;Be Forgotten&rdquo;)</p>
              <p className="text-[11px] text-stone-500 mt-0.5">Request account deactivation and removal of optional data via our support desk.</p>
            </div>
            <div className="p-3 rounded-xl bg-ivory border border-cream-200">
              <p className="font-bold text-stone-900 text-xs">Right to Withdraw Consent</p>
              <p className="text-[11px] text-stone-500 mt-0.5">Modify or revoke cookie preferences at any time using the preferences button below.</p>
            </div>
            <div className="p-3 rounded-xl bg-ivory border border-cream-200">
              <p className="font-bold text-stone-900 text-xs">Data Portability</p>
              <p className="text-[11px] text-stone-500 mt-0.5">Download your verified order history and passbook records in standard CSV format.</p>
            </div>
          </div>

          <div className="pt-4 border-t border-cream-100 flex items-center justify-between flex-wrap gap-3">
            <span className="text-xs text-stone-600">Want to inspect or change your consent?</span>
            <button
              type="button"
              onClick={openCookieSettingsModal}
              className="px-3.5 py-1.5 rounded-xl border border-cream-300 bg-ivory text-burgundy font-bold text-xs hover:bg-cream-100 transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Manage Cookie Preferences</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
