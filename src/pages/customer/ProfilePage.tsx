import React, { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import {
  User,
  KeyRound,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { CustomerSidebar } from '../../components/customer/CustomerSidebar';
import {
  CATEGORY_CONFIG,
  CATEGORY_OPTIONS,
  GENDER_OPTIONS,
  type Gender,
} from '../../config/academicConfig';
import type { UserCategory } from '../../types/auth';

const namePattern = /^[A-Za-z\s.'-]+$/;

export const ProfilePage: React.FC = () => {
  const { user, isLoading, sessionError, refreshSession, updateProfile, changePin } = useAuth();
  const { showToast } = useToast();

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [gender, setGender] = useState<Gender>((user?.gender as Gender) || 'Male');
  const [category, setCategory] = useState<UserCategory>(user?.category || 'ENGINEERING');
  const [department, setDepartment] = useState(user?.department ?? '');
  const [year, setYear] = useState(user?.year ?? 'I');
  const [registrationNumber, setRegistrationNumber] = useState(user?.registrationNumber ?? '');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isUpdatingPin, setIsUpdatingPin] = useState(false);

  // Sync the form once the server-provided session arrives.
  useEffect(() => {
    if (user) {
      setFullName(user.fullName || '');
      if (user.gender && (GENDER_OPTIONS as readonly string[]).includes(user.gender)) {
        setGender(user.gender as Gender);
      }
      const cat = user.category || 'ENGINEERING';
      setCategory(cat);
      setDepartment(user.department || CATEGORY_CONFIG[cat].departments[0]);
      setYear(user.year || 'I');
      setRegistrationNumber(user.registrationNumber || '');
    }
  }, [user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = fullName.trim();
    if (trimmedName.length < 3 || !namePattern.test(trimmedName)) {
      const message = 'Enter a valid full name (letters only).';
      setProfileError(message);
      showToast(message, 'error');
      return;
    }

    const regRule = CATEGORY_CONFIG[category].registrationNumber;
    const trimmedReg = registrationNumber.trim();
    if (!trimmedReg) {
      const message = 'Register number is required.';
      setProfileError(message);
      showToast(message, 'error');
      return;
    }
    if (!/^\d+$/.test(trimmedReg)) {
      const message = 'Register number must contain digits only.';
      setProfileError(message);
      showToast(message, 'error');
      return;
    }
    if (trimmedReg.length !== regRule.length) {
      const message = regRule.message;
      setProfileError(message);
      showToast(message, 'error');
      return;
    }

    const validDepts = CATEGORY_CONFIG[category].departments;
    if (!department || !validDepts.includes(department)) {
      const message = `Please select a valid department for ${CATEGORY_CONFIG[category].label}.`;
      setProfileError(message);
      showToast(message, 'error');
      return;
    }

    const validYears = CATEGORY_CONFIG[category].studentYears;
    if (!year || !validYears.includes(year)) {
      const message = `Please select a valid academic year.`;
      setProfileError(message);
      showToast(message, 'error');
      return;
    }

    setProfileError(null);
    setIsSavingProfile(true);
    try {
      // Success is only shown after the backend confirms the update.
      await updateProfile({
        fullName: trimmedName,
        gender,
        category,
        userType: user?.userType || 'STUDENT',
        department,
        year,
        registrationNumber: trimmedReg,
      });
      showToast('Personal information updated successfully.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update your profile.';
      setProfileError(message);
      showToast(message, 'error');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(currentPin)) {
      setPinError('Current PIN must be exactly 4 digits.');
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      setPinError('New PIN must be exactly 4 digits.');
      return;
    }
    if (currentPin === newPin) {
      setPinError('New PIN must be different from the current PIN.');
      return;
    }

    setPinError(null);
    setIsUpdatingPin(true);
    try {
      // Server verifies the current PIN and stores the new one hashed.
      const res = await changePin(currentPin, newPin);
      setCurrentPin('');
      setNewPin('');
      showToast(res.message || 'Security PIN successfully updated.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update your PIN.';
      setPinError(message);
      showToast(message, 'error');
    } finally {
      setIsUpdatingPin(false);
    }
  };

  // ── Session states: never fabricate an identity ──────────────────────────
  if (!user && isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mx-auto max-w-md text-center space-y-3 text-stone-500 text-sm">
          <RefreshCw className="w-5 h-5 mx-auto animate-spin text-burgundy" />
          <p>Verifying your session…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mx-auto max-w-md text-center bg-white rounded-3xl border border-cream-200 shadow-soft p-8 space-y-4">
          <AlertTriangle className="w-8 h-8 mx-auto text-rosered-600" />
          <h2 className="font-serif font-bold text-lg text-stone-900">Unable to load your account</h2>
          <p className="text-xs text-stone-500">
            {sessionError ?? 'Your session could not be verified. Please try again.'}
          </p>
          <Button variant="primary" size="sm" onClick={() => void refreshSession()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="border-b border-cream-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
            Sovereign Dossier
          </span>
          <h1 className="text-3xl font-serif font-bold text-stone-900">
            Patron Account & Security
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="burgundy">
            Patron ID: {user.customerId || (user.businessId?.startsWith('KNCR-') ? user.businessId : user.businessId?.replace(/^KNSR-/, 'KNCR-')) || 'KNCR-0001'}
          </Badge>
          {user.isSellerApproved && (
            <Badge variant="emerald">
              Seller ID: {user.sellerId || (user.businessId?.startsWith('KNSR-') ? user.businessId : user.businessId?.replace(/^KNCR-/, 'KNSR-')) || 'KNSR-0001'}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-8 items-start">
        {/* Flipkart Style Left Sidebar */}
        <CustomerSidebar />

        {/* Settings Forms */}
        <div className="flex-1 w-full space-y-8">
          {/* Profile Form */}
          <form
            onSubmit={handleUpdateProfile}
            className="bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft space-y-6"
          >
            <div className="flex items-center justify-between pb-3 border-b border-cream-200">
              <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2">
                <User className="w-4 h-4 text-burgundy" /> Personal Information
              </h3>
              <span className="text-[11px] font-semibold text-stone-400">Campus Identity</span>
            </div>

            {profileError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                {profileError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Full Name */}
              <Input
                label="Full Name"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setProfileError(null);
                }}
                placeholder="Enter your full name"
                required
              />

              {/* College Register Number */}
              <div>
                <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
                  Register Number
                </label>
                <input
                  type="text"
                  value={registrationNumber}
                  onChange={(e) => {
                    setRegistrationNumber(e.target.value.replace(/\D/g, ''));
                    setProfileError(null);
                  }}
                  placeholder={`${CATEGORY_CONFIG[category].registrationNumber.length} digits registration number`}
                  maxLength={CATEGORY_CONFIG[category].registrationNumber.length}
                  required
                  className="w-full bg-white border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
                />
                <p className="text-[10px] text-stone-400 mt-1">
                  {CATEGORY_CONFIG[category].registrationNumber.message}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Campus Stream / Category */}
              <div>
                <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
                  Campus Stream
                </label>
                <select
                  value={category}
                  onChange={(e) => {
                    const newCat = e.target.value as UserCategory;
                    setCategory(newCat);
                    const depts = CATEGORY_CONFIG[newCat].departments;
                    setDepartment(depts[0]);
                    const years = CATEGORY_CONFIG[newCat].studentYears;
                    setYear(years[0]);
                    setProfileError(null);
                  }}
                  className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy font-medium"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
                  Department
                </label>
                <select
                  value={department}
                  onChange={(e) => {
                    setDepartment(e.target.value);
                    setProfileError(null);
                  }}
                  className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy font-medium"
                >
                  {CATEGORY_CONFIG[category].departments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>

              {/* Academic Year */}
              <div>
                <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
                  Academic Year
                </label>
                <select
                  value={year}
                  onChange={(e) => {
                    setYear(e.target.value);
                    setProfileError(null);
                  }}
                  className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy font-medium"
                >
                  {CATEGORY_CONFIG[category].studentYears.map((yr) => (
                    <option key={yr} value={yr}>
                      Year {yr}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
              {/* Gender */}
              <div>
                <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
                  Gender
                </label>
                <select
                  value={gender}
                  onChange={(e) => {
                    setGender(e.target.value as Gender);
                    setProfileError(null);
                  }}
                  className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy font-medium"
                >
                  {GENDER_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              {/* Phone (read-only) */}
              <Input
                label="Phone Number"
                value={`+91 ${user.phone}`}
                disabled
                helperText="Verified during login."
              />

              {/* Email (read-only) */}
              <Input
                label="Email Address"
                value={user.email}
                disabled
                helperText="Verified via OTP."
              />
            </div>

            <div className="pt-2 flex justify-end">
              <Button type="submit" variant="primary" size="sm" isLoading={isSavingProfile}>
                Save Changes
              </Button>
            </div>
          </form>

          {/* Security PIN Form */}
          <form
            id="security-pin"
            onSubmit={handleUpdatePin}
            className="bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft space-y-4"
          >
            <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2 pb-3 border-b border-cream-200">
              <KeyRound className="w-4 h-4 text-burgundy" /> Security PIN Configuration
            </h3>
            <p className="text-xs text-stone-500">
              Your 4-digit numeric PIN authorizes authentication steps and high-value COD releases.
            </p>

            {pinError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                {pinError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Current PIN"
                type="password"
                maxLength={4}
                placeholder="••••"
                value={currentPin}
                onChange={(e) => {
                  setCurrentPin(e.target.value.replace(/\D/g, ''));
                  setPinError(null);
                }}
              />
              <Input
                label="New 4-Digit PIN"
                type="password"
                maxLength={4}
                placeholder="••••"
                value={newPin}
                onChange={(e) => {
                  setNewPin(e.target.value.replace(/\D/g, ''));
                  setPinError(null);
                }}
              />
            </div>

            <div className="pt-2 flex justify-end">
              <Button type="submit" variant="secondary" size="sm" isLoading={isUpdatingPin}>
                Update Security PIN
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
