import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { verificationService } from '../../services/verificationService';
import { Input } from '../../components/common/Input';
import { Select } from '../../components/common/Select';
import { Button } from '../../components/common/Button';
import {
  Store,
  ShieldCheck,
  Building2,
  ArrowRight,
  CheckCircle2,
  ScanFace
} from 'lucide-react';

export const BecomeSellerPage: React.FC = () => {
  const { user, applyForSeller } = useAuth();
  const { showToast } = useToast();

  const [formData, setFormData] = useState({
    storeName: '',
    businessType: 'INDIVIDUAL' as 'INDIVIDUAL' | 'PROPRIETORSHIP' | 'REGISTERED_COMPANY',
    businessAddress: '',
    storeCategory: '',
    agreeToTerms: false,
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(user?.sellerStatus === 'PENDING');
  const [verifState, setVerifState] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      verificationService.getStatus()
        .then((st) => setVerifState(st?.verification?.state ?? null))
        .catch(() => {});
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.agreeToTerms) {
      showToast('You must agree to the K-Shop COD Settlement Standards.', 'error');
      return;
    }
    if (!formData.storeName.trim() || formData.storeName.trim().length < 3 || formData.storeName.trim().length > 120) {
      showToast('Store name must be 3–120 characters.', 'error');
      return;
    }
    if (
      !formData.businessAddress.trim() ||
      formData.businessAddress.trim().length < 5 ||
      formData.businessAddress.trim().length > 400
    ) {
      showToast('Enter a valid store address (5–400 characters).', 'error');
      return;
    }
    if (!formData.storeCategory) {
      showToast('Please select a store category.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await applyForSeller({
        storeName: formData.storeName,
        businessType: formData.businessType,
        businessAddress: formData.businessAddress,
        storeCategory: formData.storeCategory,
        agreeToTerms: formData.agreeToTerms,
      });
      setIsSubmitted(true);
      showToast('Seller application submitted! Please complete ID & face verification next.');
    } catch (err: any) {
      showToast(err.message || 'Failed to submit seller application.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="w-16 h-16 rounded-3xl bg-cream-100 flex items-center justify-center text-burgundy mx-auto shadow-soft">
          <Store className="w-8 h-8" />
        </div>
        <span className="text-xs font-bold uppercase tracking-widest text-burgundy block">
          Become a Seller
        </span>
        <h1 className="text-3xl sm:text-4xl font-serif font-extrabold text-stone-900">
          Start Selling on K-Shop
        </h1>
        <p className="text-sm text-stone-600 max-w-xl mx-auto leading-relaxed">
          Reach thousands of students and staff across campuses. List your products with Cash on Delivery — no bank account required.
        </p>
      </div>

      {/* Benefits banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'COD Only', desc: 'No payment gateway' },
          { label: '5% Fee', desc: 'Platform commission' },
          { label: 'Free to Join', desc: 'No signup cost' },
          { label: 'Campus Reach', desc: 'Students & staff' },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-2xl p-3 border border-cream-200 text-center">
            <p className="font-serif font-bold text-sm text-burgundy">{item.label}</p>
            <p className="text-[11px] text-stone-500 mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>

      {user && !user.onboardingComplete ? (
        <div className="bg-white rounded-3xl p-8 sm:p-10 border border-cream-200 shadow-soft space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-cream-100 text-burgundy flex items-center justify-center">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h2 className="font-serif font-bold text-xl text-stone-900">
            Complete your account setup first
          </h2>
          <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
            To become a seller, your customer profile must include your name, phone, PIN and college
            details (gender, category and user type). K-Shop's server requires these before it can
            accept a seller application — please finish this now.
          </p>
          <Link to="/login">
            <Button variant="primary" size="lg" leftIcon={<ArrowRight className="w-4 h-4" />}>
              Complete My Profile
            </Button>
          </Link>
          <p className="text-[11px] text-stone-400">
            Your profile state is checked from your signed-in account on the server — signing in again
            will take you straight to the missing profile step.
          </p>
        </div>
      ) : isSubmitted ? (
        <div className="bg-white rounded-3xl p-8 sm:p-12 border border-cream-200 shadow-soft text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="font-serif font-bold text-xl text-stone-900">
            Application Under Review
          </h3>
          <p className="text-xs sm:text-sm text-stone-600 max-w-md mx-auto leading-relaxed">
            Your application for <strong>"{user?.sellerStoreName || formData.storeName}"</strong> has been received.
            Please complete the identity & face verification step below so our team can accredit your store.
          </p>
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 max-w-sm mx-auto text-left text-xs space-y-1">
            <p className="font-bold text-amber-800 uppercase tracking-wider text-[10px]">What's next?</p>
            <ul className="text-amber-900 space-y-1">
              <li className="flex items-start gap-1.5"><CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" /> Complete your ID & live face verification below</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" /> Our team reviews your accreditation dossier</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" /> Start listing products immediately after approval</li>
            </ul>
          </div>

          {/* Identity + Face Verification — the real backend flow */}
          {verifState === 'MANUAL_REVIEW' ? (
            <div className="p-5 rounded-2xl bg-stone-900 text-ivory max-w-sm mx-auto text-left space-y-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <p className="font-serif font-bold text-sm">Face Verification Under Review</p>
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed text-stone-300">
                Your live face check and identity document have been submitted. Our team will review and approve your seller accreditation within 1–2 days.
              </p>
              <Link to="/become-seller/verify" className="block">
                <Button variant="ivory" size="sm" className="w-full">
                  View Verification Status <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-burgundy text-ivory max-w-sm mx-auto text-left space-y-3">
              <div className="flex items-center gap-2">
                <ScanFace className="w-5 h-5 shrink-0" />
                <p className="font-serif font-bold text-sm">Next step: Identity + Face Verification</p>
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed">
                Upload your ID document and confirm you match with a short live face check. Takes about a minute.
              </p>
              <Link to="/become-seller/verify" className="block">
                <Button variant="ivory" size="sm" className="w-full">
                  Start ID & Face Verification <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-3xl p-8 sm:p-10 border border-cream-200 shadow-soft space-y-8"
        >
          {/* Store Identity */}
          <div className="space-y-4">
            <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2 pb-3 border-b border-cream-200">
              <Building2 className="w-4 h-4 text-burgundy" /> Store Details
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Store / Shop Name"
                placeholder="e.g. Campus Tech Hub"
                required
                minLength={3}
                maxLength={120}
                value={formData.storeName}
                onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
              />
              <Select
                label="Seller Type"
                value={formData.businessType}
                onChange={(e) => setFormData({ ...formData, businessType: e.target.value as any })}
                options={[
                  { value: 'INDIVIDUAL', label: 'Individual / Student Seller' },
                  { value: 'PROPRIETORSHIP', label: 'Sole Proprietorship' },
                  { value: 'REGISTERED_COMPANY', label: 'Registered Company' },
                ]}
              />
            </div>

            {/* Store Category */}
            <div>
              <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
                Store Category
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {['Electronics', 'Fashion', 'Books', 'Food', 'Stationery', 'Other'].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFormData({ ...formData, storeCategory: cat })}
                    className={`py-2 text-[11px] rounded-xl border font-semibold transition-colors ${
                      formData.storeCategory === cat
                        ? 'bg-burgundy text-white border-burgundy'
                        : 'bg-cream-50 border-stone-200 text-stone-700 hover:border-burgundy/50'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label="Store Address / Pickup Location"
              placeholder="Where customers can collect their orders"
              required
              minLength={5}
              maxLength={400}
              value={formData.businessAddress}
              onChange={(e) => setFormData({ ...formData, businessAddress: e.target.value })}
            />
          </div>

          {/* COD Notice */}
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-800 space-y-1">
              <p className="font-bold">Cash on Delivery Only</p>
              <p>K-Shop operates exclusively on COD. No bank account, UPI, or IFSC is required. Payments are collected at delivery.</p>
            </div>
          </div>

          {/* Terms & Submit */}
          <div className="pt-4 border-t border-cream-200 space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                required
                checked={formData.agreeToTerms}
                onChange={(e) => setFormData({ ...formData, agreeToTerms: e.target.checked })}
                className="mt-1 w-4 h-4 accent-burgundy rounded"
              />
              <span className="text-xs text-stone-600 leading-relaxed">
                I confirm that my store and products comply with K-Shop platform standards, and I agree to the
                5% platform fee deducted from each COD sale.
              </span>
            </label>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              isLoading={isSubmitting}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              Submit Seller Application
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
