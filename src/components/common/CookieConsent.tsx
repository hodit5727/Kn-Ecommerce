/**
 * GDPR & ePrivacy Compliant Cookie Consent Banner & Management Modal.
 *
 * Enforces prior consent before initializing non-essential telemetry or analytics.
 * Strictly necessary cookies (auth, session, security tokens) are always active.
 * Provides granular toggles and allows patrons to withdraw or reconfigure consent anytime.
 */
import React, { useState, useEffect } from 'react';
import { ShieldCheck, Cookie, Settings, Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface CookiePreferences {
  essential: true;
  functional: boolean;
  analytics: boolean;
  timestamp: string;
}

const STORAGE_KEY = 'kshop_cookie_consent_v1';

export function getCookieConsent(): CookiePreferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function openCookieSettingsModal(): void {
  window.dispatchEvent(new CustomEvent('open-kshop-cookie-settings'));
}

export const CookieConsent: React.FC = () => {
  const [hasDecided, setHasDecided] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [functional, setFunctional] = useState<boolean>(true);
  const [analytics, setAnalytics] = useState<boolean>(false);

  useEffect(() => {
    const consent = getCookieConsent();
    if (!consent) {
      setHasDecided(false);
    } else {
      setFunctional(consent.functional ?? true);
      setAnalytics(consent.analytics ?? false);
    }

    const handleOpenSettings = () => setIsModalOpen(true);
    window.addEventListener('open-kshop-cookie-settings', handleOpenSettings);
    return () => window.removeEventListener('open-kshop-cookie-settings', handleOpenSettings);
  }, []);

  const saveConsent = (f: boolean, a: boolean) => {
    const prefs: CookiePreferences = {
      essential: true,
      functional: f,
      analytics: a,
      timestamp: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {}
    setFunctional(f);
    setAnalytics(a);
    setHasDecided(true);
    setIsModalOpen(false);
    window.dispatchEvent(new CustomEvent('kshop-consent-updated', { detail: prefs }));
  };

  const handleAcceptAll = () => saveConsent(true, true);
  const handleRejectNonEssential = () => saveConsent(false, false);
  const handleSaveCustom = () => saveConsent(functional, analytics);

  return (
    <>
      {/* Bottom Sticky Consent Banner */}
      {!hasDecided && !isModalOpen && (
        <aside
          aria-label="Cookie consent banner"
          className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6 bg-white/95 backdrop-blur-md border-t border-cream-200 shadow-2xl animate-fade-in"
        >
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 max-w-3xl">
              <div className="p-2.5 rounded-xl bg-burgundy/10 text-burgundy shrink-0 mt-0.5">
                <Cookie className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-serif font-bold text-stone-900 flex items-center gap-2">
                  <span>Privacy & Sovereign Data Governance</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-cream-200 text-stone-700">
                    GDPR
                  </span>
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  We use cookies and sovereign local tokens strictly to authenticate your sessions, safeguard escrow transactions, and maintain your wishlist. We do not use third-party behavioral advertising cookies. Learn more in our{' '}
                  <Link to="/privacy-policy" className="text-burgundy font-semibold underline underline-offset-2 hover:text-[#72001e]">
                    Privacy Policy
                  </Link>.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full md:w-auto flex-wrap sm:flex-nowrap shrink-0">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="flex-1 md:flex-none px-3.5 py-2 rounded-xl border border-cream-300 bg-white text-stone-700 hover:bg-cream-50 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 shadow-2xs"
              >
                <Settings className="w-3.5 h-3.5 text-stone-500" />
                <span>Customize</span>
              </button>

              <button
                type="button"
                onClick={handleRejectNonEssential}
                className="flex-1 md:flex-none px-3.5 py-2 rounded-xl border border-cream-300 bg-ivory text-stone-800 hover:bg-cream-100 text-xs font-semibold transition-all shadow-2xs"
              >
                Reject Optional
              </button>

              <button
                type="button"
                onClick={handleAcceptAll}
                className="flex-1 md:flex-none px-5 py-2 rounded-xl bg-burgundy hover:bg-[#72001e] text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5 text-white" />
                <span>Accept All</span>
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Granular Cookie Preferences Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cookie-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        >
          <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-xs" onClick={() => setIsModalOpen(false)} />

          <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-cream-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-cream-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-burgundy/10 text-burgundy">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h2 id="cookie-modal-title" className="font-serif font-bold text-base text-stone-900">
                    Cookie & Privacy Preferences
                  </h2>
                  <p className="text-[11px] text-stone-500">Manage your data consent settings</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-cream-100 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* Category 1: Strictly Necessary */}
              <div className="p-4 rounded-2xl bg-cream-50/70 border border-cream-200 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-stone-900">Strictly Necessary Cookies</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      Always Active
                    </span>
                  </div>
                </div>
                <p className="text-stone-600 text-[11px] leading-relaxed">
                  Essential for the platform to function securely. Includes Supabase Auth tokens, session cookies, CSRF protection, and COD order transaction routing. Cannot be disabled.
                </p>
              </div>

              {/* Category 2: Functional */}
              <div className="p-4 rounded-2xl bg-white border border-cream-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="functional-toggle" className="font-bold text-stone-900 cursor-pointer">
                    Functional & Preference Storage
                  </label>
                  <input
                    id="functional-toggle"
                    type="checkbox"
                    checked={functional}
                    onChange={(e) => setFunctional(e.target.checked)}
                    className="w-4 h-4 text-burgundy rounded border-cream-300 focus:ring-burgundy cursor-pointer"
                  />
                </div>
                <p className="text-stone-600 text-[11px] leading-relaxed">
                  Preserves your UI state, currency formatting (₹ INR), wishlist items across refreshes, and recent catalog filters.
                </p>
              </div>

              {/* Category 3: Analytics */}
              <div className="p-4 rounded-2xl bg-white border border-cream-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="analytics-toggle" className="font-bold text-stone-900 cursor-pointer">
                    Performance Telemetry
                  </label>
                  <input
                    id="analytics-toggle"
                    type="checkbox"
                    checked={analytics}
                    onChange={(e) => setAnalytics(e.target.checked)}
                    className="w-4 h-4 text-burgundy rounded border-cream-300 focus:ring-burgundy cursor-pointer"
                  />
                </div>
                <p className="text-stone-600 text-[11px] leading-relaxed">
                  Anonymous client error monitoring sent to the server incident handler to identify crashes and network latency. Never tracks personal identifiers.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-cream-100 bg-ivory flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleRejectNonEssential}
                className="px-4 py-2 rounded-xl border border-cream-300 bg-white text-stone-700 hover:bg-cream-100 text-xs font-semibold transition-all"
              >
                Reject All Optional
              </button>
              <button
                type="button"
                onClick={handleSaveCustom}
                className="px-5 py-2 rounded-xl bg-burgundy hover:bg-[#72001e] text-white text-xs font-bold transition-all shadow-sm"
              >
                Save Preferences
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
