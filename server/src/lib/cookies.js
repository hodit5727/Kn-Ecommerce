/**
 * HttpOnly session cookies (AGENTS.md §2: identity never lives in
 * localStorage — it travels in signed, HttpOnly, SameSite=Lax cookies).
 *
 * The cookie values are the SUPABASE session tokens (access + refresh),
 * signed by cookie-parser with SESSION_SECRET. The browser never sees them;
 * every request re-validates them against Supabase Auth server-side.
 */
import { httpError } from './errors.js';

export const ACCESS_COOKIE = 'ks_access';
export const REFRESH_COOKIE = 'ks_refresh';

export function cookieBaseOptions(env) {
  return {
    httpOnly: true,
    // Secure in production (https) — the browser must never send these over
    // plain http. Local development on http://localhost keeps them readable.
    secure: env.NODE_ENV === 'production' || env.BACKEND_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
  };
}

export function setSessionCookies(res, session, env) {
  if (!session || !session.access_token) return;
  const opts = {
    ...cookieBaseOptions(env),
    signed: true,
    maxAge: env.SESSION_TTL_MINUTES * 60_000,
  };
  res.cookie(ACCESS_COOKIE, session.access_token, opts);
  if (session.refresh_token) {
    res.cookie(REFRESH_COOKIE, session.refresh_token, opts);
  }
}

export function clearSessionCookies(res, env) {
  const opts = { ...cookieBaseOptions(env), signed: true };
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
}

/** Extract (verified-signature) session tokens from the signed cookies. */
export function getSessionTokens(req) {
  const accessToken = req.signedCookies?.[ACCESS_COOKIE];
  const refreshToken = req.signedCookies?.[REFRESH_COOKIE];
  if (!accessToken) {
    throw httpError(401, 'Not signed in.');
  }
  return { accessToken, refreshToken: refreshToken || null };
}

/** No session present? 401 (the frontend maps 401/403 to "signed out"). */
export function requireSignedCookies(req) {
  const accessToken = req.signedCookies?.[ACCESS_COOKIE];
  if (!accessToken) throw httpError(401, 'Not signed in.');
}