import React from 'react';
import { SEOHead } from '../../components/seo/SEOHead';
import { Mail, MapPin, Phone, Clock, ShieldCheck, Building, HelpCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export const ContactPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <SEOHead
        title="Legal & Business Contact Information"
        description="Official contact information, campus office address, customer support desk, and grievance officer details for K-Shop Sovereign Marketplace."
        canonicalPath="/contact"
        jsonLd={{
          '@type': 'LocalBusiness',
          name: 'K-SHOP Sovereign Luxury Marketplace',
          email: 'support@kshop.ac.in',
          telephone: '+91-44-2450-3000',
          address: {
            '@type': 'PostalAddress',
            streetAddress: 'Department of Information Technology, K-Campus Tech Park',
            addressLocality: 'Chennai',
            addressRegion: 'Tamil Nadu',
            postalCode: '600119',
            addressCountry: 'IN',
          },
          openingHours: 'Mo,Tu,We,Th,Fr 09:00-17:30',
        }}
      />

      {/* Header */}
      <div className="border-b border-cream-200 pb-6 space-y-2">
        <div className="flex items-center gap-2 text-burgundy text-xs font-bold uppercase tracking-wider">
          <Building className="w-4 h-4" />
          <span>Official Corporate & Campus Presence</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Legal & Business Contact
        </h1>
        <p className="text-xs text-stone-500">
          Reach our governance officers, merchant accreditation council, and white-glove logistics team.
        </p>
      </div>

      {/* Grid of contact cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Card 1: Headquarters & Campus Office */}
        <div className="p-6 rounded-2xl bg-white border border-cream-200 shadow-soft space-y-3">
          <div className="w-10 h-10 rounded-xl bg-burgundy/10 text-burgundy flex items-center justify-center">
            <MapPin className="w-5 h-5" />
          </div>
          <h2 className="font-serif font-bold text-stone-900 text-base">Campus Operations Office</h2>
          <p className="text-xs text-stone-600 leading-relaxed">
            K-SHOP Sovereign Commerce Division<br />
            Department of Information Technology, IT Block B<br />
            Campus Tech Corridor, OMR Rajiv Gandhi Salai<br />
            Chennai, Tamil Nadu 600119, India
          </p>
        </div>

        {/* Card 2: Operating Hours & Logistics */}
        <div className="p-6 rounded-2xl bg-white border border-cream-200 shadow-soft space-y-3">
          <div className="w-10 h-10 rounded-xl bg-burgundy/10 text-burgundy flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
          <h2 className="font-serif font-bold text-stone-900 text-base">Handover & Operating Hours</h2>
          <p className="text-xs text-stone-600 leading-relaxed">
            Monday through Friday: 09:00 AM – 05:30 PM IST<br />
            Saturday (White-Glove Campus Dispatch): 10:00 AM – 02:00 PM IST<br />
            Sunday & Academic Holidays: Closed (Escrow continues 24/7)
          </p>
        </div>

        {/* Card 3: Support & Concierge */}
        <div className="p-6 rounded-2xl bg-white border border-cream-200 shadow-soft space-y-3">
          <div className="w-10 h-10 rounded-xl bg-burgundy/10 text-burgundy flex items-center justify-center">
            <Mail className="w-5 h-5" />
          </div>
          <h2 className="font-serif font-bold text-stone-900 text-base">Electronic Communications</h2>
          <div className="space-y-1 text-xs text-stone-600">
            <p>Patron Inquiries: <a href="mailto:support@kshop.ac.in" className="text-burgundy font-semibold">support@kshop.ac.in</a></p>
            <p>Seller Accreditation: <a href="mailto:seller@kshop.ac.in" className="text-burgundy font-semibold">seller@kshop.ac.in</a></p>
            <p>Privacy & Data Officer: <a href="mailto:privacy@kshop.ac.in" className="text-burgundy font-semibold">privacy@kshop.ac.in</a></p>
          </div>
        </div>

        {/* Card 4: Grievance & Escalation */}
        <div className="p-6 rounded-2xl bg-white border border-cream-200 shadow-soft space-y-3">
          <div className="w-10 h-10 rounded-xl bg-burgundy/10 text-burgundy flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h2 className="font-serif font-bold text-stone-900 text-base">Grievance & Escrow Officer</h2>
          <p className="text-xs text-stone-600 leading-relaxed">
            Name: Pradeep G. (Chief Governance Officer)<br />
            Telephone: +91 44 2450 3000 (Ext. 5727)<br />
            Direct Escalation: <a href="mailto:grievance@kshop.ac.in" className="text-burgundy font-semibold">grievance@kshop.ac.in</a><br />
            Expected Response Time: Within 24-48 business hours
          </p>
        </div>
      </div>

      {/* Helpful links */}
      <div className="p-5 rounded-2xl bg-cream-50/80 border border-cream-200 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <HelpCircle className="w-5 h-5 text-burgundy" />
          <span className="text-xs text-stone-700 font-medium">Looking for quick answers about Cash on Delivery or return procedures?</span>
        </div>
        <Link to="/faq" className="px-4 py-2 rounded-xl bg-burgundy text-white text-xs font-bold hover:bg-[#72001e] transition-colors">
          Browse Knowledgebase & FAQ
        </Link>
      </div>
    </div>
  );
};
