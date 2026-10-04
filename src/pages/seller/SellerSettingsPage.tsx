import React, { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Store, Landmark, ShieldCheck, Truck } from 'lucide-react';

export const SellerSettingsPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [storeName, setStoreName] = useState(user?.sellerStoreName || 'Maison Aethelgard');
  const [iban, setIban] = useState('GB29 NWBK 6016 1331 9268 19');
  const [swift, setSwift] = useState('NWBKGB2L');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    showToast('Atelier settings updated.');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="border-b border-cream-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
          Atelier Preferences
        </span>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          Seller Profile & Banking Settings
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
            <Landmark className="w-4 h-4 text-burgundy" /> Payout Banking Coordinates
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="IBAN / Account Number" value={iban} onChange={(e) => setIban(e.target.value)} />
            <Input label="SWIFT / BIC" value={swift} onChange={(e) => setSwift(e.target.value)} />
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
