/**
 * Seller identity + face verification — ADMIN review endpoints (spec §12).
 *
 *   GET  /admin/seller-verifications                    — list (latest cycle
 *                                                          per user + email)
 *   POST /admin/seller-verifications/:id/approve        — MANUAL_REVIEW → VERIFIED
 *   POST /admin/seller-verifications/:id/reject         — MANUAL_REVIEW → REJECTED
 *   POST /admin/seller-verifications/:id/request-reverification
 *                                                       — REJECTED/MANUAL_REVIEW
 *                                                         → REVERIFICATION_REQUIRED
 *
 * Rules:
 *   - Every route requires a server-verified ADMIN role (requireRole, §6).
 *   - Approve is only possible when a REAL face-match score exists (the DB
 *     CHECK on VERIFIED demands verification_score + match_status='PASSED' —
 *     an administrator cannot fabricate a verification without evidence).
 *   - Every decision is audit-logged with the reviewer id (§22/§36).
 *   - Re-verification revokes any ACTIVE sessions (frame cache is purged too —
 *     no raw biometrics outlive a revoked attempt, spec §11/§17).
 */
import { Router } from 'express';
import { httpError, ok } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { grantSellerAccess } from '../lib/sellerAccess.js';
import { adminVerificationLimiter } from '../middleware/security.js';
import { writeAudit } from '../lib/audit.js';
import { verificationById, walkTransition, revokeActiveSessions } from '../lib/verification/db.js';
import { VERIFICATION_EVENTS } from '../lib/verification/constants.js';
import { createFrameCache } from '../lib/verification/frames.js';
import { createSignedUrl, VERIFICATION_DOCS_BUCKET } from '../lib/uploads.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowIso = () => new Date().toISOString();
/** Signed-URL lifetime for the reviewer to open the private ID document. */
const DOC_URL_TTL_SECONDS = 15 * 60;

export function createAdminVerificationRouter({ env, supabase, frameCache }) {
  const router = Router();
  const frames = frameCache ?? createFrameCache();
  const adminGate = [requireAuth(supabase, env), requireRole(supabase, env, 'ADMIN')];
  const verificationBucket = env.STORAGE_BUCKET_VERIFICATION_DOCS || VERIFICATION_DOCS_BUCKET;

  // ── GET /admin/seller-verifications ─────────────────────────────────────
  router.get('/admin/seller-verifications', ...adminGate, async (req, res) => {
    const { data, error } = await supabase.service.from('seller_verifications').select('*');
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[admin-verification] list failed:', error.message);
      throw httpError(502, 'Unable to load verifications.');
    }
    const rows = (data ?? []).slice().sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));

    // Include the applicant email, profile, and seller store info for the reviewer (service-side join).
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const emailByUser = new Map();
    const profileByUser = new Map();
    const sellerByUser = new Map();
    if (userIds.length > 0) {
      const [{ data: profiles }, { data: sellers }] = await Promise.all([
        supabase.service.from('profiles').select('*').in('id', userIds),
        supabase.service.from('seller_profiles').select('*').in('profile_id', userIds),
      ]);
      for (const p of profiles ?? []) {
        emailByUser.set(p.id, p.email ?? null);
        profileByUser.set(p.id, p);
      }
      for (const s of sellers ?? []) {
        sellerByUser.set(s.profile_id, s);
      }
    }

    // Best-effort short-lived signed URL for the private ID document so the
    // reviewer can open it. A failed URL must not fail the whole list — the
    // row still shows with documentUrl: null and the reviewer can fetch it
    // via GET /admin/seller-verifications/:id/document.
    const withDocUrl = await Promise.all(
      rows.map(async (r) => {
        let documentUrl = null;
        if (r.document_storage_path) {
          try {
            const { data: urlData, error: urlError } = await supabase.service.storage
              .from(verificationBucket)
              .createSignedUrl(r.document_storage_path, DOC_URL_TTL_SECONDS);
            if (!urlError && urlData?.signedUrl) documentUrl = urlData.signedUrl;
            // eslint-disable-next-line no-console
            else console.error('[admin-verification] document URL failed:', urlError?.message ?? 'no signed URL');
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[admin-verification] document URL error:', err && err.message ? err.message : err);
          }
        }
        return { r, documentUrl };
      }),
    );

    return ok(res, {
      verifications: withDocUrl.map(({ r, documentUrl }) => ({
        id: r.id,
        userId: r.user_id,
        email: emailByUser.get(r.user_id) ?? null,
        sellerName: sellerByUser.get(r.user_id)?.seller_name ?? profileByUser.get(r.user_id)?.full_name ?? null,
        storeName: sellerByUser.get(r.user_id)?.store_name ?? null,
        sellerId: profileByUser.get(r.user_id)?.business_id ?? null,
        cycle: r.cycle,
        state: r.verification_status,
        documentStatus: r.document_status,
        livenessStatus: r.liveness_status,
        matchStatus: r.match_status,
        reviewStatus: r.review_status,
        rejectionReason: r.rejection_reason ?? null,
        provider: r.face_verification_provider,
        attemptCount: r.attempt_count,
        createdAt: r.created_at ? String(r.created_at) : null,
        submittedAt: r.submitted_at ? String(r.submitted_at) : null,
        reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
        documentUrl,
      })),
    });
  });

  // ── GET /admin/seller-verifications/:id/document ────────────────────────
  // Fresh short-lived signed URL for the applicant's submitted ID document —
  // lets the reviewer inspect the uploaded identity document (never a public
  // URL; the object lives in the PRIVATE seller-verification-docs bucket).
  router.get(
    '/admin/seller-verifications/:id/document',
    ...adminGate,
    adminVerificationLimiter(),
    async (req, res) => {
      const id = String(req.params.id ?? '').trim();
      if (!UUID_RE.test(id)) throw httpError(404, 'Verification not found.');
      const row = await verificationById(supabase, id);
      if (!row.document_storage_path) {
        throw httpError(404, 'No document was submitted for this verification.');
      }
      const documentUrl = await createSignedUrl(supabase.service, {
        bucket: verificationBucket,
        path: row.document_storage_path,
        expiresIn: DOC_URL_TTL_SECONDS,
      });
      return ok(res, { documentUrl });
    },
  );

  // ── POST /admin/seller-verifications/:id/approve ────────────────────────
  router.post(
    '/admin/seller-verifications/:id/approve',
    ...adminGate,
    adminVerificationLimiter(),
    async (req, res) => {
      const id = String(req.params.id ?? '').trim();
      if (!UUID_RE.test(id)) throw httpError(404, 'Verification not found.');
      const row = await verificationById(supabase, id);
      if (row.verification_status === 'VERIFIED') {
        throw httpError(409, 'This verification is already approved.');
      }
      if (row.verification_status !== 'MANUAL_REVIEW') {
        throw httpError(409, 'Only verifications in manual review can be approved.');
      }
      if (row.verification_score == null) {
        // The DB CHECK forbids VERIFIED without a real score — an admin must
        // not approve an applicant who was never face-matched (spec §12/§19).
        throw httpError(409, 'This verification has no face-match score and cannot be approved.');
      }
      await walkTransition(supabase, row, 'VERIFIED', {
        match_status: 'PASSED',
        review_status: 'COMPLETED',
        reviewed_by: req.auth.profile.id,
        reviewed_at: nowIso(),
      });
      // Approving the live check must ALSO make the seller usable. The seller
      // guard (middleware/seller.js) requires BOTH the SELLER role and an
      // APPROVED seller_profiles.verification_status, and this route previously
      // wrote only to `seller_verifications` — so the admin saw "approved" while
      // the account still received 403 from every seller API and the
      // "OPEN SELLER DASHBOARD" button led nowhere. One shared write path fixes
      // both columns together, and throws rather than half-succeeding.
      const grantResult = await grantSellerAccess(supabase, row.user_id, env);
      await writeAudit(supabase, {
        actorId: req.auth.profile.id, actorRole: 'ADMIN',
        action: VERIFICATION_EVENTS.SELLER_APPROVED,
        resourceType: 'seller_verification', resourceId: row.id, ip: req.ip,
        metadata: { cycle: row.cycle, score: row.verification_score, sellerId: grantResult?.sellerId },
      });
      return ok(res, { id: row.id, state: 'VERIFIED', sellerId: grantResult?.sellerId ?? null });
    },
  );

  // ── POST /admin/seller-verifications/:id/reject ─────────────────────────
  router.post(
    '/admin/seller-verifications/:id/reject',
    ...adminGate,
    adminVerificationLimiter(),
    async (req, res) => {
      const id = String(req.params.id ?? '').trim();
      if (!UUID_RE.test(id)) throw httpError(404, 'Verification not found.');
      const reason = String(req.body?.reason ?? '').trim();
      if (reason.length < 3 || reason.length > 500) {
        throw httpError(400, 'A rejection reason (3–500 characters) is required.');
      }
      const row = await verificationById(supabase, id);
      if (row.verification_status === 'REJECTED') {
        throw httpError(409, 'This verification is already rejected.');
      }
      if (row.verification_status !== 'MANUAL_REVIEW') {
        throw httpError(409, 'Only verifications in manual review can be rejected.');
      }
      await walkTransition(supabase, row, 'REJECTED', {
        rejection_reason: reason,
        review_status: 'COMPLETED',
        reviewed_by: req.auth.profile.id,
        reviewed_at: nowIso(),
      });
      await writeAudit(supabase, {
        actorId: req.auth.profile.id, actorRole: 'ADMIN',
        action: VERIFICATION_EVENTS.SELLER_REJECTED,
        resourceType: 'seller_verification', resourceId: row.id, ip: req.ip,
        result: 'FAILED',
        metadata: { cycle: row.cycle },
      });
      return ok(res, { id: row.id, state: 'REJECTED' });
    },
  );

  // ── POST /admin/seller-verifications/:id/request-reverification ─────────
  router.post(
    '/admin/seller-verifications/:id/request-reverification',
    ...adminGate,
    adminVerificationLimiter(),
    async (req, res) => {
      const id = String(req.params.id ?? '').trim();
      if (!UUID_RE.test(id)) throw httpError(404, 'Verification not found.');
      const reason = String(req.body?.reason ?? '').trim();
      if (reason.length < 3 || reason.length > 500) {
        throw httpError(400, 'A re-verification note (3–500 characters) is required.');
      }
      const row = await verificationById(supabase, id);
      if (!['REJECTED', 'MANUAL_REVIEW'].includes(row.verification_status)) {
        throw httpError(409, 'Only rejected or review-pending verifications can be re-opened.');
      }
      await walkTransition(supabase, row, 'REVERIFICATION_REQUIRED', {
        rejection_reason: reason,
        review_status: 'COMPLETED',
        reviewed_by: req.auth.profile.id,
        reviewed_at: nowIso(),
      });
      // Purge any live capture state — no raw frames outlive a revoked attempt.
      const revokedSessions = await revokeActiveSessions(supabase, row.id);
      for (const sid of revokedSessions ?? []) frames.discard(sid);
      await writeAudit(supabase, {
        actorId: req.auth.profile.id, actorRole: 'ADMIN',
        action: VERIFICATION_EVENTS.REVERIFICATION_REQUESTED,
        resourceType: 'seller_verification', resourceId: row.id, ip: req.ip,
        metadata: { cycle: row.cycle, revokedSessions: revokedSessions?.length ?? 0 },
      });
      return ok(res, { id: row.id, state: 'REVERIFICATION_REQUIRED' });
    },
  );

  return router;
}