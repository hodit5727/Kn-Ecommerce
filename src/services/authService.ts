/**
 * Customer authentication service — REAL backend calls only.
 *
 * ─── Security design (removed legacy mock/demo flow) ───────────────────────
 * - No localStorage/sessionStorage: the session is an HttpOnly cookie issued
 *   by the Express backend (`credentials: 'include'`). Nothing on the client
 *   is treated as authoritative identity, role, category, or user type.
 * - No DEMO_PROFILES, no role-by-phone-substring, no "accept any OTP/PIN",
 *   no simulateNetworkDelay, no dev-chaos failure toggles.
 * - OTP verification, PIN hashing, rate limiting, attempt limits, duplicate
 *   account prevention, and ALL profile validation happen server-side.
 *
 * ─── API contract for the Express backend (backend phase) ──────────────────
 * POST   /auth/otp/send        { email }                    -> { success, message }
 * POST   /auth/otp/verify      { email, otp }                -> { requiresProfile }
 * POST   /auth/pin/setup       { email, pin }                -> { requiresProfile }
 * POST   /auth/pin/verify      { email, pin }                -> { user }
 * POST   /auth/profile         OnboardingProfilePayload     -> { user }  (creates profile + session)
 * PUT    /auth/profile         { fullName }                  -> { user }
 * POST   /auth/pin/change      { currentPin, newPin }        -> { success, message }
 * POST   /auth/pin/forgot      { email }                    -> { success, message } (always generic — no account enumeration)
 * POST   /auth/pin/reset       { email, token, pin }        -> { success, message } (server validates token, hashes PIN, invalidates prior auth state, logs event)
 * GET    /auth/session                                       -> { user | null } (200 when signed out; 401 only for protected routes)
 * POST   /auth/logout                                       -> { success }
 * POST   /admin/auth/login     { email, password }          -> { user } (server-provisioned admin ONLY; HttpOnly session cookie; ADMIN role verified server-side; password compared server-side — never any hardcoded admin credentials)
 * POST   /seller/applications  SellerApplicationData         -> { success, message, user? }
 * POST   /seller/documents     raw bytes (octet-stream)      -> { storagePath, mimeType, byteSize, signedUrl }
 *
 * Server rules: re-validate every field, reject invalid combinations
 * (wrong department for category, Staff + year/reg, wrong digit counts),
 * hash the PIN (never store plaintext), rate-limit OTP sends, limit OTP
 * attempts, and never expose service-role keys to the client.
 *
 * ─── Email OTP via Supabase Auth (SMTP) ───────────────────────────────────
 * - Login identifier is EMAIL. Express calls Supabase Auth
 *   `signInWithOtp({ email })`; Supabase delivers the 6-digit code through
 *   SMTP (configure it in Supabase Dashboard → Authentication → SMTP Settings
 *   and the "Magic Link / OTP" email template).
 * - Express verifies the code server-side with `verifyOtp`; the frontend only
 *   relays the address and the code — no Supabase keys ever reach the client.
 * - Phone number is NOT a login identifier; it remains a mandatory profile
 *   field collected during onboarding (10-digit Indian format).
 */
import type { OnboardingProfilePayload, SellerApplicationData, SellerDocumentReference, UserProfile } from '../types/auth';
import { ApiError, apiRequest } from '../api/http';

interface SessionResponse {
  user: UserProfile | null;
}

interface UserResponse {
  user: UserProfile;
}

interface OtpVerifyResponse {
  requiresProfile: boolean;
}

interface PinSetupResponse {
  requiresProfile: boolean;
}

interface MessageResponse {
  success: boolean;
  message: string;
}

interface SellerApplicationResponse extends MessageResponse {
  user?: UserProfile;
}

interface SellerDocumentUploadResponse extends SellerDocumentReference {
  /** Short-lived signed URL for the PRIVATE documents bucket (expires server-side). */
  signedUrl: string;
}

export const authService = {
  async sendOtp(email: string): Promise<MessageResponse> {
    return apiRequest<MessageResponse>('/auth/otp/send', {
      body: JSON.stringify({ email }),
    });
  },

  async verifyOtp(email: string, otp: string): Promise<OtpVerifyResponse> {
    return apiRequest<OtpVerifyResponse>('/auth/otp/verify', {
      body: JSON.stringify({ email, otp }),
    });
  },

  /** New (or incomplete-profile) users set their PIN here. Server hashes it. */
  async setupPin(email: string, pin: string): Promise<PinSetupResponse> {
    return apiRequest<PinSetupResponse>('/auth/pin/setup', {
      body: JSON.stringify({ email, pin }),
    });
  },

  /** Returning users verify their PIN; server establishes the session. */
  async verifyPin(email: string, pin: string): Promise<UserProfile> {
    const res = await apiRequest<UserResponse>('/auth/pin/verify', {
      body: JSON.stringify({ email, pin }),
    });
    return res.user;
  },

  /** Final onboarding submit: server validates everything, stores the profile,
   *  and establishes the authenticated session. */
  async completeProfile(payload: OnboardingProfilePayload): Promise<UserProfile> {
    const res = await apiRequest<UserResponse>('/auth/profile', {
      body: JSON.stringify(payload),
    });
    return res.user;
  },

  async updateProfile(data: Partial<OnboardingProfilePayload> & { fullName?: string }): Promise<UserProfile> {
    const res = await apiRequest<UserResponse>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return res.user;
  },

  async changePin(currentPin: string, newPin: string): Promise<MessageResponse> {
    return apiRequest<MessageResponse>('/auth/pin/change', {
      body: JSON.stringify({ currentPin, newPin }),
    });
  },

  /**
   * Forgot-PIN step 1. The server MUST return the same generic success
   * response whether or not the email has an account (anti-enumeration, §5-14)
   * and send a professional reset-code email only for real accounts.
   */
  async forgotPin(email: string): Promise<MessageResponse> {
    return apiRequest<MessageResponse>('/auth/pin/forgot', {
      body: JSON.stringify({ email }),
    });
  },

  /**
   * Forgot-PIN step 2. Server validates the emailed token + rate limits,
   * hashes the new PIN (never plaintext), invalidates the token and prior
   * authentication state, and logs the security event (§6, §36).
   */
  async resetPin(email: string, token: string, pin: string): Promise<MessageResponse> {
    return apiRequest<MessageResponse>('/auth/pin/reset', {
      body: JSON.stringify({ email, token, pin }),
    });
  },

  /**
   * Dedicated admin login (email + password). Express verifies the password
   * against a server-provisioned admin record, issues the HttpOnly session
   * cookie, and only returns a user with role ADMIN (403 otherwise).
   */
  async adminLogin(email: string, password: string): Promise<UserProfile> {
    const res = await apiRequest<UserResponse>('/admin/auth/login', {
      body: JSON.stringify({ email, password }),
    });
    return res.user;
  },

  /** Server-side session lookup. 401/403 means "not signed in" (returns null);
   *  any other failure is thrown so the UI can show a real error state. */
  async getSession(): Promise<UserProfile | null> {
    try {
      const res = await apiRequest<SessionResponse>('/auth/session', { method: 'GET' });
      return res.user;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return null;
      }
      throw err;
    }
  },

  async logout(): Promise<void> {
    await apiRequest<MessageResponse>('/auth/logout', { body: JSON.stringify({}) });
  },

  /**
   * Upload the raw bytes of a college/identity document to the PRIVATE
   * seller-documents bucket (POST /seller/documents). The server sniffs the
   * real MIME type from the bytes (the declared type is never trusted),
   * enforces the 2 MB cap, generates the storage key itself, and returns the
   * reference + a short-lived signed URL. Only that server-returned reference
   * may be attached to the seller application.
   */
  async uploadSellerDocument(file: File): Promise<SellerDocumentUploadResponse> {
    const bytes = await file.arrayBuffer();
    return apiRequest<SellerDocumentUploadResponse>('/seller/documents', {
      method: 'POST',
      body: bytes,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  },

  async applyForSellerAccount(data: SellerApplicationData): Promise<SellerApplicationResponse> {
    return apiRequest<SellerApplicationResponse>('/seller/applications', {
      body: JSON.stringify(data),
    });
  },
};
