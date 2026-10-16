import React, { useState } from 'react';
import { SEOHead } from '../../components/seo/SEOHead';
import { HelpCircle, ChevronDown, ChevronUp, ShieldCheck, Truck, RotateCcw, Store, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';

interface FAQItem {
  q: string;
  a: string;
  category: 'cod' | 'delivery' | 'returns' | 'seller' | 'security';
}

const FAQS: FAQItem[] = [
  {
    category: 'cod',
    q: 'How does Cash on Delivery (COD) escrow work on K-Shop?',
    a: 'K-Shop operates on a 100% Cash on Delivery escrow model. When you place an order, no advance payment or credit card details are needed. You inspect the item upon delivery by our campus logistics team, and hand over the exact cash amount only when you are completely satisfied.',
  },
  {
    category: 'cod',
    q: 'Is there any extra fee or hidden surcharge for Cash on Delivery?',
    a: 'No. The price displayed on the product page and at checkout is the exact and final price in Indian Rupees (₹). There are no additional COD processing charges, delivery fees, or hidden markups.',
  },
  {
    category: 'delivery',
    q: 'What is the standard delivery timeframe for campus orders?',
    a: 'Most items are delivered within 2 business days. Because our accredited sellers and inventory storage hubs are closely coordinated with campus dispatch, orders are typically prepared within 24 hours and delivered directly to your department or designated campus fulfillment zone.',
  },
  {
    category: 'delivery',
    q: 'Can I inspect the product before accepting delivery?',
    a: 'Yes. Our white-glove handover protocol allows you to open the packaging and verify the physical condition, model SKU, and authenticity certificate with the courier present before confirming handover.',
  },
  {
    category: 'returns',
    q: 'What is the return and refund policy on K-Shop?',
    a: 'Every purchase is covered by a mandatory 7-Day Return Policy. If an item arrives damaged, differs from the listed specifications, or does not meet your expectations, submit a claim through the Refunds & Claims portal within 7 days of delivery for administrative resolution and full cash/bank refund.',
  },
  {
    category: 'returns',
    q: 'How long does refund processing take once approved?',
    a: 'Once your return is inspected and approved by the K-Shop administration, refunds are disbursed within 24 to 48 banking hours. Cash on delivery orders are refunded via direct wire transfer or cash handover at the campus governance office.',
  },
  {
    category: 'seller',
    q: 'How do merchants become accredited sellers on K-Shop?',
    a: 'Prospective sellers must submit their business and identity documents through the Become a Seller portal, followed by automated document validation and biometric face liveness verification. The application is then manually reviewed by the administration before granting seller privileges.',
  },
  {
    category: 'seller',
    q: 'What commission fee does K-Shop charge sellers?',
    a: 'K-Shop retains a transparent 5% platform commission on successfully delivered and settled orders. The remaining 95% net payout balance is wired directly to the seller\'s registered bank account after the 7-day return escrow window elapses.',
  },
  {
    category: 'security',
    q: 'How is my private customer information protected from merchants?',
    a: 'K-Shop enforces a strict Customer Privacy Shield. Sellers never see your private phone number, email address, or personal residence. Orders display only an anonymized customer reference code (e.g. KNCR-XXXX) and campus fulfillment drop-point, with delivery managed entirely by authorized admin staff.',
  },
  {
    category: 'security',
    q: 'Why does K-Shop require a 4-digit PIN in addition to email OTP?',
    a: 'The two-layer authentication (SMTP Email One-Time Password + Cryptographic PIN) ensures multi-factor security. Once verified, your PIN allows swift returning login while safeguarding your orders, wishlist, and account identity against unauthorized device access.',
  },
];

export const FAQPage: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [selectedCat, setSelectedCat] = useState<string>('all');

  const filtered = selectedCat === 'all'
    ? FAQS
    : FAQS.filter((f) => f.category === selectedCat);

  // Generate FAQPage JSON-LD Schema
  const faqJsonLd = {
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.a,
      },
    })),
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <SEOHead
        title="Frequently Asked Questions & Knowledgebase"
        description="Comprehensive FAQ on Cash on Delivery escrow, white-glove campus delivery, 7-day return guarantee, seller accreditation, and privacy security on K-Shop."
        canonicalPath="/faq"
        jsonLd={faqJsonLd}
      />

      {/* Header */}
      <div className="border-b border-cream-200 pb-6 space-y-2">
        <div className="flex items-center gap-2 text-burgundy text-xs font-bold uppercase tracking-wider">
          <HelpCircle className="w-4 h-4" />
          <span>Knowledgebase & Support</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Frequently Asked Questions
        </h1>
        <p className="text-xs text-stone-500">
          Clear, concise answers to common questions about buying, selling, escrow, and returns.
        </p>
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none text-xs">
        <button
          type="button"
          onClick={() => setSelectedCat('all')}
          className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all shrink-0 ${
            selectedCat === 'all'
              ? 'bg-burgundy text-white shadow-xs'
              : 'bg-white text-stone-700 border border-cream-200 hover:bg-cream-50'
          }`}
        >
          All Topics
        </button>
        <button
          type="button"
          onClick={() => setSelectedCat('cod')}
          className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all shrink-0 flex items-center gap-1.5 ${
            selectedCat === 'cod'
              ? 'bg-burgundy text-white shadow-xs'
              : 'bg-white text-stone-700 border border-cream-200 hover:bg-cream-50'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>COD Escrow</span>
        </button>
        <button
          type="button"
          onClick={() => setSelectedCat('delivery')}
          className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all shrink-0 flex items-center gap-1.5 ${
            selectedCat === 'delivery'
              ? 'bg-burgundy text-white shadow-xs'
              : 'bg-white text-stone-700 border border-cream-200 hover:bg-cream-50'
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          <span>Delivery</span>
        </button>
        <button
          type="button"
          onClick={() => setSelectedCat('returns')}
          className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all shrink-0 flex items-center gap-1.5 ${
            selectedCat === 'returns'
              ? 'bg-burgundy text-white shadow-xs'
              : 'bg-white text-stone-700 border border-cream-200 hover:bg-cream-50'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Returns</span>
        </button>
        <button
          type="button"
          onClick={() => setSelectedCat('seller')}
          className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all shrink-0 flex items-center gap-1.5 ${
            selectedCat === 'seller'
              ? 'bg-burgundy text-white shadow-xs'
              : 'bg-white text-stone-700 border border-cream-200 hover:bg-cream-50'
          }`}
        >
          <Store className="w-3.5 h-3.5" />
          <span>Sellers & Commission</span>
        </button>
        <button
          type="button"
          onClick={() => setSelectedCat('security')}
          className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all shrink-0 flex items-center gap-1.5 ${
            selectedCat === 'security'
              ? 'bg-burgundy text-white shadow-xs'
              : 'bg-white text-stone-700 border border-cream-200 hover:bg-cream-50'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Security & Privacy</span>
        </button>
      </div>

      {/* Accordion List */}
      <div className="space-y-3">
        {filtered.map((item, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div
              key={idx}
              className="bg-white rounded-2xl border border-cream-200 shadow-soft overflow-hidden transition-all"
            >
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                className="w-full p-4 sm:p-5 text-left flex items-center justify-between gap-4 hover:bg-cream-50/50 transition-colors"
                aria-expanded={isOpen}
              >
                <span className="font-serif font-bold text-stone-900 text-sm sm:text-base">
                  {item.q}
                </span>
                <span className="p-1 rounded-lg bg-cream-100 text-stone-600 shrink-0">
                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              </button>

              {isOpen && (
                <div className="px-4 pb-5 sm:px-5 sm:pb-6 text-xs sm:text-sm text-stone-600 leading-relaxed border-t border-cream-100 pt-3">
                  <p>{item.a}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Still need help banner */}
      <div className="p-6 rounded-2xl bg-white border border-cream-200 shadow-soft text-center space-y-3">
        <h2 className="font-serif font-bold text-stone-900 text-base">Have additional questions?</h2>
        <p className="text-xs text-stone-500 max-w-md mx-auto">
          Our patron concierge desk and grievance officers are ready to assist you with order status, disputes, or seller inquiries.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            to="/support"
            className="px-4 py-2 rounded-xl bg-burgundy text-white text-xs font-bold hover:bg-[#72001e] transition-colors"
          >
            Contact Concierge Desk
          </Link>
          <Link
            to="/contact"
            className="px-4 py-2 rounded-xl border border-cream-300 bg-ivory text-stone-800 text-xs font-semibold hover:bg-cream-100 transition-colors"
          >
            Campus Office Info
          </Link>
        </div>
      </div>
    </div>
  );
};
