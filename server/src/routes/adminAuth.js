/**
 * Admin authentication (BACKEND_SPEC §4).
 *
 * Contract: POST /admin/auth/login { email, password } → { user }.
 * - Password verified REAL against Supabase Auth (signInWithPassword).
 * - ADMIN role verified from the DB profile server-side (403 otherwise) —
 *   never from any client flag (§2.4).
 * - Session = same HttpOnly cookie as customers; suspended admin → 403.
 * - Rate limited (8 / 15 min per account+IP).
 */
import { Router } from 'express';
import { httpError, ok } from '../lib/errors.js';
import { isValidEmail } from '../lib/validate.js';
import { setSessionCookies } from '../lib/cookies.js';
import { loadProfileRow } from '../lib/profile.js';
import { profileToUser } from '../lib/shape.js';
import { writeAudit } from '../lib/audit.js';
import { adminLoginLimiter } from '../middleware/security.js';

export function createAdminRouter({ env, supabase }) {
  const router = Router();

  router.post('/admin/auth/login', adminLoginLimiter(), async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!isValidEmail(email) || !password) {
      throw httpError(400, 'Email and password are required.');
    }

    // REAL credential verification against Supabase Auth.
    const { data, error: signInError } = await supabase.anon.auth.signInWithPassword({ email, password });
    if (signInError || !data?.user || !data?.session) {
      // eslint-disable-next-line no-console
      console.error('[admin/login] sign-in failed:', signInError?.message ?? 'no session');
      // Identical message for unknown email / wrong password / no password
      // set — no account enumeration (§5-14).
      throw httpError(401, 'Invalid email or password.');
    }

    const user = data.user;
    const row = await loadProfileRow(supabase.service, user.id);

    // Admin role gate — from the DATABASE, never the client.
    if (!row || row.role !== 'ADMIN') {
      // Never leave a live session behind for a non-admin.
      try {
        await supabase.anon.auth.signOut({ scope: 'global' });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[admin/login] session cleanup failed:', e?.message ?? e);
      }
      throw httpError(403, 'Admin access denied.');
    }
    if (row.status === 'SUSPENDED') {
      throw httpError(403, 'Account suspended. Please contact support.');
    }
    if (row.status === 'DEACTIVATED') {
      throw httpError(403, 'Account deactivated.');
    }

    setSessionCookies(res, data.session, env);
    await writeAudit(supabase, {
      actorId: row.id,
      actorRole: 'ADMIN',
      action: 'admin.login',
      resourceType: 'profile',
      resourceId: row.id,
      ip: req.ip ?? null,
      metadata: { email },
    });
    return ok(res, { user: profileToUser(row) });
  });

  // ── POST /delivery/auth/login ──────────────────────────────────────────
  router.post('/delivery/auth/login', adminLoginLimiter(), async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!isValidEmail(email) || !password) {
      throw httpError(400, 'Email and password are required.');
    }

    // Authenticate with Supabase Auth
    const { data, error: signInError } = await supabase.anon.auth.signInWithPassword({ email, password });
    if (signInError || !data?.user || !data?.session) {
      throw httpError(401, 'Invalid email or password.');
    }

    const user = data.user;
    const row = await loadProfileRow(supabase.service, user.id);

    // Verify operator role
    const isDeliveryStaff =
      row &&
      (row.role === 'ADMIN' ||
        row.role === 'DELIVERY_PERSON' ||
        (Array.isArray(row.roles) &&
          (row.roles.includes('DELIVERY_PERSON') ||
            row.roles.includes('ADMIN') ||
            row.roles.includes('SUPER_ADMIN'))));

    if (!isDeliveryStaff) {
      try {
        await supabase.anon.auth.signOut({ scope: 'global' });
      } catch (e) {
        // ignore
      }
      throw httpError(403, 'Delivery operator access denied.');
    }

    if (row.status === 'SUSPENDED') {
      throw httpError(403, 'Account suspended. Please contact support.');
    }
    if (row.status === 'DEACTIVATED') {
      throw httpError(403, 'Account deactivated.');
    }

    setSessionCookies(res, data.session, env);
    await writeAudit(supabase, {
      actorId: row.id,
      actorRole: 'DELIVERY_PERSON',
      action: 'delivery.login',
      resourceType: 'profile',
      resourceId: row.id,
      ip: req.ip ?? null,
      metadata: { email },
    });
    return ok(res, { user: profileToUser(row) });
  });

  return router;
}