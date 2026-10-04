/**
 * Shared customer authentication + onboarding flow.
 *
 * Used by BOTH the navbar AuthModal and the /login route so the two entry
 * points can never diverge again (previously /login skipped onboarding).
 *
 * Login identifier is EMAIL: the Express backend calls Supabase Auth
 * (signInWithOtp → email OTP sent via SMTP) and verifies it server-side.
 *
 * Steps (per spec):
 *   1 Email Verification → 2 OTP Verification → 3 Set PIN
 *   → 4 Basic Information → 5 Academic/Staff Information → 6 Complete Profile
 *
 * Every network step calls the Express backend; success UI only appears after
 * the backend/database operation actually succeeds. When the backend is
 * unavailable the flow shows a real error state — there is no mock fallback,
 * no bypassed OTP, and no locally-trusted identity.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../common/Button';
import {
  Smartphone,
  KeyRound,
  User,
  Mail,
  GraduationCap,
  BookOpen,
  ArrowRight,
  Clock,
  ChevronLeft,
  CheckCircle2,
} from 'lucide-react';
import {
  CATEGORY_CONFIG,
  CATEGORY_OPTIONS,
  GENDER_OPTIONS,
  STAFF_CODE_RULE,
  USER_TYPE_OPTIONS,
  type Gender,
} from '../../config/academicConfig';
import {
  validateProfile,
  validateProfileField,
  type ProfileErrors,
  type ProfileInput,
} from '../../lib/validation';
import type {
  OnboardingProfilePayload,
  UserCategory,
  UserProfile,
  UserType,
} from '../../types/auth';
import {
  IS_UI_PREVIEW,
  PREVIEW_RETURNING_OTP,
  buildPreviewProfile,
  previewDelay,
} from '../../lib/uiPreview';

interface AuthFlowProps {
  /** Called after a completed sign-in / onboarding (e.g. modal close). */
  onFinished?: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const STEPS: Array<{ num: Step; label: string }> = [
  { num: 1, label: 'Email Verification' },
  { num: 2, label: 'OTP Verification' },
  { num: 3, label: 'Set PIN' },
  { num: 4, label: 'Basic Information' },
  { num: 5, label: 'Academic/Staff Information' },
  { num: 6, label: 'Complete Profile' },
];

const STEP_FIELDS: Record<Step, Array<keyof ProfileInput>> = {
  1: ['email'],
  2: [],
  3: [],
  4: ['fullName', 'gender', 'phone', 'email'],
  5: ['category', 'userType', 'department', 'year', 'registrationNumber', 'staffCode'],
  6: [
    'fullName',
    'gender',
    'phone',
    'email',
    'category',
    'userType',
    'department',
    'year',
    'registrationNumber',
    'staffCode',
  ],
};

const FIELD_STEP: Record<keyof ProfileInput, Step> = {
  email: 1,
  fullName: 4,
  gender: 4,
  phone: 4,
  category: 5,
  userType: 5,
  department: 5,
  year: 5,
  registrationNumber: 5,
  staffCode: 5,
};

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export const AuthFlow: React.FC<AuthFlowProps> = ({ onFinished }) => {
  const {
    sendOtp,
    verifyOtp,
    setupPin,
    verifyPin,
    forgotPin,
    resetPin,
    completeProfile,
    startPreviewSession,
  } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);
  const [requiresProfile, setRequiresProfile] = useState(false);
  // Forgot-PIN sub-flow (returning users, spec §6): request → emailed code → reset
  const [showForgotPin, setShowForgotPin] = useState(false);
  const [forgotStage, setForgotStage] = useState<'request' | 'confirm'>('request');
  const [forgotToken, setForgotToken] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ProfileErrors>({});

  // Step 1 — login identifier: email (OTP delivered by Supabase Auth SMTP)
  const [email, setEmail] = useState('');

  // Step 2 — OTP
  const [otp, setOtp] = useState('');

  // Step 3 — PIN
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');

  // Step 4 — Basic Information (mandatory for every user).
  // Phone is collected here (10 digits, mandatory); email is already
  // OTP-verified from step 1 and shown read-only.
  const [phone, setPhone] = useState('');
  const [basicInfo, setBasicInfo] = useState<{
    fullName: string;
    gender: Gender | '';
  }>({ fullName: '', gender: '' });

  // Step 5 — category + student/staff + academic details
  const [category, setCategory] = useState<UserCategory | ''>('');
  const [academic, setAcademic] = useState({
    userType: '' as UserType | '',
    department: '',
    year: '',
    registrationNumber: '',
    staffCode: '',
  });

  // OTP resend countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const clearApiError = () => setApiError(null);

  const clearFieldError = (field: keyof ProfileInput) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const buildInput = (): ProfileInput => ({
    fullName: basicInfo.fullName,
    gender: basicInfo.gender,
    phone,
    email,
    category,
    userType: academic.userType,
    department: academic.department,
    year: academic.year,
    registrationNumber: academic.registrationNumber,
    staffCode: academic.staffCode,
  });

  /** Validates the fields that belong to `currentStep`. Returns true when valid. */
  const validateStep = (currentStep: Step): boolean => {
    const input = buildInput();
    const errors: ProfileErrors = {};
    for (const field of STEP_FIELDS[currentStep]) {
      const message = validateProfileField(field, input[field], input);
      if (message) errors[field] = message;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setApiError(null);
      return false;
    }
    return true;
  };

  const fieldError = (field: keyof ProfileInput) =>
    fieldErrors[field] ? (
      <p className="mt-1 text-[11px] text-rosered-600 font-medium">{fieldErrors[field]}</p>
    ) : null;

  const finish = (profile: UserProfile) => {
    const destination =
      profile.role === 'ADMIN' ? '/admin' : profile.role === 'SELLER' ? '/seller' : '/profile';
    navigate(destination);
    onFinished?.();
  };

  // ── STEP 1: Phone ─────────────────────────────────────────────────────────
  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep(1)) return;
    setIsSubmitting(true);
    clearApiError();
    try {
      if (IS_UI_PREVIEW) {
        await previewDelay();
        showToast('UI preview: OTP email not sent (backend not connected).');
      } else {
        const res = await sendOtp(email.trim());
        showToast(res.message || 'OTP sent to your email.');
      }
      setResendCooldown(60);
      setOtp('');
      setStep(2);
    } catch (err) {
      setApiError(errorMessage(err, 'Could not send OTP. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setIsSubmitting(true);
    clearApiError();
    try {
      if (IS_UI_PREVIEW) {
        await previewDelay();
        showToast('UI preview: OTP email not resent (backend not connected).');
      } else {
        const res = await sendOtp(email.trim());
        showToast(res.message || 'OTP resent.');
      }
      setResendCooldown(60);
      setOtp('');
    } catch (err) {
      setApiError(errorMessage(err, 'Failed to resend OTP.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── STEP 2: OTP ───────────────────────────────────────────────────────────
  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setFieldErrors({} as ProfileErrors);
      setApiError('Please enter the 6-digit OTP sent to your phone.');
      return;
    }
    setIsSubmitting(true);
    clearApiError();
    try {
      if (IS_UI_PREVIEW) {
        await previewDelay();
        // Preview affordance: OTP 000000 = returning user path, anything
        // else = new user path (full 6-step onboarding).
        setRequiresProfile(otp !== PREVIEW_RETURNING_OTP);
      } else {
        const res = await verifyOtp(email.trim(), otp);
        setRequiresProfile(res.requiresProfile);
      }
      setPin('');
      setPinConfirm('');
      setStep(3);
    } catch (err) {
      setApiError(errorMessage(err, 'Invalid OTP. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── STEP 3: PIN (set for new/incomplete profiles, verify for returning) ───
  const handleStep3 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin)) {
      setApiError('PIN must be exactly 4 digits.');
      return;
    }
    if (requiresProfile && pin !== pinConfirm) {
      setApiError('PINs do not match. Please try again.');
      return;
    }
    setIsSubmitting(true);
    clearApiError();
    try {
      if (IS_UI_PREVIEW) {
        await previewDelay();
        if (requiresProfile) {
          setStep(4);
        } else {
          const previewUser = buildPreviewProfile(email.trim());
          startPreviewSession(previewUser);
          showToast('UI preview: signed in locally (no real session).');
          finish(previewUser);
        }
      } else if (requiresProfile) {
        await setupPin(email.trim(), pin);
        setStep(4);
      } else {
        const profile = await verifyPin(email.trim(), pin);
        showToast(`Welcome back, ${profile.fullName}!`);
        finish(profile);
      }
    } catch (err) {
      setApiError(
        errorMessage(err, requiresProfile ? 'Could not set your PIN.' : 'PIN verification failed.'),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── FORGOT PIN (spec §6) ──────────────────────────────────────────────────
  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    clearApiError();
    try {
      if (IS_UI_PREVIEW) {
        await previewDelay();
        showToast('UI preview: no reset email sent (backend not connected).');
      } else {
        const res = await forgotPin(email.trim());
        // Server message is intentionally generic (no account enumeration).
        showToast(res.message || 'If an account exists for this email, a reset code has been sent.');
      }
      setForgotStage('confirm');
      setForgotToken('');
    } catch (err) {
      setApiError(errorMessage(err, 'Could not start PIN reset. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotToken.trim()) {
      setApiError('Enter the reset code from your email.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setApiError('New PIN must be exactly 4 digits.');
      return;
    }
    if (pin !== pinConfirm) {
      setApiError('PINs do not match. Please try again.');
      return;
    }
    setIsSubmitting(true);
    clearApiError();
    try {
      if (IS_UI_PREVIEW) {
        await previewDelay();
        showToast('UI preview: PIN not reset (backend not connected).');
      } else {
        const res = await resetPin(email.trim(), forgotToken.trim(), pin);
        showToast(res.message || 'PIN updated. Please sign in with your new PIN.');
      }
      // Prior auth/OTP state is invalidated server-side — restart the flow.
      setShowForgotPin(false);
      setForgotStage('request');
      setForgotToken('');
      setPin('');
      setPinConfirm('');
      setOtp('');
      setStep(1);
    } catch (err) {
      setApiError(errorMessage(err, 'Could not reset your PIN. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── STEP 4: Basic Information ─────────────────────────────────────────────
  const handleStep4 = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep(4)) return;
    clearApiError();
    setStep(5);
  };

  // ── STEP 5: Academic / Staff Information ──────────────────────────────────
  const handleStep5 = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep(5)) return;
    clearApiError();
    setStep(6);
  };

  const handleCategoryChange = (next: UserCategory) => {
    if (next === category) return;
    const config = CATEGORY_CONFIG[next];
    setCategory(next);
    setAcademic((prev) => ({
      ...prev,
      // Keep values that stay valid for the new category; clear the rest.
      department: config.departments.includes(prev.department) ? prev.department : '',
      year: config.studentYears.includes(prev.year) ? prev.year : '',
      // Registration number formats differ per category — must be re-entered.
      registrationNumber: '',
    }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.category;
      delete next.department;
      delete next.year;
      delete next.registrationNumber;
      return next;
    });
    clearApiError();
  };

  const handleUserTypeChange = (next: UserType) => {
    if (next === academic.userType) return;
    // Keep entered values in state (restored if the user toggles back), but
    // non-applicable fields are excluded from the submitted payload.
    setAcademic((prev) => ({ ...prev, userType: next }));
    setFieldErrors((prev) => {
      const nextErrors = { ...prev };
      delete nextErrors.userType;
      delete nextErrors.department;
      delete nextErrors.year;
      delete nextErrors.registrationNumber;
      delete nextErrors.staffCode;
      return nextErrors;
    });
    clearApiError();
  };

  // ── STEP 6: Complete Profile (final submit) ───────────────────────────────
  const handleStep6 = async (e: React.FormEvent) => {
    e.preventDefault();

    const input = buildInput();
    const errors = validateProfile(input);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstField = (Object.keys(errors) as Array<keyof ProfileInput>)[0];
      setStep(FIELD_STEP[firstField]);
      return;
    }

    // Narrowing guard: unreachable when validation above passes, but keeps
    // the payload types honest (no empty strings reach the API).
    if (!category || !academic.userType) {
      setApiError('Please complete the required fields.');
      setStep(5);
      return;
    }

    const isStaff = academic.userType === 'STAFF';
    const payload: OnboardingProfilePayload = {
      phone,
      fullName: basicInfo.fullName.trim(),
      gender: basicInfo.gender,
      email,
      category,
      userType: academic.userType,
      department: academic.department,
      year: isStaff ? null : academic.year,
      registrationNumber: isStaff ? null : academic.registrationNumber,
      staffCode: isStaff ? academic.staffCode.trim() : null,
    };

    setIsSubmitting(true);
    clearApiError();
    try {
      if (IS_UI_PREVIEW) {
        await previewDelay();
        const previewUser = buildPreviewProfile(payload.email);
        startPreviewSession(previewUser);
        showToast('UI walkthrough complete — nothing was saved (backend pending).');
        finish(previewUser);
      } else {
        const profile = await completeProfile(payload);
        showToast('Profile setup complete! Welcome to K-Shop.');
        finish(profile);
      }
    } catch (err) {
      setApiError(errorMessage(err, 'Could not complete profile setup. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Computed display data ─────────────────────────────────────────────────
  const categoryConfig = category ? CATEGORY_CONFIG[category] : null;
  const isStudent = academic.userType === 'STUDENT';
  const isStaff = academic.userType === 'STAFF';
  const regRule = category ? categoryConfig!.registrationNumber : null;

  const reviewRows: Array<{ label: string; value: string }> = [
    { label: 'Full Name', value: basicInfo.fullName.trim() },
    { label: 'Gender', value: basicInfo.gender },
    { label: 'Phone Number', value: `+91 ${phone}` },
    { label: 'Email (login)', value: email.trim() },
    { label: 'Category', value: categoryConfig ? categoryConfig.label : '' },
    {
      label: 'User Type',
      value: academic.userType === 'STAFF' ? 'Staff' : 'Student',
    },
    { label: 'Department', value: academic.department },
  ];
  if (isStudent) {
    reviewRows.push({ label: 'Year', value: academic.year });
    reviewRows.push({ label: 'Registration Number', value: academic.registrationNumber });
  } else if (isStaff) {
    reviewRows.push({ label: 'Staff Code', value: academic.staffCode.trim() });
  }

  return (
    <>
      {/* UI preview mode banner (DEV + ?uiPreview=1 only; stripped from prod) */}
      {IS_UI_PREVIEW && (
        <div className="mt-1 mb-2 p-2 rounded-xl bg-indigo-50 border border-indigo-200 text-[11px] font-bold text-indigo-700 text-center uppercase tracking-widest">
          UI Preview Mode — no real OTP · no data saved · backend pending
        </div>
      )}

      {/* ── Step indicator (all 6 steps, per spec) ── */}
      <div className="sticky top-0 z-10 bg-white pt-4 pb-3">
        <div className="flex items-start justify-between">
          {STEPS.map((s, idx) => (
            <React.Fragment key={s.num}>
              <div className="flex flex-col items-center gap-1 w-11 sm:w-14">
                <div
                  className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center transition-all ${
                    step === s.num
                      ? 'bg-burgundy text-white ring-4 ring-burgundy/20'
                      : step > s.num
                        ? 'bg-emerald-500 text-white'
                        : 'bg-stone-100 text-stone-400'
                  }`}
                >
                  {step > s.num ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.num}
                </div>
                <span
                  className={`text-[8px] font-semibold uppercase tracking-wider text-center leading-tight ${
                    step === s.num ? 'text-burgundy' : 'text-stone-400'
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-px mt-3 mx-0.5 ${
                    step > s.num ? 'bg-emerald-400' : 'bg-stone-200'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── API / request error banner (no silent failures) ── */}
      {apiError && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-start gap-2">
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>{apiError}</span>
        </div>
      )}

      {/* ════════════════════════════════════════════════
          STEP 1 — Email Verification
      ════════════════════════════════════════════════ */}
      {step === 1 && (
        <form onSubmit={handleStep1} className="space-y-5">
          <div className="text-center space-y-1 pt-1">
            <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center mx-auto mb-3">
              <Mail className="w-6 h-6 text-burgundy" />
            </div>
            <h2 className="font-serif font-extrabold text-xl text-stone-900">Sign In / Join</h2>
            <p className="text-xs text-stone-500">Enter your email address</p>
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
              Email Address <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="email"
                placeholder="you@email.com"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError('email');
                  clearApiError();
                }}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors"
              />
            </div>
            {fieldError('email')}
            <p className="mt-1.5 text-[11px] text-stone-400">
              We email you a 6-digit OTP — no phone number required.
            </p>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            isLoading={isSubmitting}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Send OTP
          </Button>
          <p className="text-center text-[11px] text-stone-400">
            By continuing, you agree to our{' '}
            <span className="text-burgundy font-semibold cursor-pointer hover:underline">Terms of Service</span>
          </p>
        </form>
      )}

      {/* ════════════════════════════════════════════════
          STEP 2 — OTP Verification
      ════════════════════════════════════════════════ */}
      {step === 2 && (
        <form onSubmit={handleStep2} className="space-y-5">
          <div className="text-center space-y-1 pt-1">
            <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center mx-auto mb-3">
              <Smartphone className="w-6 h-6 text-burgundy" />
            </div>
            <h2 className="font-serif font-extrabold text-xl text-stone-900">Verify OTP</h2>
            <p className="text-xs text-stone-500">
              Enter the 6-digit code sent to{' '}
              <strong className="text-stone-800 break-all">{email}</strong>
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-2 uppercase text-center">
              6-Digit OTP
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="• • • • • •"
              required
              value={otp}
              onChange={(e) => {
                setOtp(e.target.value.replace(/\D/g, ''));
                clearApiError();
              }}
              className="w-full px-4 py-3 bg-white border-2 border-stone-200 rounded-xl text-center text-2xl tracking-[0.6em] font-mono text-stone-900 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors"
            />
          </div>

          <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isSubmitting}>
            Verify &amp; Continue
          </Button>

          <div className="flex items-center justify-center gap-3 text-xs">
            {resendCooldown > 0 ? (
              <span className="flex items-center gap-1.5 text-stone-400">
                <Clock className="w-3.5 h-3.5" />
                Resend in {resendCooldown}s
              </span>
            ) : (
              <button type="button" onClick={handleResendOtp} className="text-burgundy font-semibold hover:underline">
                Resend OTP
              </button>
            )}
            <span className="text-stone-300">•</span>
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setOtp('');
                clearApiError();
              }}
              className="text-stone-500 hover:text-stone-700 flex items-center gap-1"
            >
              <ChevronLeft className="w-3 h-3" /> Change email
            </button>
          </div>
        </form>
      )}

      {/* ════════════════════════════════════════════════
          STEP 3 — PIN (set new / verify existing)
      ════════════════════════════════════════════════ */}
      {step === 3 && (
        <form onSubmit={handleStep3} className="space-y-5">
          <div className="text-center space-y-1 pt-1">
            <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center mx-auto mb-3">
              <KeyRound className="w-6 h-6 text-burgundy" />
            </div>
            <h2 className="font-serif font-extrabold text-xl text-stone-900">
              {requiresProfile ? 'Set Your PIN' : 'Enter Your PIN'}
            </h2>
            <p className="text-xs text-stone-500">
              {requiresProfile
                ? 'Create a 4-digit PIN to secure your account'
                : 'Enter your 4-digit security PIN to continue'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-2 uppercase text-center">
              {requiresProfile ? 'Create PIN' : 'Enter PIN'}
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="••••"
              required
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''));
                clearApiError();
              }}
              className="w-full px-4 py-3 bg-white border-2 border-stone-200 rounded-xl text-center text-2xl tracking-[0.8em] font-mono text-stone-900 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors"
            />
          </div>

          {/* Forgot PIN — only meaningful when verifying an existing PIN */}
          {!requiresProfile && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setShowForgotPin(true);
                  setForgotStage('request');
                  setPin('');
                  setPinConfirm('');
                  clearApiError();
                }}
                className="text-xs font-semibold text-burgundy hover:underline"
              >
                Forgot PIN?
              </button>
            </div>
          )}

          {requiresProfile && (
            <div>
              <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-2 uppercase text-center">
                Confirm PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                required
                value={pinConfirm}
                onChange={(e) => {
                  setPinConfirm(e.target.value.replace(/\D/g, ''));
                  clearApiError();
                }}
                className="w-full px-4 py-3 bg-white border-2 border-stone-200 rounded-xl text-center text-2xl tracking-[0.8em] font-mono text-stone-900 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors"
              />
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            isLoading={isSubmitting}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            {requiresProfile ? 'Set PIN & Continue' : 'Sign In'}
          </Button>
        </form>
      )}

      {/* ════════════════════════════════════════════════
          FORGOT PIN — stage 1: request emailed reset code
      ════════════════════════════════════════════════ */}
      {step === 3 && showForgotPin && forgotStage === 'request' && (
        <form onSubmit={handleForgotRequest} className="space-y-5">
          <div className="text-center space-y-1 pt-1">
            <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center mx-auto mb-3">
              <KeyRound className="w-6 h-6 text-burgundy" />
            </div>
            <h2 className="font-serif font-extrabold text-xl text-stone-900">Forgot PIN</h2>
            <p className="text-xs text-stone-500">
              We'll email a reset code to{' '}
              <strong className="text-stone-800 break-all">{email}</strong>
            </p>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            isLoading={isSubmitting}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Send Reset Code
          </Button>

          <button
            type="button"
            onClick={() => {
              setShowForgotPin(false);
              setForgotStage('request');
              clearApiError();
            }}
            className="w-full text-xs font-semibold text-stone-500 hover:text-stone-700 flex items-center justify-center gap-1"
          >
            <ChevronLeft className="w-3 h-3" /> Back to PIN entry
          </button>
        </form>
      )}

      {/* ════════════════════════════════════════════════
          FORGOT PIN — stage 2: emailed code + new PIN + confirm
      ════════════════════════════════════════════════ */}
      {step === 3 && showForgotPin && forgotStage === 'confirm' && (
        <form onSubmit={handleForgotReset} className="space-y-5">
          <div className="text-center space-y-1 pt-1">
            <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center mx-auto mb-3">
              <KeyRound className="w-6 h-6 text-burgundy" />
            </div>
            <h2 className="font-serif font-extrabold text-xl text-stone-900">Reset Your PIN</h2>
            <p className="text-xs text-stone-500">
              Enter the code from your email, then choose a new PIN
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase text-center">
              Reset Code
            </label>
            <input
              type="text"
              inputMode="text"
              maxLength={8}
              placeholder="Code from email"
              required
              value={forgotToken}
              onChange={(e) => {
                setForgotToken(e.target.value.trim());
                clearApiError();
              }}
              className="w-full px-4 py-3 bg-white border-2 border-stone-200 rounded-xl text-center text-lg tracking-[0.4em] font-mono text-stone-900 placeholder-stone-300 placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-2 uppercase text-center">
              New PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="••••"
              required
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''));
                clearApiError();
              }}
              className="w-full px-4 py-3 bg-white border-2 border-stone-200 rounded-xl text-center text-2xl tracking-[0.8em] font-mono text-stone-900 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-2 uppercase text-center">
              Confirm New PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="••••"
              required
              value={pinConfirm}
              onChange={(e) => {
                setPinConfirm(e.target.value.replace(/\D/g, ''));
                clearApiError();
              }}
              className="w-full px-4 py-3 bg-white border-2 border-stone-200 rounded-xl text-center text-2xl tracking-[0.8em] font-mono text-stone-900 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            isLoading={isSubmitting}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Reset PIN
          </Button>

          <button
            type="button"
            onClick={() => {
              setShowForgotPin(false);
              setForgotStage('request');
              setPin('');
              setPinConfirm('');
              clearApiError();
            }}
            className="w-full text-xs font-semibold text-stone-500 hover:text-stone-700 flex items-center justify-center gap-1"
          >
            <ChevronLeft className="w-3 h-3" /> Back to PIN entry
          </button>
        </form>
      )}

      {/* ════════════════════════════════════════════════
          STEP 4 — Basic Information (mandatory for ALL users)
      ════════════════════════════════════════════════ */}
      {step === 4 && (
        <form onSubmit={handleStep4} className="space-y-4">
          <div className="text-center space-y-1 pt-1">
            <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center mx-auto mb-3">
              <User className="w-6 h-6 text-burgundy" />
            </div>
            <h2 className="font-serif font-extrabold text-xl text-stone-900">Basic Information</h2>
            <p className="text-xs text-stone-500">Required for every user</p>
          </div>

          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Enter your full name"
              required
              value={basicInfo.fullName}
              onChange={(e) => {
                setBasicInfo({ ...basicInfo, fullName: e.target.value });
                clearFieldError('fullName');
                clearApiError();
              }}
              className="w-full px-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors"
            />
            {fieldError('fullName')}
          </div>

          {/* Gender */}
          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
              Gender <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {GENDER_OPTIONS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setBasicInfo({ ...basicInfo, gender: g });
                    clearFieldError('gender');
                    clearApiError();
                  }}
                  className={`py-2.5 px-3 text-xs rounded-xl border font-semibold transition-all text-left ${
                    basicInfo.gender === g
                      ? 'bg-burgundy text-white border-burgundy'
                      : 'bg-cream-50 border-stone-200 text-stone-700 hover:border-burgundy/50'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            {fieldError('gender')}
          </div>

          {/* Phone Number — mandatory profile field (login identifier is email) */}
          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <div className="flex items-center px-3 py-2.5 bg-cream-50 border border-stone-200 rounded-xl text-sm font-semibold text-stone-700 shrink-0">
                +91
              </div>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                required
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value.replace(/\D/g, ''));
                  clearFieldError('phone');
                  clearApiError();
                }}
                className="flex-1 px-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors tracking-wider font-mono"
              />
            </div>
            {fieldError('phone')}
            <p className="mt-1.5 text-[11px] text-stone-400">Indian numbers only (6–9 prefix, 10 digits)</p>
          </div>

          {/* Email — the OTP-verified login identifier from step 1 */}
          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
              Email Address <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={email}
                disabled
                className="flex-1 px-4 py-2.5 bg-cream-50 border border-stone-200 rounded-xl text-sm text-stone-600 cursor-not-allowed"
              />
              <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" /> Verified
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-stone-400">
              Verified via OTP — used to sign in. To change it, go back before verifying.
            </p>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Continue
          </Button>
        </form>
      )}

      {/* ════════════════════════════════════════════════
          STEP 5 — Academic / Staff Information (dynamic)
      ════════════════════════════════════════════════ */}
      {step === 5 && (
        <form onSubmit={handleStep5} className="space-y-4">
          <div className="text-center space-y-1 pt-1">
            <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center mx-auto mb-3">
              <GraduationCap className="w-6 h-6 text-burgundy" />
            </div>
            <h2 className="font-serif font-extrabold text-xl text-stone-900">Academic / Staff Details</h2>
            <p className="text-xs text-stone-500">Select your category and fill in the details</p>
          </div>

          {/* Category selection */}
          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
              Category <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2.5">
              {CATEGORY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleCategoryChange(option.value)}
                  className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border-2 transition-all text-left ${
                    category === option.value
                      ? 'bg-burgundy/5 border-burgundy'
                      : 'bg-white border-stone-200 hover:border-burgundy/40'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        category === option.value ? 'bg-burgundy text-white' : 'bg-cream-100 text-stone-600'
                      }`}
                    >
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div>
                      <span
                        className={`block text-sm font-bold ${
                          category === option.value ? 'text-burgundy' : 'text-stone-900'
                        }`}
                      >
                        {option.label}
                      </span>
                      <span className="text-[11px] text-stone-400">
                        {CATEGORY_CONFIG[option.value].description}
                      </span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      category === option.value ? 'border-burgundy bg-burgundy' : 'border-stone-300'
                    }`}
                  >
                    {category === option.value && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </button>
              ))}
            </div>
            {fieldError('category')}
          </div>

          {/* Student / Staff — required for every category */}
          {category && (
            <div>
              <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
                I am a <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {USER_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleUserTypeChange(option.value)}
                    className={`py-3 rounded-xl border-2 text-sm font-bold transition-all ${
                      academic.userType === option.value
                        ? 'bg-burgundy text-white border-burgundy'
                        : 'bg-white border-stone-200 text-stone-700 hover:border-burgundy/40'
                    }`}
                  >
                    {option.value === 'STUDENT' ? '🎓 Student' : '👨‍🏫 Staff'}
                  </button>
                ))}
              </div>
              {fieldError('userType')}
            </div>
          )}

          {/* Department — both students and staff */}
          {category && academic.userType && (
            <div>
              <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
                Department <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {categoryConfig!.departments.map((dept) => (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => {
                      setAcademic((prev) => ({ ...prev, department: dept }));
                      clearFieldError('department');
                      clearApiError();
                    }}
                    className={`py-2 px-1 text-[10px] rounded-xl border font-semibold transition-all text-center leading-tight ${
                      academic.department === dept
                        ? 'bg-burgundy text-white border-burgundy'
                        : 'bg-cream-50 border-stone-200 text-stone-700 hover:border-burgundy/40'
                    }`}
                  >
                    {dept}
                  </button>
                ))}
              </div>
              {fieldError('department')}
            </div>
          )}

          {/* Year — students only (hidden for staff) */}
          {category && isStudent && (
            <div>
              <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
                Year <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                {categoryConfig!.studentYears.map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => {
                      setAcademic((prev) => ({ ...prev, year: yr }));
                      clearFieldError('year');
                      clearApiError();
                    }}
                    className={`flex-1 py-2.5 text-sm font-bold rounded-xl border-2 transition-all ${
                      academic.year === yr
                        ? 'bg-burgundy text-white border-burgundy'
                        : 'bg-white border-stone-200 text-stone-700 hover:border-burgundy/40'
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
              {fieldError('year')}
            </div>
          )}

          {/* Registration Number — students only (hidden for staff) */}
          {category && isStudent && (
            <div>
              <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
                Registration Number ({regRule!.length} digits) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder={`e.g. ${'0'.repeat(regRule!.length)}`}
                required
                value={academic.registrationNumber}
                onChange={(e) => {
                  setAcademic((prev) => ({
                    ...prev,
                    registrationNumber: e.target.value.replace(/\D/g, ''),
                  }));
                  clearFieldError('registrationNumber');
                  clearApiError();
                }}
                className="w-full px-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors font-mono tracking-widest"
              />
              <p className="mt-1 text-[11px] text-stone-400">{regRule!.message}</p>
              {fieldError('registrationNumber')}
            </div>
          )}

          {/* Staff Code — staff only */}
          {category && isStaff && (
            <div>
              <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
                Staff Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. STF2024"
                required
                value={academic.staffCode}
                onChange={(e) => {
                  setAcademic((prev) => ({ ...prev, staffCode: e.target.value.toUpperCase() }));
                  clearFieldError('staffCode');
                  clearApiError();
                }}
                className="w-full px-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy transition-colors font-mono tracking-wider"
              />
              <p className="mt-1 text-[11px] text-stone-400">{STAFF_CODE_RULE.message}</p>
              {fieldError('staffCode')}
            </div>
          )}

          {isStaff && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800">
              Staff users do not need to provide a student registration number or a year.
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Review Profile
          </Button>

          <button
            type="button"
            onClick={() => {
              setStep(4);
              clearApiError();
            }}
            className="w-full text-xs text-stone-500 hover:text-stone-700 flex items-center justify-center gap-1 py-1"
          >
            <ChevronLeft className="w-3 h-3" /> Back
          </button>
        </form>
      )}

      {/* ════════════════════════════════════════════════
          STEP 6 — Complete Profile (review + submit)
      ════════════════════════════════════════════════ */}
      {step === 6 && (
        <form onSubmit={handleStep6} className="space-y-4">
          <div className="text-center space-y-1 pt-1">
            <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6 text-burgundy" />
            </div>
            <h2 className="font-serif font-extrabold text-xl text-stone-900">Complete Profile</h2>
            <p className="text-xs text-stone-500">Review your information before submitting</p>
          </div>

          <div className="rounded-2xl border border-cream-200 bg-cream-50/60 divide-y divide-cream-100 overflow-hidden">
            {reviewRows.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 shrink-0">
                  {row.label}
                </span>
                <span className="text-xs font-bold text-stone-900 text-right break-words">
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-stone-400 text-center">
            Your profile is saved only after the server validates and confirms every detail.
          </p>

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            isLoading={isSubmitting}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Create Profile
          </Button>

          <button
            type="button"
            onClick={() => {
              setStep(5);
              clearApiError();
            }}
            className="w-full text-xs text-stone-500 hover:text-stone-700 flex items-center justify-center gap-1 py-1"
          >
            <ChevronLeft className="w-3 h-3" /> Back
          </button>
        </form>
      )}
    </>
  );
};
