/**
 * Navbar login modal — thin shell around the shared AuthFlow.
 * The actual email → OTP → PIN → onboarding steps live in AuthFlow so the
 * modal and the /login route can never diverge.
 */
import React from 'react';
import { X } from 'lucide-react';
import { AuthFlow } from './AuthFlow';

interface AuthModalProps {
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal card */}
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-cream-200 overflow-hidden max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-cream-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-burgundy text-white font-serif font-bold text-lg flex items-center justify-center">
              K
            </div>
            <div>
              <span className="font-serif font-extrabold text-stone-900 text-sm block leading-tight">K-SHOP</span>
              <span className="text-[9px] uppercase tracking-widest text-burgundy font-bold">
                Sovereign Luxury
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-cream-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body hosting the shared flow */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <AuthFlow onFinished={onClose} />
        </div>
      </div>
    </div>
  );
};
