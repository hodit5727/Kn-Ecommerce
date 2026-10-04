import React from 'react';
import { ShieldCheck, HelpCircle, Phone, Mail, Clock, FileText } from 'lucide-react';
import { Button } from '../../components/common/Button';

export const SupportPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="border-b border-cream-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
          Patron Concierge
        </span>
        <h1 className="text-3xl font-serif font-bold text-stone-900">
          Concierge Services & Protocol Help
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-3xl p-6 border border-cream-200 shadow-soft space-y-3">
          <Phone className="w-6 h-6 text-burgundy" />
          <h3 className="font-serif font-bold text-base text-stone-900">Direct Courier Liaison</h3>
          <p className="text-xs text-stone-600 leading-relaxed">
            Need to reschedule a Cash on Delivery arrival window or coordinate an armored escort?
            Our private dispatch team is available 24/7.
          </p>
          <p className="text-xs font-semibold text-burgundy pt-2">+44 (0) 20 7946 0999</p>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-cream-200 shadow-soft space-y-3">
          <Mail className="w-6 h-6 text-burgundy" />
          <h3 className="font-serif font-bold text-base text-stone-900">Horological Appraisals</h3>
          <p className="text-xs text-stone-600 leading-relaxed">
            Inquire regarding provenance certificates, master horologist inspections, or bespoke
            customization requests.
          </p>
          <p className="text-xs font-semibold text-burgundy pt-2">concierge@k-shop.com</p>
        </div>
      </div>

      <div className="bg-ivory rounded-3xl p-8 border border-cream-300 space-y-4">
        <h3 className="font-serif font-bold text-lg text-stone-900 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-burgundy" /> Cash on Delivery Protocol FAQ
        </h3>
        <div className="space-y-3 text-xs text-stone-700">
          <div>
            <h4 className="font-bold text-stone-900">Q: Can I open and inspect the packaging before paying?</h4>
            <p className="text-stone-600 mt-0.5">
              Yes. Our white-glove courier is trained to witness unboxing, verify serial engravings
              against the documentation dossier, and ensure your absolute satisfaction prior to accepting payment.
            </p>
          </div>
          <div>
            <h4 className="font-bold text-stone-900">Q: What happens if I choose not to accept the piece?</h4>
            <p className="text-stone-600 mt-0.5">
              You may decline handover immediately without penalty. The parcel is sealed and returned
              to the atelier. Zero funds are collected.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
