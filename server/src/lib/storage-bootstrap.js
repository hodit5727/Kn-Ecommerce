/**
 * Startup self-healing + diagnostics for Supabase Storage buckets and the
 * seller-verification tables (server entrypoint only — never part of the
 * dependency-injected app factory, so tests never touch real storage).
 *
 * WHY IT EXISTS
 * A missing storage bucket or a missing verification table currently
 * surfaces to the client as an honest generic 502 (AGENTS.md §2.7/§5-80 —
 * never leak schema internals into responses). That is correct behaviour,
 * but it makes the two most common SETUP gaps look like an application bug:
 *   * `seller_verifications` / `verification_sessions` not created (the
 *     0006 migration was never run in the dashboard), and
 *   * the `seller-verification-docs` (or `seller-documents`, `product-images`)
 *     Storage bucket not created.
 *
 * These helpers close that gap at the only place that can: the backend boot.
 *   - ensureStorageBuckets  — idempotently creates the buckets the backend
 *     writes to (public only where the catalogue needs it). Once this has
 *     run successfully, a 502 can no longer come from "bucket not found".
 *   - probeVerificationTables — if the 0006 tables are missing, prints a
 *     loud, actionable pointer to `supabase/migrations/0006_seller_verification.sql`
 *     (or `supabase/apply-production.sql`) in the SERVER LOG ONLY. Clients
 *     still get the safe generic 502 — nothing internal leaks.
 *
 * Neither function ever throws: a transient Storage/Supabase hiccup at boot
 * must not take the API down. Failures are logged loudly instead.
 */
import {
  PRODUCT_IMAGES_BUCKET,
  SELLER_DOCUMENTS_BUCKET,
  VERIFICATION_DOCS_BUCKET,
} from './uploads.js';

/**
 * Idempotently create the Storage buckets the backend writes to.
 * Honors env overrides (STORAGE_BUCKET_*) exactly like uploads.js.
 * @param {object} service — Supabase service-role client.
 * @param {object} env     — validated environment.
 * @returns {Promise<string[]>} human-readable per-bucket outcomes (for logs).
 */
export async function ensureStorageBuckets(service, env) {
  const buckets = [
    { id: env.STORAGE_BUCKET_PRODUCT_IMAGES || PRODUCT_IMAGES_BUCKET, isPublic: true },
    { id: env.STORAGE_BUCKET_SELLER_DOCUMENTS || SELLER_DOCUMENTS_BUCKET, isPublic: false },
    { id: env.STORAGE_BUCKET_VERIFICATION_DOCS || VERIFICATION_DOCS_BUCKET, isPublic: false },
  ];
  const outcomes = [];
  for (const { id, isPublic } of buckets) {
    try {
      const { data: existing, error: getError } = await service.storage.getBucket(id);
      if (!getError && existing?.id) {
        outcomes.push(`${id}: already exists`);
        continue;
      }
      const { error: createError } = await service.storage.createBucket(id, {
        public: isPublic,
      });
      if (createError) {
        outcomes.push(`${id}: FAILED to create (${createError.message})`);
      } else {
        outcomes.push(`${id}: created (${isPublic ? 'public' : 'private'})`);
      }
    } catch (err) {
      outcomes.push(`${id}: check error (${err && err.message ? err.message : err})`);
    }
  }
  for (const o of outcomes) {
    // eslint-disable-next-line no-console
    console.log(`[storage-bootstrap] bucket ${o}`);
  }
  return outcomes;
}

/**
 * Probe the 0006 verification tables and warn loudly when they are missing.
 * Boot continues either way — routes surface their generic errors per-request.
 * @param {object} service — Supabase service-role client.
 * @returns {Promise<boolean>} true when both tables responded.
 */
export async function probeVerificationTables(service) {
  const tables = ['seller_verifications', 'verification_sessions'];
  let missing = null;
  try {
    for (const table of tables) {
      const { error } = await service.from(table).select('id').limit(1);
      if (error) {
        missing = error;
        break;
      }
    }
  } catch (err) {
    missing = err;
  }
  if (missing) {
    const msg = missing && missing.message ? missing.message : String(missing);
    const isMissingRelation = /does not exist|relation/i.test(msg);
    // eslint-disable-next-line no-console
    console.error(
      `[storage-bootstrap] verification tables NOT available (${msg}).` +
        (isMissingRelation
          ? '\n[storage-bootstrap] FIX: open Supabase Dashboard → SQL Editor and run the ENTIRE ' +
            'contents of supabase/migrations/0006_seller_verification.sql ' +
            '(idempotent — safe to re-run), or re-run supabase/apply-production.sql. Then restart the API.' +
            '\n[storage-bootstrap] Until then, /seller/verification/* returns an honest 502 to clients.'
          : ''),
    );
    return false;
  }
  // eslint-disable-next-line no-console
  console.log('[storage-bootstrap] verification tables present.');
  return true;
}