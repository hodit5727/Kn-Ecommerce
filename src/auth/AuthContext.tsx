/**
 * Auth context — session state sourced from the SERVER, never from
 * localStorage/sessionStorage.
 *
 * On mount it asks the Express backend for the current session (HttpOnly
 * cookie). If the backend is unreachable, `sessionError` is exposed so the UI
 * can render a real error state instead of pretending the user is signed out
 * or signed in.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type {
  OnboardingProfilePayload,
  SellerApplicationData,
  UserProfile,
  UserRole,
} from '../types/auth';
import { authService } from '../services/authService';
import { IS_UI_PREVIEW } from '../lib/uiPreview';

interface AuthContextType {
  user: UserProfile | null;
  activeRole: UserRole;
  switchRole: (role: UserRole) => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionError: string | null;
  clearSessionError: () => void;
  refreshSession: () => Promise<void>;
  /** DEV-only UI preview: marks the local walkthrough session (no server). */
  startPreviewSession: (profile: UserProfile) => void;
  /** True while the local UI preview session is active (no server cookie). */
  isPreviewSession: boolean;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  sendOtp: (email: string) => Promise<{ success: boolean; message: string }>;
  verifyOtp: (email: string, otp: string) => Promise<{ requiresProfile: boolean }>;
  setupPin: (email: string, pin: string) => Promise<{ requiresProfile: boolean }>;
  verifyPin: (email: string, pin: string) => Promise<UserProfile>;
  forgotPin: (email: string) => Promise<{ success: boolean; message: string }>;
  resetPin: (email: string, token: string, pin: string) => Promise<{ success: boolean; message: string }>;
  adminLogin: (email: string, password: string) => Promise<void>;
  completeProfile: (payload: OnboardingProfilePayload) => Promise<UserProfile>;
  changePin: (currentPin: string, newPin: string) => Promise<{ success: boolean; message: string }>;
  updateProfile: (data: Partial<OnboardingProfilePayload> & { fullName?: string }) => Promise<UserProfile>;
  applyForSeller: (data: SellerApplicationData) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const messageFrom = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeRole, setActiveRole] = useState<UserRole>('CUSTOMER');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isPreviewSession, setIsPreviewSession] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  const refreshSession = useCallback(async () => {
    if (IS_UI_PREVIEW) {
      // UI preview mode: the backend is intentionally absent, so there is no
      // session to fetch and no error to report — the preview banner
      // communicates the state instead.
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const sessionUser = await authService.getSession();
      setUser(sessionUser);
      setActiveRole(sessionUser ? sessionUser.role : 'CUSTOMER');
      setSessionError(null);
    } catch (err) {
      // Backend unreachable / erroring: no local fallback identity is used.
      setUser(null);
      setActiveRole('CUSTOMER');
      setSessionError(messageFrom(err, 'Unable to verify your session.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  // Keep the active role consistent with the SERVER-provided role.
  useEffect(() => {
    if (!user) {
      setActiveRole('CUSTOMER');
      return;
    }
    if (user.role === 'ADMIN') {
      setActiveRole('ADMIN');
      return;
    }
    if (user.role === 'SELLER') {
      setActiveRole('SELLER');
      return;
    }
    if (user.isSellerApproved || user.roles?.includes('SELLER')) {
      setActiveRole((current) => (current === 'SELLER' ? 'SELLER' : 'CUSTOMER'));
    } else {
      setActiveRole('CUSTOMER');
    }
  }, [user]);

  const switchRole = useCallback((newRole: UserRole) => {
    if (!user) return;
    if (newRole === 'SELLER') {
      if (user.isSellerApproved || user.role === 'SELLER' || user.roles?.includes('SELLER') || user.role === 'ADMIN') {
        setActiveRole('SELLER');
      } else {
        // eslint-disable-next-line no-console
        console.warn('[auth] Cannot switch to SELLER role: seller accreditation is not approved.');
      }
    } else if (newRole === 'ADMIN') {
      if (user.role === 'ADMIN' || user.roles?.includes('ADMIN')) {
        setActiveRole('ADMIN');
      }
    } else {
      setActiveRole('CUSTOMER');
    }
  }, [user]);

  const openAuthModal = () => setIsAuthModalOpen(true);
  const closeAuthModal = () => setIsAuthModalOpen(false);
  const clearSessionError = () => setSessionError(null);

  /**
   * DEV-only: attaches the clearly-marked local walkthrough profile so the
   * post-login layouts can be reviewed. Guarded twice — no-op outside UI
   * preview mode (and the call site itself is stripped from prod builds).
   */
  const startPreviewSession = (profile: UserProfile) => {
    if (IS_UI_PREVIEW) {
      setUser(profile);
      setActiveRole(profile.role);
      setIsPreviewSession(true);
      setSessionError(null);
      return;
    }
    // Outside preview this is a programming error — surface it loudly in dev.
    // (In production builds both conditions constant-fold to nothing.)
    if (import.meta.env.DEV) {
      setSessionError('UI preview mode is not available in this build.');
    }
  };

  const sendOtp = async (email: string) => {
    setIsLoading(true);
    try {
      const res = await authService.sendOtp(email);
      setSessionError(null);
      return res;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyOtp = async (email: string, otp: string) => {
    setIsLoading(true);
    try {
      const res = await authService.verifyOtp(email, otp);
      setSessionError(null);
      return res;
    } finally {
      setIsLoading(false);
    }
  };

  const setupPin = async (email: string, pin: string) => {
    setIsLoading(true);
    try {
      const res = await authService.setupPin(email, pin);
      setSessionError(null);
      return res;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyPin = async (email: string, pin: string) => {
    setIsLoading(true);
    try {
      const profile = await authService.verifyPin(email, pin);
      setUser(profile);
      setActiveRole(profile.role);
      setSessionError(null);
      return profile;
    } catch (err) {
      setSessionError(messageFrom(err, 'PIN verification failed.'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /** Forgot-PIN step 1: server replies with a generic message for every email
   *  (anti-enumeration) and emails a reset code only for real accounts. */
  const forgotPin = async (email: string) => {
    setIsLoading(true);
    try {
      const res = await authService.forgotPin(email);
      setSessionError(null);
      return res;
    } finally {
      setIsLoading(false);
    }
  };

  /** Forgot-PIN step 2: server validates the emailed code, hashes the new PIN,
   *  invalidates prior auth state, and logs the security event. */
  const resetPin = async (email: string, token: string, pin: string) => {
    setIsLoading(true);
    try {
      const res = await authService.resetPin(email, token, pin);
      setSessionError(null);
      return res;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Dedicated admin login (spec §4). The server only returns a user when the
   * password matches a server-provisioned admin account; the client re-checks
   * the role as defense in depth — the backend remains the authority.
   */
  const adminLogin = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const profile = await authService.adminLogin(email, password);
      if (profile.role !== 'ADMIN') {
        throw new Error('Admin access denied.');
      }
      setUser(profile);
      setActiveRole('ADMIN');
      setSessionError(null);
    } catch (err) {
      setUser(null);
      setActiveRole('CUSTOMER');
      setSessionError(messageFrom(err, 'Admin sign-in failed.'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const completeProfile = async (payload: OnboardingProfilePayload) => {
    setIsLoading(true);
    try {
      const profile = await authService.completeProfile(payload);
      setUser(profile);
      setActiveRole(profile.role);
      setSessionError(null);
      return profile;
    } catch (err) {
      setSessionError(messageFrom(err, 'Could not complete profile setup.'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const changePin = async (currentPin: string, newPin: string) => {
    setIsLoading(true);
    try {
      return await authService.changePin(currentPin, newPin);
    } finally {
      setIsLoading(false);
    }
  };

  const updateProfile = async (data: Partial<OnboardingProfilePayload> & { fullName?: string }) => {
    setIsLoading(true);
    try {
      const profile = await authService.updateProfile(data);
      setUser(profile);
      setActiveRole(profile.role);
      setSessionError(null);
      return profile;
    } finally {
      setIsLoading(false);
    }
  };

  const applyForSeller = async (data: SellerApplicationData) => {
    setIsLoading(true);
    try {
      const res = await authService.applyForSellerAccount(data);
      if (res.user) {
        setUser(res.user);
        setActiveRole(res.user.role);
      }
      return res;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    // Preview sessions have no server cookie to invalidate — end them locally.
    if (isPreviewSession) {
      setUser(null);
      setActiveRole('CUSTOMER');
      setIsPreviewSession(false);
      setSessionError(null);
      return;
    }
    setIsLoading(true);
    try {
      await authService.logout();
      // Signed out on the server AND locally — only now show the signed-out UI.
      setUser(null);
      setActiveRole('CUSTOMER');
      setSessionError(null);
    } catch (err) {
      // Server sign-out failed: keep the user signed in (the cookie is still
      // valid) and surface the error instead of faking a successful logout.
      setSessionError(messageFrom(err, 'Sign out failed on the server. Please try again.'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        activeRole,
        switchRole,
        isAuthenticated: !!user,
        isLoading,
        sessionError,
        clearSessionError,
        refreshSession,
        startPreviewSession,
        isPreviewSession,
        isAuthModalOpen,
        openAuthModal,
        closeAuthModal,
        sendOtp,
        verifyOtp,
        setupPin,
        verifyPin,
        forgotPin,
        resetPin,
        adminLogin,
        completeProfile,
        changePin,
        updateProfile,
        applyForSeller,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
