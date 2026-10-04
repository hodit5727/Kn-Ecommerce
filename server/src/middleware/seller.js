/**
 * SELLER AUTHORIZATION — the single, authoritative server-side decision.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The seller predicate used to be copy-pasted into SEVEN route files
 * (`seller.js`, `sellerProducts.js`, `orders.js`, `refunds.js`,
 * `transactions.js`, `announcements.js`, `uploads.js`). They had already drifted:
 * `orders.js` was missing a branch the other six had. Seven copies of a security
 * check is seven chances to ship an inconsistency, so there is now exactly one
 * implementation and every seller route imports it.
 *
 * THE RULE (this is the whole point)
 * ----------------------------------
 * Access requires BOTH of these, from the DATABASE, re-checked on every request:
 *
 *     1. the account carries the SELLER role, and
 *     2. seller_profiles.verification_status = 'APPROVED'
 *
 * The old predicate was an OR of three conditions, which meant a profile holding
 * the SELLER role passed the gate even when its verification was REJECTED, or
 * even when it had no `seller_profiles` row at all. An OR is the wrong shape for
 * an authorisation decision: it grants on the weakest signal.
 *
 * SERVER-AUTHORITATIVE BY CONSTRUCTION (AGENTS.md §2 rules 1-4, 11)
 * -------------------------------------------------------------------
 * The inputs are `req.auth.profile`, which `requireAuth` built by reading
 * `profiles` + `seller_profiles` from PostgreSQL on THIS request. Nothing here
 * reads a request body, a query parameter, a header, a cookie the client can
 * forge, or any client storage. A user cannot become a seller by editing
 * localStorage, a URL, or a request — only by an admin decision in the database.
 *
 * The seller dashboard is gated by exactly this middleware, so "the frontend
 * shows the button" and "the backend allows the data" cannot disagree: if the
 * button is wrong, the API still refuses.
 */
import { httpError } from '../lib/errors.js';

/** The only role that may use seller APIs. */
export const SELLER_ROLE = 'SELLER';

/** The only seller verification status that unlocks seller APIs. */
export const SELLER_APPROVED = 'APPROVED';

/**
 * Is this profile an ACTIVE seller whose verification is APPROVED?
 *
 * Pure and total, so it is directly testable. `profile` is the shape produced by
 * `loadProfileRow` (server/src/lib/profile.js): it always carries `role`,
 * `roles[]` and `seller_status` (the latter is null when there is no
 * `seller_profiles` row).
 */
export function isApprovedSeller(profile) {
  if (!profile) return false;
  // (2) The database decision. Checked FIRST and required: it is the authority.
  // A missing seller_profiles row yields null, which is not 'APPROVED', so an
  // account with the role but no verification is correctly refused.
  if (String(profile.seller_status ?? '') !== SELLER_APPROVED) return false;
  // (1) The role. An approved seller normally KEEPS 'CUSTOMER' as their primary
  // role and GAINS 'SELLER' in roles[], so both are accepted here.
  if (String(profile.role ?? '') === SELLER_ROLE) return true;
  return Array.isArray(profile.roles) && profile.roles.includes(SELLER_ROLE);
}

/**
 * Why access was refused. Returned (not just thrown) so the admin/UI can tell a
 * "not a seller yet" case apart from a "rejected" one without leaking anything
 * sensitive — the strings are fixed, not derived from user data.
 */
export function sellerDenialReason(profile) {
  if (!profile) return 'not_signed_in';
  if (String(profile.seller_status ?? '') === 'REJECTED') return 'verification_rejected';
  if (String(profile.seller_status ?? '') === 'PENDING') return 'verification_pending';
  if (!isApprovedSeller(profile)) return 'not_a_seller';
  return null;
}

/**
 * Guard for seller APIs. Fails CLOSED with a generic 403.
 *
 * The message is intentionally identical for every refusal: telling a caller
 * "your verification was rejected" vs "you are not a seller" is an oracle for
 * probing other people's verification state. The specific reason is available to
 * the caller's OWN account through `GET /profiles/me`, which is authenticated and
 * scoped to the caller.
 */
export function requireApprovedSeller(supabase, env) {
  return async (req, _res, next) => {
    try {
      // requireAuth must run first: it is what populates req.auth from the DB.
      if (!req.auth || !req.auth.profile) throw httpError(401, 'Not signed in.');
      if (!isApprovedSeller(req.auth.profile)) {
        throw httpError(403, 'You do not have access to seller features.');
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Throwing form, for the routes that call the check inline rather than through
 * the middleware array (they mount under a different prefix or need extra
 * per-route conditions).
 */
export function assertApprovedSeller(profile) {
  if (!isApprovedSeller(profile)) {
    throw httpError(403, 'You do not have access to seller features.');
  }
}
