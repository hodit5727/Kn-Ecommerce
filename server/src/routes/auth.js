/**
 * Customer auth routes (Phase 4: session infrastructure + Phase 5: PIN).
 *
 * Contract (src/services/authService.ts):
 *   POST /auth/otp/send        { email }              → { success, message }
 *   POST /auth/otp/verify      { email, otp }         → { requiresProfile }
 *   POST /auth/pin/setup       { email, pin }         → { requiresProfile }
 *   POST /auth/pin/verify      { email, pin }         → { user }
 *   POST /auth/pin/change      { currentPin, newPin } → { success, message }
 *   POST /auth/pin/forgot      { email }              → { success, message } (generic — no enumeration)
 *   POST /auth/pin/reset       { email, token, pin }  → { success, message }
 *   GET  /auth/session                                → { user | null } (200 when signed out)
 *   POST /auth/logout                                 → { success }
 *
 * Security: email OTP via Supabase Auth (SMTP); session = Supabase tokens in
 * signed HttpOnly SameSite=Lax cookies; every request re-validated
 * server-side. PINs exist only as scrypt hashes (§5); reset codes are
 * 6-digit, emailed via SMTP, stored hashed with expiry in auth user
 * app_metadata (never client-controlled); verify is rate-limited + DB
 * lockout after 5 failures; forgot/reset return identical generic responses
 * (spec §6 anti-enumeration).
 */
import { Router } from 'express';
import {
  HttpError,
  httpError,
  ok,
  withReadRetry,
  isTransientUpstreamError,
  describeUpstreamError,
} from '../lib/errors.js';
import { ACCESS_COOKIE, setSessionCookies, clearSessionCookies, getSessionTokens } from '../lib/cookies.js';
import { isValidEmail, isValidOtp, isValidPin } from '../lib/validate.js';
import { loadProfileRow, computeOnboardingComplete } from '../lib/profile.js';
import { profileToUser } from '../lib/shape.js';
import { hashPin, verifyPin, generateResetCode, hashResetCode, verifyResetCode } from '../lib/hash.js';
import { writeAudit } from '../lib/audit.js';
import { sendPinResetEmail } from '../lib/mail.js';
import { resolveSession, requireAuth } from '../middleware/auth.js';
import {
  otpSendLimiter,
  otpVerifyLimiter,
  pinSetupLimiter,
  pinVerifyLimiter,
  pinChangeLimiter,
  pinForgotLimiter,
  pinResetLimiter,
} from '../middleware/security.js';

const PIN_MAX_ATTEMPTS = 5; // wrong PINs before the account PIN locks
const PIN_LOCK_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5; // wrong emailed reset codes before it is voided

export function createAuthRouter({ env, supabase }) {
  const router = Router();

  // ── POST /auth/otp/send ────────────────────────────────────────────────
  router.post('/auth/otp/send', otpSendLimiter(), async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!isValidEmail(email)) throw httpError(400, 'Enter a valid email address.');

    // Supabase Auth sends the 6-digit code via the project's SMTP settings.
    const { error } = await supabase.anon.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: env.APP_URL },
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[auth/otp/send] upstream error:', error.message);
      throw httpError(502, 'Unable to send the verification code. Please try again later.');
    }
    return ok(res, { success: true, message: 'Verification code sent to your email.' });
  });

  // ── POST /auth/otp/verify ──────────────────────────────────────────────
  router.post('/auth/otp/verify', otpVerifyLimiter(), async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
    if (!isValidEmail(email)) throw httpError(400, 'Enter a valid email address.');
    if (!isValidOtp(otp)) throw httpError(400, 'Enter the 6-digit verification code.');

    const { data, error } = await supabase.anon.auth.verifyOtp({ email, token: otp, type: 'email' });
    if (error || !data?.user) {
      // eslint-disable-next-line no-console
      console.error('[auth/otp/verify] upstream error:', error?.code ?? '', error?.message ?? 'no user returned');
      throw httpError(400, 'Invalid or expired verification code.');
    }
    const user = data.user;
    const session = data.session;
    if (!session?.access_token) {
      // eslint-disable-next-line no-console
      console.error('[auth/otp/verify] Supabase returned no session');
      throw httpError(502, 'Unable to complete verification. Please try again later.');
    }

    // Minimal profile stub so Phase-5 PIN storage has a row to write to.
    // The identity trigger (0002) assigns the KNCR business id + roles.
    const { error: upsertError } = await supabase.service
      .from('profiles')
      .upsert({ id: user.id, email }, { onConflict: 'id' });
    if (upsertError) {
      // eslint-disable-next-line no-console
      console.error('[auth/otp/verify] profile upsert failed:', upsertError.message);
      throw httpError(502, 'Unable to complete verification. Please try again later.');
    }

    // requiresProfile is COMPUTED from real stored state, never client input.
    const row = await loadProfileRow(supabase.service, user.id);

    // Administrator accounts use the dedicated password login
    // (/admin/auth/login) and MUST never enter the customer OTP/PIN/onboarding
    // flow. Without this gate the same email flips between "set PIN → steps
    // 4–6" (when its profiles row is still a CUSTOMER stub) and "verify PIN →
    // 'No PIN has been set'" (once the ADMIN row exists) — a confusing,
    // non-deterministic failure at the exact step-3→4 boundary. §2.2, §5-10/11.
    if (row && row.role === 'ADMIN') {
      throw httpError(
        403,
        'This email belongs to an administrator account. Use the admin sign-in instead.',
      );
    }

    setSessionCookies(res, session, env);
    return ok(res, { requiresProfile: !computeOnboardingComplete(row) });
  });

  // ── GET /auth/session ──────────────────────────────────────────────────
  // Refreshes the server-side session when the access token expired.
  // Signed out is a VALID answer for a session-query endpoint: 200 with
  // user:null — never a 401 that floods the console. 401 is reserved for
  // routes that genuinely require authentication.
  router.get('/auth/session', async (req, res) => {
    let tokens;
    try {
      tokens = getSessionTokens(req);
    } catch {
      tokens = null;
    }
    if (!tokens) return ok(res, { user: null });

    try {
      const sessionData = await withReadRetry(
        async () => {
          const s = await resolveSession(supabase, tokens);
          const r = await loadProfileRow(supabase.service, s.user.id);
          return { ...s, row: r };
        },
        { label: 'auth-session' }
      );

      const { session, refreshed, row } = sessionData;
      if (!row) {
        // Authenticated token but no profile row — treat as signed out.
        clearSessionCookies(res, env);
        return ok(res, { user: null });
      }
      if (row.status === 'SUSPENDED') {
        throw httpError(403, 'Account suspended. Please contact support.');
      }
      if (row.status === 'DEACTIVATED') {
        throw httpError(403, 'Account deactivated.');
      }
      if (refreshed) setSessionCookies(res, session, env);
      return ok(res, { user: profileToUser(row) });
    } catch (err) {
      // Stale/invalid session — sign the client out quietly with a clean 200.
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        if (err.status === 401) {
          clearSessionCookies(res, env);
          return ok(res, { user: null });
        }
        throw err;
      }
      if (isTransientUpstreamError(err)) {
        // eslint-disable-next-line no-console
        console.warn('[auth/session] transient upstream outage; answering user:null:', describeUpstreamError(err));
        return ok(res, { user: null });
      }
      throw err;
    }
  });

  // ── POST /auth/logout ──────────────────────────────────────────────────
  router.post('/auth/logout', async (req, res) => {
    // Best-effort server-side revocation of the Supabase session; the local
    // cookies are ALWAYS cleared — the signed-out client state is real.
    const accessToken = req.signedCookies?.[ACCESS_COOKIE];
    if (accessToken) {
      try {
        await supabase.anon.auth.setSession({
          access_token: accessToken,
          refresh_token: req.signedCookies?.ks_refresh ?? null,
        });
        await supabase.anon.auth.signOut({ scope: 'global' });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[auth/logout] session revoke failed:', e?.message ?? e);
      }
    }
    clearSessionCookies(res, env);
    return ok(res, { success: true });
  });

  // ── PHASE 5: CUSTOMER PIN ──────────────────────────────────────────────
  // All PIN management requires a live session and the email in the body must
  // match the session user (no cross-user PIN manipulation, §5-77). PINs are
  // only ever stored as scrypt hashes (§5/§2.9).

  // ── POST /auth/pin/setup (first-time / incomplete-profile users) ────────
  router.post('/auth/pin/setup', requireAuth(supabase, env), pinSetupLimiter(), async (req, res) => {
    const { profile, user } = req.auth;
    if (profile.role === 'ADMIN') {
      // Defense in depth: the OTP-verify gate keeps admins out of the customer
      // flow; this catches any path that slipped through with a live admin
      // session (§5-10/11).
      throw httpError(
        403,
        'This email belongs to an administrator account. Use the admin sign-in instead.',
      );
    }
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!isValidEmail(email)) throw httpError(400, 'Enter a valid email address.');
    if (email !== String(user.email ?? '').trim().toLowerCase()) {
      throw httpError(403, 'Forbidden.');
    }
    if (!isValidPin(pin)) throw httpError(400, 'PIN must be exactly 4 digits.');

    const { error } = await supabase.service
      .from('profiles')
      .update({ pin_hash: hashPin(pin), pin_failed_attempts: 0, pin_locked_until: null })
      .eq('id', profile.id);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[auth/pin/setup] profile update failed:', error.message);
      throw httpError(502, 'Unable to save your PIN. Please try again.');
    }

    const row = await loadProfileRow(supabase.service, profile.id);
    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'customer.pin.setup',
      resourceType: 'profile',
      resourceId: profile.id,
      ip: req.ip ?? null,
      metadata: { email },
    });
    return ok(res, { requiresProfile: !computeOnboardingComplete(row) });
  });

  // ── POST /auth/pin/verify (returning users; lockout after 5 failures) ───
  router.post('/auth/pin/verify', requireAuth(supabase, env), pinVerifyLimiter(), async (req, res) => {
    const { profile, user } = req.auth;
    if (profile.role === 'ADMIN') {
      // The admin persona proves identity with its password, never a PIN.
      throw httpError(
        403,
        'This email belongs to an administrator account. Use the admin sign-in instead.',
      );
    }
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!isValidEmail(email)) throw httpError(400, 'Enter a valid email address.');
    if (email !== String(user.email ?? '').trim().toLowerCase()) {
      throw httpError(403, 'Forbidden.');
    }
    if (!isValidPin(pin)) throw httpError(400, 'PIN must be exactly 4 digits.');

    const lockedUntil = profile.pin_locked_until ? new Date(profile.pin_locked_until) : null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
      throw httpError(
        429,
        `Too many incorrect attempts. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`,
      );
    }
    if (!profile.pin_hash) {
      throw httpError(400, 'No PIN has been set. Please set up your PIN first.');
    }

    if (verifyPin(pin, profile.pin_hash)) {
      const { error: resetError } = await supabase.service
        .from('profiles')
        .update({ pin_failed_attempts: 0, pin_locked_until: null })
        .eq('id', profile.id);
      if (resetError) {
        // eslint-disable-next-line no-console
        console.error('[auth/pin/verify] reset attempts failed:', resetError.message);
        throw httpError(502, 'Unable to verify your PIN. Please try again.');
      }
      const row = await loadProfileRow(supabase.service, profile.id);
      await writeAudit(supabase, {
        actorId: profile.id,
        actorRole: profile.role,
        action: 'customer.pin.verify',
        resourceType: 'profile',
        resourceId: profile.id,
        ip: req.ip ?? null,
        metadata: { email },
      });
      return ok(res, { user: profileToUser(row) });
    }

    // Wrong PIN — count it and lock the account at the threshold (§5-15).
    const attempts = Number(profile.pin_failed_attempts ?? 0) + 1;
    const updateFields =
      attempts >= PIN_MAX_ATTEMPTS
        ? {
            pin_failed_attempts: 0,
            pin_locked_until: new Date(Date.now() + PIN_LOCK_MINUTES * 60000).toISOString(),
          }
        : { pin_failed_attempts: attempts };
    const { error: attemptError } = await supabase.service
      .from('profiles')
      .update(updateFields)
      .eq('id', profile.id);
    if (attemptError) {
      // eslint-disable-next-line no-console
      console.error('[auth/pin/verify] attempts update failed:', attemptError.message);
    }
    throw httpError(400, 'Incorrect PIN. Please try again.');
  });

  // ── POST /auth/pin/change ───────────────────────────────────────────────
  router.post('/auth/pin/change', requireAuth(supabase, env), pinChangeLimiter(), async (req, res) => {
    const { profile } = req.auth;
    const currentPin = typeof req.body?.currentPin === 'string' ? req.body.currentPin.trim() : '';
    const newPin = typeof req.body?.newPin === 'string' ? req.body.newPin.trim() : '';
    if (!isValidPin(currentPin) || !isValidPin(newPin)) {
      throw httpError(400, 'PIN must be exactly 4 digits.');
    }
    if (!profile.pin_hash) {
      throw httpError(400, 'No PIN has been set yet.');
    }
    if (!verifyPin(currentPin, profile.pin_hash)) {
      throw httpError(400, 'Current PIN is incorrect.');
    }

    const { error } = await supabase.service
      .from('profiles')
      .update({ pin_hash: hashPin(newPin), pin_failed_attempts: 0, pin_locked_until: null })
      .eq('id', profile.id);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[auth/pin/change] profile update failed:', error.message);
      throw httpError(502, 'Unable to change your PIN. Please try again.');
    }

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'customer.pin.change',
      resourceType: 'profile',
      resourceId: profile.id,
      ip: req.ip ?? null,
    });
    return ok(res, { success: true, message: 'PIN updated successfully.' });
  });

  // ── POST /auth/pin/forgot (spec §6 — step 1) ────────────────────────────
  // NO session required (the user may be locked out). The response is
  // IDENTICAL whether or not the email has an account — never enumerate.
  router.post('/auth/pin/forgot', pinForgotLimiter(), async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!isValidEmail(email)) throw httpError(400, 'Enter a valid email address.');

    const { data: profile, error: lookupError } = await supabase.service
      .from('profiles')
      .select('id, email, role')
      .eq('email', email)
      .maybeSingle();
    if (lookupError) {
      // eslint-disable-next-line no-console
      console.error('[auth/pin/forgot] profile lookup failed:', lookupError.message);
    }

    if (!lookupError && profile) {
      try {
        const code = generateResetCode();
        const expiresAt = new Date(Date.now() + env.PIN_RESET_TTL_MINUTES * 60000).toISOString();
        const { error: metaError } = await supabase.service.auth.admin.updateUserById(profile.id, {
          app_metadata: {
            pin_reset_code_hash: hashResetCode(code, profile.id, expiresAt),
            pin_reset_expires_at: expiresAt,
            pin_reset_attempts: 0,
          },
        });
        if (metaError) throw metaError;
        await sendPinResetEmail(env, { to: email, code, validMinutes: env.PIN_RESET_TTL_MINUTES });
        await writeAudit(supabase, {
          actorId: profile.id,
          actorRole: profile.role,
          action: 'customer.pin.forgot',
          resourceType: 'profile',
          resourceId: profile.id,
          ip: req.ip ?? null,
          metadata: { email },
        });
      } catch (e) {
        // Loud server-side failure; the client still gets the generic answer.
        // eslint-disable-next-line no-console
        console.error('[auth/pin/forgot] reset email failed:', e && e.message ? e.message : e);
        await writeAudit(supabase, {
          actorId: profile.id,
          actorRole: profile.role,
          action: 'customer.pin.forgot',
          resourceType: 'profile',
          resourceId: profile.id,
          result: 'FAILURE',
          ip: req.ip ?? null,
          metadata: { email },
        });
      }
    }

    // Generic anti-enumeration response ALWAYS (§5-14, §6).
    return ok(res, {
      success: true,
      message: 'If an account exists for this email, a reset code has been sent.',
    });
  });

  // ── POST /auth/pin/reset (spec §6 — step 2) ─────────────────────────────
  // Validates the emailed code (expiry + attempts + timing-safe compare),
  // then stores the new PIN, voids the code and clears the client cookies.
  router.post('/auth/pin/reset', pinResetLimiter(), async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!isValidEmail(email) || !isValidOtp(token) || !isValidPin(pin)) {
      throw httpError(400, 'Enter a valid email, 6-digit reset code and a 4-digit new PIN.');
    }

    const { data: profile, error: lookupError } = await supabase.service
      .from('profiles')
      .select('id, email, role')
      .eq('email', email)
      .maybeSingle();
    if (lookupError) {
      // eslint-disable-next-line no-console
      console.error('[auth/pin/reset] profile lookup failed:', lookupError.message);
      throw httpError(502, 'Unable to reset your PIN. Please try again.');
    }
    // Same generic failure for unknown emails as for a wrong code.
    if (!profile) throw httpError(400, 'Invalid or expired reset code.');

    const { data: authData, error: userError } = await supabase.service.auth.admin.getUserById(profile.id);
    if (userError || !authData?.user) {
      // eslint-disable-next-line no-console
      console.error('[auth/pin/reset] auth user lookup failed:', userError?.message ?? 'no user');
      throw httpError(502, 'Unable to reset your PIN. Please try again.');
    }
    const meta = authData.user.app_metadata ?? {};
    const storedHash = meta.pin_reset_code_hash;
    const expiresAt = meta.pin_reset_expires_at;
    const attempts = Number(meta.pin_reset_attempts ?? 0);
    const isUsable =
      (typeof storedHash === 'string' && storedHash.length > 0) &&
      typeof expiresAt === 'string' &&
      new Date(expiresAt).getTime() > Date.now() &&
      attempts < RESET_MAX_ATTEMPTS &&
      verifyResetCode(token, profile.id, expiresAt, storedHash);

    if (!isUsable) {
      // Burn one attempt server-side; keep the error byte-identical for a
      // missing account, wrong code, expired code, or locked code.
      try {
        await supabase.service.auth.admin.updateUserById(profile.id, {
          app_metadata: {
            pin_reset_code_hash: storedHash ?? null,
            pin_reset_expires_at: expiresAt ?? null,
            pin_reset_attempts: attempts + 1,
          },
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[auth/pin/reset] attempts increment failed:', e && e.message ? e.message : e);
      }
      throw httpError(400, 'Invalid or expired reset code.');
    }

    const { error: upError } = await supabase.service
      .from('profiles')
      .update({ pin_hash: hashPin(pin), pin_failed_attempts: 0, pin_locked_until: null })
      .eq('id', profile.id);
    if (upError) {
      // eslint-disable-next-line no-console
      console.error('[auth/pin/reset] profile update failed:', upError.message);
      throw httpError(502, 'Unable to reset your PIN. Please try again.');
    }

    // Void the reset code (spec §6 step 8 — "invalidate reset state").
    const { error: clearError } = await supabase.service.auth.admin.updateUserById(profile.id, {
      app_metadata: { pin_reset_code_hash: null, pin_reset_expires_at: null, pin_reset_attempts: 0 },
    });
    if (clearError) {
      // eslint-disable-next-line no-console
      console.error('[auth/pin/reset] clear reset state failed:', clearError.message);
    }

    // Spec §6.8 also mentions prior auth state: we hold no user JWT, so
    // token-level revocation is impossible — the reset code is voided and the
    // browser cookies are cleared; the short session TTL caps any residue.
    clearSessionCookies(res, env);

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'customer.pin.reset',
      resourceType: 'profile',
      resourceId: profile.id,
      ip: req.ip ?? null,
      metadata: { email },
    });
    return ok(res, { success: true, message: 'PIN updated. Please sign in with your new PIN.' });
  });

  return router;
}