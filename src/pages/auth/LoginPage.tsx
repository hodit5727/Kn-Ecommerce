/**
 * /login route — same shared AuthFlow as the navbar modal.
 * Previously this route only had Phone/OTP/PIN and skipped onboarding
 * entirely (basic information was never collected here). It now runs the
 * full 6-step flow with email-based OTP.
 */
import React from 'react';
import { AuthFlow } from '../../components/auth/AuthFlow';

export const LoginPage: React.FC = () => {
  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 bg-gradient-to-br from-white via-cream-50 to-ivory">
      <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-xl space-y-4">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-burgundy text-white font-serif font-bold text-2xl flex items-center justify-center mx-auto shadow-soft">
            K
          </div>
          <h1 className="text-2xl font-serif font-bold text-stone-900">Sign In to K-Shop</h1>
          <p className="text-xs text-stone-500">Enter your email address to get started</p>
        </div>

        <AuthFlow />
      </div>
    </div>
  );
};
