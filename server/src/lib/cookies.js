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
  const isHttps = env.NODE_ENV === 'production' || env.BACKEND_URL.startsWith('https://');
  let sameSite = 'lax';
  if (env.COOKIE_SAME_SITE) {
    sameSite = env.COOKIE_SAME_SITE;
  } else if (isHttps && env.APP_URL && env.BACKEND_URL) {
    try {
      const appOrigin = new URL(env.APP_URL).origin;
      const backendOrigin = new URL(env.BACKEND_URL).origin;
      if (appOrigin !== backendOrigin) {
        sameSite = 'none';
      }
    } catch {
      // keep lax default
    }
  }

  const secure = isHttps || sameSite === 'none';

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
  };
}

export function setSessionCookies(res, session, env) {
  if (!session || !session.access_token) return;
  const base = cookieBaseOptions(env);

  // Short-lived access token cookie (e.g. 60 minutes)
  const accessOpts = {
    ...base,
    signed: true,
    maxAge: (env.SESSION_TTL_MINUTES || 60) * 60_000,
  };
  res.cookie(ACCESS_COOKIE, session.access_token, accessOpts);

  // Long-lived refresh token cookie (e.g. 30 days) so users stay logged in across sessions
  if (session.refresh_token) {
    const refreshDays = env.REFRESH_TTL_DAYS || 30;
    const refreshOpts = {
      ...base,
      signed: true,
      maxAge: refreshDays * 24 * 60 * 60_000,
    };
    res.cookie(REFRESH_COOKIE, session.refresh_token, refreshOpts);
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
  if (!accessToken && !refreshToken) {
    throw httpError(401, 'Not signed in.');
  }
  return { accessToken: accessToken || null, refreshToken: refreshToken || null };
}

/** No session present? 401 (the frontend maps 401/403 to "signed out"). */
export function requireSignedCookies(req) {
  const accessToken = req.signedCookies?.[ACCESS_COOKIE];
  const refreshToken = req.signedCookies?.[REFRESH_COOKIE];
  if (!accessToken && !refreshToken) throw httpError(401, 'Not signed in.');
}