import React, { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Store, Coins, ShieldCheck, Truck } from 'lucide-react';

export const SellerSettingsPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [storeName, setStoreName] = useState(user?.sellerStoreName || 'Campus Store');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    showToast('Atelier settings updated.');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="border-b border-cream-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
          Store Preferences
        </span>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Seller Profile & Settlement Settings
        </h1>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-cream-200 shadow-soft space-y-4">
          <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2 pb-3 border-b border-cream-200">
            <Store className="w-4 h-4 text-burgundy" /> Store Identity
          </h3>
          <Input
            label="Store Display Name"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
          />
        </div>

        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-cream-200 shadow-soft space-y-4">
          <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2 pb-3 border-b border-cream-200">
            <Coins className="w-4 h-4 text-burgundy" /> Direct Cash Settlement
          </h3>
          <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-900 space-y-2">
            <p className="font-semibold">100% In-Hand Cash Settlement Protocol</p>
            <p className="text-amber-800 leading-relaxed">
              K-Shop operates on physical Cash on Delivery. The platform Admin manages campus delivery, collects cash directly from customers, retains the 5% platform commission, and settles the remaining 95% cash directly into your hand. No bank accounts or wire transfers required.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="primary">
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  );
};
