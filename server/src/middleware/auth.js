/**
 * Authentication + authorization middleware.
 *
 * Identity comes ONLY from the Supabase session re-validated server-side on
 * every request (AGENTS.md §2.1–2.3). Roles are read from the DB profile —
 * never from the client, never from localStorage.
 */
import { httpError } from '../lib/errors.js';
import { getSessionTokens, setSessionCookies } from '../lib/cookies.js';
import { loadProfileRow } from '../lib/profile.js';

/**
 * Resolve the session: validate the access token against Supabase Auth;
 * if it expired, attempt a refresh; if that fails too → 401 (signed out).
 * @returns {{ user: object, session: object, refreshed: boolean }}
 */
export async function resolveSession(supabase, tokens) {
  const { data: accessData, error: accessError } = await supabase.anon.auth.getUser(tokens.accessToken);
  if (!accessError && accessData && accessData.user) {
    return { user: accessData.user, session: { access_token: tokens.accessToken, refresh_token: tokens.refreshToken }, refreshed: false };
  }

  // Access token expired/invalid → try the refresh token (server-side refresh).
  if (tokens.refreshToken) {
    const { data: refreshData, error: refreshError } = await supabase.anon.auth.refreshSession({
      refresh_token: tokens.refreshToken,
    });
    if (!refreshError && refreshData && refreshData.session && refreshData.session.access_token) {
      const session = refreshData.session;
      const user = (refreshData.user || session.user);
      if (!user) throw httpError(401, 'Not signed in.');
      return { user, session, refreshed: true };
    }
  }
  throw httpError(401, 'Not signed in.');
}

/** Require a valid authenticated session; attaches req.auth = { user, profile } . */
export function requireAuth(supabase, env) {
  return async (req, _res, next) => {
    try {
      const tokens = getSessionTokens(req);
      const { user, session, refreshed } = await resolveSession(supabase, tokens);

      const profile = await loadProfileRow(supabase.service, user.id);
      if (!profile) {
        // Auth user exists but profile row is missing — sessions must not
        // wander; refuse access (stub is created at OTP-verify time).
        throw httpError(401, 'Not signed in.');
      }
      if (profile.status === 'SUSPENDED') {
        throw httpError(403, 'Account suspended. Please contact support.');
      }
      if (profile.status === 'DEACTIVATED') {
        throw httpError(403, 'Account deactivated.');
      }

      req.auth = { user, profile };
      if (refreshed) {
        // Rotation happened — hand the new tokens to the browser.
        setSessionCookies(_res, session, env);
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Role gate (server-side). Usage: requireRole(supabase, env, 'ADMIN'). */
export function requireRole(supabase, env, ...roles) {
  return async (req, _res, next) => {
    try {
      if (!req.auth || !req.auth.profile) throw httpError(401, 'Not signed in.');
      const { role } = req.auth.profile;
      if (!roles.includes(role)) {
        throw httpError(403, 'Forbidden.');
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export { requireAuth as authenticated, requireRole as authorized };