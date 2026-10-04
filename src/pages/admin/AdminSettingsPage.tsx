import React from 'react';
import { ShieldCheck, Settings, Lock, FileCode } from 'lucide-react';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';

export const AdminSettingsPage: React.FC = () => {
  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="border-b border-stone-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
          Governance Parameters
        </span>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Platform Configuration & Protocol
        </h1>
      </div>

      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-stone-200 shadow-soft space-y-4">
        <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2 pb-3 border-b border-stone-200">
          <ShieldCheck className="w-4 h-4 text-emerald-600" /> Cash on Delivery (COD) Thresholds
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Complimentary Courier Threshold ($)" defaultValue="10000" disabled />
          <Input label="Platform Commission Take Rate (%)" defaultValue="5.0" disabled />
        </div>
        <p className="text-xs text-stone-500">
          Payment method is strictly bound to COD across all client interfaces.
        </p>
      </div>

      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-stone-200 shadow-soft space-y-4">
        <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2 pb-3 border-b border-stone-200">
          <Lock className="w-4 h-4 text-amber-600" /> Supabase Backend Readiness Status
        </h3>

        <div className="space-y-2 text-xs text-stone-600">
          <div className="flex items-center justify-between p-3 bg-stone-50 rounded-xl">
            <span>Supabase Auth / SMTP Integration Gate</span>
            <span className="font-bold text-stone-900">Configured (Ready for Phase 2 Wiring)</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-stone-50 rounded-xl">
            <span>RLS Security Policies</span>
            <span className="font-bold text-stone-900">Defined for Customer, Seller & Admin roles</span>
          </div>
        </div>
      </div>
    </div>
  );
};
