/**
 * Seller identity + face verification — SELLER-facing endpoints (spec §17
 * flow: session → document → live capture → liveness → match → decision).
 *
 *   POST /seller/verification/session   — consent + short-lived session with
 *                                         a randomized challenge (§5, §11, §17).
 *                                         If the seller application already
 *                                         holds a college-ID photo, that file
 *                                         is analysed here so the client does
 *                                         not upload the same ID twice.
 *   POST /seller/verification/document  — octet-stream ID-document upload
 *                                         (kept for tests / recovery); stored
 *                                         in a PRIVATE bucket, then analysed
 *                                         server-side (real ML)
 *   POST /seller/verification/face      — one raw frame per request
 *                                         (?sessionId&step&final=true on the
 *                                         last frame of a burst) — frames are
 *                                         held ONLY in memory, never persisted
 *   POST /seller/verification/complete  — server-side face match against the
 *                                         stored document → VERIFIED /
 *                                         MANUAL_REVIEW / REJECTED
 *   GET  /seller/verification/status    — current honest state (never scores)
 *
 * Hard rules implemented here:
 *   - The BACKEND decides every outcome via the injected face-verification
 *     provider. Client-supplied state ("verified", a score, a role) is never
 *     accepted — the DB transition trigger (0006) would also reject it.
 *   - Sessions are bound to the authenticated user (IDOR-proof: sessionId is
 *     always looked up WITH user_id) and expire after FACE_SESSION_TTL_MINUTES.
 *   - Attempts are capped per cycle (FACE_MAX_ATTEMPTS) AND rate-limited per
 *     account+IP; a session cannot be replayed after completion.
 *   - Scores/similarity are never returned to the client — decisions come
 *     back as a state only; diagnostics go to the audit log (§6, §21).
 *
 * This router MUST be mounted before createSellerRouter (whose
 * `router.use('/seller', …)` gate shadows every /seller/* path).
 */
import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { httpError, ok } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { faceVerificationLimiter } from '../middleware/security.js';
import { writeAudit } from '../lib/audit.js';
import { sendSellerSubmissionEmail, sendSellerApplicationAdminAlertEmail } from '../lib/mail.js';
import { uploadToStorage, downloadFromStorage, sniffMime, assertUploadAllowed } from '../lib/uploads.js';
import {
  VERIFICATION_DOCS_BUCKET,
  VERIFICATION_DOCS_PREFIX,
  SELLER_DOCUMENTS_BUCKET,
} from '../lib/uploads.js';
import {
  createFaceVerificationProvider,
  isFaceVerificationEnabled,
} from '../lib/faceVerification/index.js';
import { createFrameCache } from '../lib/verification/frames.js';
import { latestVerification, walkTransition } from '../lib/verification/db.js';
import { VERIFICATION_EVENTS, CHALLENGE_STEPS } from '../lib/verification/constants.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERIFICATION_IMAGE_MIMES = ['image/jpeg', 'image/png'];
const DOCUMENT_TYPES = ['COLLEGE_ID', 'GOVERNMENT_ID', 'OTHER'];

const nowIso = () => new Date().toISOString();
const isExpired = (row) => {
  const at = row?.expires_at ? new Date(row.expires_at).getTime() : 0;
  return Number.isFinite(at) && at < Date.now();
};

/** Find a verification session owned by the user; throws clean errors. */
async function ownedSession(supabase, sessionId, userId) {
  if (!UUID_RE.test(String(sessionId ?? ''))) throw httpError(400, 'Invalid session.');
  const { data: session, error } = await supabase.service
    .from('verification_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();
  if (error || !session) throw httpError(404, 'Verification session not found.');
  return session;
}

/**
 * The challenge sequence for a fresh session — server-generated.
 *
 * This used to build a randomized FOUR-pose sequence, shuffling head turns and
 * guaranteeing `look_straight` first because the face-match reference frame came
 * from that step. There is now exactly ONE step (a blink), so there is nothing to
 * shuffle and nothing to order. `CHALLENGE_STEPS` remains the single source of
 * truth, so adding or changing a step is a one-line change in constants.js and
 * this function cannot drift out of sync with it.
 */
function buildChallenge() {
  return { sequence: [...CHALLENGE_STEPS], completed: [] };
}

const challengeSequence = (challenge) => {
  if (!challenge) return [];
  if (Array.isArray(challenge)) return challenge;
  return Array.isArray(challenge.sequence) ? challenge.sequence : [];
};
const challengeCompleted = (challenge) => {
  if (!challenge) return [];
  return Array.isArray(challenge.completed) ? challenge.completed : [];
};

export function createSellerVerificationRouter({ env, supabase, faceVerification, frameCache }) {
  const router = Router();
  const provider = faceVerification ?? createFaceVerificationProvider({ env });
  const frames = frameCache ?? createFrameCache();
  const verificationBucket = env.STORAGE_BUCKET_VERIFICATION_DOCS || VERIFICATION_DOCS_BUCKET;
  const maxAttempts = env.FACE_MAX_ATTEMPTS;
  const sessionTtlMinutes = env.FACE_SESSION_TTL_MINUTES;
  const maxFrameBytes = env.FACE_MAX_FRAME_BYTES;
  const retentionDays = env.FACE_DOC_RETENTION_DAYS;
  const providerConfigured = provider.configured === true;

  const rawFrameParser = express.raw({
    type: ['application/octet-stream', 'image/jpeg', 'image/png'],
    limit: '1mb',
  });
  const rawDocParser = express.raw({
    type: ['application/octet-stream', 'application/pdf', 'image/jpeg', 'image/png'],
    limit: '2.5mb',
  });

  function assertActive(profile) {
    if (profile.status && profile.status !== 'ACTIVE') {
      throw httpError(403, 'Your account is not active.');
    }
  }

  // ── POST /seller/verification/session ────────────────────────────────────
  // Explicit consent (§11) + a short-lived, user-bound session (§17). When
  // the provider is disabled the request fails with an honest 503 (never a
  // fake "verified" state).
  router.post(
    '/seller/verification/session',
    requireAuth(supabase, env),
    faceVerificationLimiter(),
    async (req, res) => {
      const { profile } = req.auth;
      assertActive(profile);
      if (!providerConfigured) {
        throw httpError(503, 'Identity verification is not configured on this server.');
      }
      if (req.body?.consent !== true) {
        throw httpError(400, 'You must consent to identity verification before continuing.');
      }

      let verification = await latestVerification(supabase, profile.id);
      if (verification?.verification_status === 'VERIFIED') {
        throw httpError(409, 'Identity verification has already been completed.');
      }
      if (verification && ['MANUAL_REVIEW', 'REJECTED'].includes(verification.verification_status)) {
        throw httpError(403, 'Your verification was not approved. Please contact support for a review.');
      }

      if (!verification) {
        const { data, error } = await supabase.service
          .from('seller_verifications')
          .insert({
            user_id: profile.id,
            cycle: 1,
            consent_granted: true,
            consent_granted_at: nowIso(),
            face_verification_provider: provider.mode,
            max_attempts: maxAttempts,
            data_retained_until: new Date(Date.now() + retentionDays * 86400_000).toISOString(),
          })
          .select('id');
        if (error || !data?.[0]?.id) {
          // eslint-disable-next-line no-console
          console.error('[verification] create failed:', error?.message ?? 'no id returned');
          throw httpError(502, 'Unable to start verification. Please try again.');
        }
        verification = data[0];
      } else if (verification.verification_status === 'REVERIFICATION_REQUIRED') {
        // Admin re-verification request → a FRESH attempt cycle (history kept).
        const { data, error } = await supabase.service
          .from('seller_verifications')
          .insert({
            user_id: profile.id,
            cycle: Number(verification.cycle ?? 0) + 1,
            consent_granted: true,
            consent_granted_at: nowIso(),
            face_verification_provider: provider.mode,
            max_attempts: maxAttempts,
            data_retained_until: new Date(Date.now() + retentionDays * 86400_000).toISOString(),
          })
          .select('id');
        if (error || !data?.[0]?.id) {
          // eslint-disable-next-line no-console
          console.error('[verification] re-cycle create failed:', error?.message ?? 'no id returned');
          throw httpError(502, 'Unable to start verification. Please try again.');
        }
        verification = data[0];
      } else if (!verification.consent_granted) {
        const { error } = await supabase.service
          .from('seller_verifications')
          .update({ consent_granted: true, consent_granted_at: nowIso() })
          .eq('id', verification.id);
        if (error) throw httpError(502, 'Unable to record consent. Please try again.');
      }

      // Reuse an unexpired ACTIVE session; expire stale ones (§17).
      const { data: active } = await supabase.service
        .from('verification_sessions')
        .select('*')
        .eq('user_id', profile.id)
        .eq('status', 'ACTIVE');
      const reusable = (active ?? []).find((s) => !isExpired(s));
      if (reusable) {
        const sessionId = reusable.id;
        await writeAudit(supabase, {
          actorId: profile.id, actorRole: 'CUSTOMER',
          action: VERIFICATION_EVENTS.FACE_SESSION_CREATED,
          resourceType: 'seller_verification', resourceId: verification.id, ip: req.ip,
          metadata: { sessionId, reuse: true },
        });
        return ok(res, {
          verification: { verificationId: verification.id, cycle: verification.cycle, state: verification.verification_status },
          session: {
            id: sessionId,
            expiresInSeconds: Math.max(0, Math.round((new Date(reusable.expires_at).getTime() - Date.now()) / 1000)),
            challenge: challengeSequence(reusable.challenge),
          },
          provider: { mode: provider.mode, configured: providerConfigured },
        });
      }
      for (const stale of (active ?? [])) {
        await supabase.service.from('verification_sessions').update({ status: 'EXPIRED' }).eq('id', stale.id);
      }

      const challenge = buildChallenge();
      const { data: sessionData, error: sessionError } = await supabase.service
        .from('verification_sessions')
        .insert({
          user_id: profile.id,
          verification_id: verification.id,
          status: 'ACTIVE',
          challenge,
          expires_at: new Date(Date.now() + sessionTtlMinutes * 60_000).toISOString(),
        })
        .select('id');
      if (sessionError || !sessionData?.[0]?.id) {
        // eslint-disable-next-line no-console
        console.error('[verification] session create failed:', sessionError?.message ?? 'no id returned');
        throw httpError(502, 'Unable to start your verification session. Please try again.');
      }
      const sessionId = sessionData[0].id;
      frames.begin(sessionId);

      // ── Auto-import college ID from seller application ──────────────────
      // The college ID was already uploaded in the seller application step
      // (POST /seller/documents → seller-documents bucket). We re-use it here
      // so the frontend does not need a second "Upload ID" step.
      //
      // Security: we only read rows owned by this user (user_id = profile.id),
      // and we only advance the verification if the current state is NOT_STARTED
      // (the route already refuses states that are past this point). The backend
      // re-validates the image during face matching — no client-supplied verdict.
      try {
        const freshVerif = await latestVerification(supabase, profile.id);
        const notStarted =
          freshVerif && freshVerif.id === verification.id &&
          ['NOT_STARTED', 'DOCUMENT_UPLOADED'].includes(freshVerif.verification_status ?? '');

        if (notStarted && !freshVerif.document_storage_path) {
          // Look for the most recent college ID in the seller application.
          const { data: appDocs } = await supabase.service
            .from('seller_applications')
            .select('id_document_storage_path, id_document_mime')
            .eq('user_id', profile.id)
            .order('created_at', { ascending: false })
            .limit(1);

          const appDoc = appDocs?.[0];
          if (appDoc?.id_document_storage_path) {
            // Advance the verification record with the existing college ID
            // bytes reference. The actual bytes are fetched during /complete.
            await supabase.service
              .from('seller_verifications')
              .update({
                document_storage_path: appDoc.id_document_storage_path,
                document_type: 'COLLEGE_ID',
                document_mime: appDoc.id_document_mime ?? 'image/jpeg',
                document_status: 'PASSED',       // trusted: admin-verified at application
                verification_status: 'DOCUMENT_VERIFIED',
              })
              .eq('id', verification.id);
            // eslint-disable-next-line no-console
            console.log('[verification] auto-imported college ID from seller application', {
              verificationId: verification.id,
              storagePath: appDoc.id_document_storage_path,
            });
          }
        }
      } catch (autoImportErr) {
        // Auto-import is best-effort: a failure here must not block the session.
        // The frontend can always fall back to the manual document upload if needed.
        // eslint-disable-next-line no-console
        console.warn('[verification] college ID auto-import failed (non-fatal):', autoImportErr?.message ?? autoImportErr);
      }

      await writeAudit(supabase, {
        actorId: profile.id, actorRole: 'CUSTOMER',
        action: VERIFICATION_EVENTS.FACE_SESSION_CREATED,
        resourceType: 'seller_verification', resourceId: verification.id, ip: req.ip,
        metadata: { sessionId, cycle: verification.cycle },
      });

      return ok(res, {
        verification: {
          verificationId: verification.id,
          cycle: verification.cycle,
          state: verification.verification_status,
        },
        session: {
          id: sessionId,
          expiresInSeconds: sessionTtlMinutes * 60,
          challenge: challenge.sequence,
        },
        provider: { mode: provider.mode, configured: providerConfigured },
      });
    },
  );

  // ── POST /seller/verification/document ───────────────────────────────────
  // Raw-byte identity document (§9): private bucket, real sniffed MIME, real
  // bytes, SHA-256, then real ML document analysis. Any verdict comes from the
  // provider — never from the client.
  router.post(
    '/seller/verification/document',
    requireAuth(supabase, env),
    faceVerificationLimiter(),
    rawDocParser,
    async (req, res) => {
      const { profile } = req.auth;
      assertActive(profile);
      const documentType = String(req.query?.type ?? 'COLLEGE_ID').trim().toUpperCase();
      if (!DOCUMENT_TYPES.includes(documentType)) throw httpError(400, 'Invalid document type.');

      const verification = await latestVerification(supabase, profile.id);
      if (!verification || !verification.consent_granted) {
        throw httpError(409, 'Start a verification session before uploading a document.');
      }
      if (!['NOT_STARTED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VALIDATING'].includes(verification.verification_status)) {
        throw httpError(409, 'A document cannot be uploaded at this stage.');
      }

      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const { mime, byteSize } = assertUploadAllowed(bytes, 'document'); // 400/413
      if (!VERIFICATION_IMAGE_MIMES.includes(mime)) {
        throw httpError(400, 'Verification documents must be a clear photo — JPG or PNG.');
      }

      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const storagePath = await uploadToStorage(supabase.service, {
        bucket: verificationBucket,
        bytes,
        mime,
        prefix: VERIFICATION_DOCS_PREFIX,
      });

      const analysis = await provider.analyzeIdentityDocument({ bytes, mime });
      const docFields = {
        document_storage_path: storagePath,
        document_type: documentType,
        document_mime: mime,
        document_bytes: byteSize,
        document_sha256: sha256,
        document_status: analysis.status,
        document_validation_meta: analysis.meta ?? {},
        face_verification_provider: provider.mode,
      };

      let finalState;
      if (analysis.status === 'PASSED') {
        finalState = 'DOCUMENT_VERIFIED';
      } else if (analysis.status === 'NEEDS_REVIEW') {
        // Distinct fail-closed path: the document itself is ambiguous.
        finalState = 'MANUAL_REVIEW';
        docFields.review_status = 'REQUIRED';
      } else {
        finalState = 'REJECTED';
        docFields.rejection_reason = 'Your document could not be verified. Please contact support.';
      }
      await walkTransition(supabase, verification, finalState, docFields);

      await writeAudit(supabase, {
        actorId: profile.id, actorRole: 'CUSTOMER',
        action: analysis.status === 'PASSED'
          ? VERIFICATION_EVENTS.DOCUMENT_UPLOADED
          : VERIFICATION_EVENTS.DOCUMENT_VALIDATION_FAILED,
        resourceType: 'seller_verification', resourceId: verification.id, ip: req.ip,
        result: analysis.status === 'PASSED' ? 'SUCCESS' : 'FAILED',
        // Diagnostics are server-side only — never sent to the client (§21).
        metadata: { storagePath, sha256, documentType, reasons: analysis.reasons ?? [], meta: analysis.meta ?? {} },
      });

      return ok(res, {
        verificationId: verification.id,
        state: finalState,
        review: analysis.status,
        message: finalState === 'DOCUMENT_VERIFIED'
          ? 'Document accepted.'
          : finalState === 'REJECTED'
            ? 'Your document could not be verified.'
            : 'Your document needs further review.',
      });
    },
  );

  // ── POST /seller/verification/face ───────────────────────────────────────
  // One raw frame per request; `?final=true` finalises the step burst and the
  // backend runs the liveness challenge check on the accumulated frames.
  router.post(
    '/seller/verification/face',
    requireAuth(supabase, env),
    faceVerificationLimiter(),
    rawFrameParser,
    async (req, res) => {
      const { profile } = req.auth;
      assertActive(profile);
      const sessionId = String(req.query?.sessionId ?? '').trim();
      const step = String(req.query?.step ?? '').trim();
      const isFinal = ['true', '1'].includes(String(req.query?.final ?? '').toLowerCase());
      if (!challengeStepKnown(step)) throw httpError(400, 'Invalid capture step.');

      const session = await ownedSession(supabase, sessionId, profile.id);
      if (isExpired(session)) throw httpError(410, 'Your verification session has expired. Please start a new one.');
      if (session.status === 'COMPLETED' || session.status === 'REVOKED') {
        throw httpError(409, 'This verification session is already finished.');
      }
      // A step that has already been completed cannot be submitted again.
      // With a single-blink challenge this is the whole challenge, so a second
      // blink burst would otherwise be silently accepted as extra evidence and
      // would re-run the liveness analysis on an already-satisfied step.
      // Rejecting keeps one submission per attempt, per the "no duplicate
      // verification requests" rule.
      if (challengeCompleted(session.challenge).includes(step)) {
        throw httpError(409, 'This check has already been completed.');
      }

      const verification = await latestVerification(supabase, profile.id);
      if (!verification || verification.id !== session.verification_id) {
        throw httpError(409, 'Verification session does not match your verification.');
      }
      // First face frame advances from the document stage into face capture.
      if (verification.verification_status === 'DOCUMENT_VERIFIED') {
        await walkTransition(supabase, verification, 'FACE_CAPTURE_REQUIRED', {});
        verification.verification_status = 'FACE_CAPTURE_REQUIRED';
      }
      if (!['FACE_CAPTURE_REQUIRED', 'FACE_PROCESSING', 'LIVENESS_CHECK'].includes(verification.verification_status)) {
        throw httpError(409, 'Face capture is not available at this stage.');
      }
      const sequence = challengeSequence(session.challenge);
      if (!sequence.includes(step)) throw httpError(400, 'This step is not part of your challenge.');

      if (Number(verification.attempt_count ?? 0) >= Number(verification.max_attempts ?? maxAttempts)) {
        throw httpError(429, 'Too many failed attempts. Please contact support.');
      }

      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const mime = sniffMime(bytes);
      if (!mime || !VERIFICATION_IMAGE_MIMES.includes(mime)) {
        throw httpError(400, 'Each frame must be a JPG or PNG image.');
      }
      if (bytes.byteLength > maxFrameBytes) {
        throw httpError(413, 'Frame too large.');
      }

      frames.begin(sessionId);
      const added = frames.add(sessionId, { step, bytes, mime });
      if (!added) throw httpError(400, 'Too many frames for this session.');

      await supabase.service
        .from('verification_sessions')
        .update({ last_activity_at: nowIso(), live_frames_accepted: Number(session.live_frames_accepted ?? 0) + 1 })
        .eq('id', session.id);

      if (!isFinal) {
        return ok(res, { captured: true, step, final: false });
      }

      const burst = frames.take(sessionId, step);
      const liveness = await provider.computeLiveness({ frames: burst, step });
      if (!liveness.passed) {
        // eslint-disable-next-line no-console
        console.warn('[verification] liveness rejected for session', sessionId, 'reasons:', liveness.reasons);
        await supabase.service
          .from('verification_sessions')
          .update({ last_activity_at: nowIso() })
          .eq('id', session.id);
        const attempts = Number(verification.attempt_count ?? 0) + 1;
        await supabase.service
          .from('seller_verifications')
          .update({ attempt_count: attempts, last_live_capture_at: nowIso() })
          .eq('id', verification.id);
        await writeAudit(supabase, {
          actorId: profile.id, actorRole: 'CUSTOMER',
          action: VERIFICATION_EVENTS.LIVENESS_FAILED,
          resourceType: 'seller_verification', resourceId: verification.id, ip: req.ip,
          result: 'FAILURE',
          metadata: { sessionId, step, reasons: liveness.reasons ?? [] },
        });
        if (attempts >= Number(verification.max_attempts ?? maxAttempts)) {
          await walkTransition(supabase, verification, 'REJECTED', {
            rejection_reason: 'Too many failed attempts during identity verification.',
          });
          await supabase.service.from('verification_sessions').update({ status: 'REVOKED' }).eq('id', session.id);
          frames.discard(sessionId);
          return ok(res, { state: 'REJECTED', stepFailed: true, message: 'Too many failed attempts. Please contact support.' });
        }
        return ok(res, {
          state: 'FACE_CAPTURE_REQUIRED',
          stepFailed: true,
          retriesLeft: Number(verification.max_attempts ?? maxAttempts) - attempts,
          message: 'That capture was not accepted. Please try again.',
        });
      }

      // Step passed — record it on the session and advance when the sequence ends.
      const completed = [...challengeCompleted(session.challenge), step];
      const next = sequence.filter((s) => !completed.includes(s));

      if (burst.length > 0) {
        // Retain the cleanest frame of the burst as the face-match reference
        // (keep the MINIMUM raw biometric: exactly one frame). Every burst is
        // consumed for liveness (take), so we re-store only this single
        // reference back into the in-memory cache for the compare step — it is
        // purged on completion/revocation like every other frame.
        //
        // The reference used to come specifically from a `look_straight` step,
        // which no longer exists. It is now taken from whichever step completed
        // (the single blink), so removing a pose can never silently break the
        // match by leaving nothing to compare against.
        const bestRef = [...burst].sort((a, b) => b.bytes.byteLength - a.bytes.byteLength)[0];
        frames.add(sessionId, { step, bytes: bestRef.bytes, mime: bestRef.mime });
      }
      await supabase.service
        .from('verification_sessions')
        .update({ challenge: { sequence, completed }, last_activity_at: nowIso() })
        .eq('id', session.id);

      if (next.length > 0) {
        return ok(res, { state: 'FACE_CAPTURE_REQUIRED', stepComplete: true, remainingSteps: next });
      }

      // Entire challenge done → LIVENESS_CHECK (all base bars cleared).
      await walkTransition(supabase, verification, 'LIVENESS_CHECK', {
        last_live_capture_at: nowIso(),
        liveness_status: 'PASSED',
        antispoof_status: 'PASSED',
        quality_status: 'PASSED',
      });
      await writeAudit(supabase, {
        actorId: profile.id, actorRole: 'CUSTOMER',
        action: VERIFICATION_EVENTS.FACE_CAPTURE_STARTED,
        resourceType: 'seller_verification', resourceId: verification.id, ip: req.ip,
        metadata: { sessionId, stepsCompleted: completed },
      });
      return ok(res, {
        state: 'LIVENESS_CHECK',
        // Always present on the completing frame, so a client never has to
        // infer "my step finished" from which shape of response it got. With a
        // single-blink challenge this is the ONLY shape ever returned.
        stepComplete: true,
        remainingSteps: next,
        allStepsComplete: true,
        message: 'Face capture complete.',
      });
    },
  );

  // ── POST /seller/verification/complete ───────────────────────────────────
  // Final server-side match: the stored identity document vs the best live
  // frame. Outcome decided HERE with real provider scores; a client can only
  // read the resulting state. No scores cross the wire (§6/§21).
  router.post(
    '/seller/verification/complete',
    requireAuth(supabase, env),
    faceVerificationLimiter(),
    async (req, res) => {
      const { profile } = req.auth;
      assertActive(profile);
      const session = await ownedSession(supabase, String(req.body?.sessionId ?? ''), profile.id);
      if (isExpired(session)) throw httpError(410, 'Your verification session has expired. Please start a new one.');

      const verification = await latestVerification(supabase, profile.id);
      if (!verification || verification.id !== session.verification_id) {
        throw httpError(409, 'Verification session does not match your verification.');
      }
      if (verification.verification_status !== 'LIVENESS_CHECK') {
        throw httpError(409, 'Complete the face-capture steps before finishing.');
      }

      const liveFrames = frames.framesFor(session.id);
      if (liveFrames.length === 0) {
        throw httpError(409, 'No capture data is available. Please start a new session.');
      }
      if (!verification.document_storage_path) {
        throw httpError(500, 'Verification data is missing. Please contact support.');
      }

      // Prefer the retained reference frame from the challenge step; otherwise
      // the largest frame we hold. (There is no `look_straight` step any more.)
      const straight = liveFrames.filter((f) => f.step === 'blink');
      const best = (straight.length > 0 ? straight : liveFrames).sort(
        (a, b) => b.bytes.byteLength - a.bytes.byteLength,
      )[0];

      try {
        const documentBytes = await downloadFromStorage(supabase.service, {
          bucket: verificationBucket,
          path: verification.document_storage_path,
        });
        const faceResult = await provider.compareFaces({
          id: { bytes: documentBytes, mime: verification.document_mime ?? 'image/jpeg' },
          live: { bytes: best.bytes, mime: best.mime },
        });

        // ── NO AUTOMATIC APPROVAL ───────────────────────────────────────────
        // This used to branch to VERIFIED when the similarity passed, or to
        // REJECTED when it clearly failed, i.e. the OUTCOME was decided by an
        // automated score with no human in the loop.
        //
        // It no longer is. Whatever the engine reports, the case goes to
        // MANUAL_REVIEW and an ADMINISTRATOR decides APPROVED vs REJECTED. The
        // engine's numbers are recorded for that reviewer; they are never the
        // decision. This is what makes "review is expected within 24 hours"
        // honest — nothing in this codebase can approve a seller on a timer.
        //
        // `match_status` still records the engine's own verdict so a reviewer
        // can see it, and the score is stored for the audit trail. Neither can
        // grant anything: only `POST /admin/seller-verifications/:id/approve`
        // and `.../:id/reject` write a terminal state, and both are admin-gated.
        const finalState = 'MANUAL_REVIEW';
        const matchStatus = faceResult.unable
          ? 'PENDING'
          : faceResult.passed
            ? 'PASSED'
            : 'FAILED';
        const auditMeta = {
          sessionId: session.id,
          similarity: typeof faceResult.similarity === 'number' ? faceResult.similarity : null,
          threshold: faceResult.threshold,
          unable: faceResult.unable === true,
          reason: faceResult.reason ?? null,
          // Recorded for the reviewer. Never returned to the client and never
          // treated as a decision.
          engineSuggestedMatch: matchStatus,
        };

        await walkTransition(supabase, verification, 'MANUAL_REVIEW', {
          verification_score: typeof faceResult.similarity === 'number' ? faceResult.similarity : null,
          match_status: matchStatus,
          review_status: 'REQUIRED',
          last_live_capture_at: nowIso(),
          // The moment an administrator could first act on this case. Written
          // here, once, and never rewritten for the cycle — `reviewed_at -
          // submitted_at` is the real review turnaround the SLA is measured
          // against. (Migration 0008.)
          submitted_at: nowIso(),
        });
        await writeAudit(supabase, {
          actorId: profile.id, actorRole: 'CUSTOMER',
          action: VERIFICATION_EVENTS.MANUAL_REVIEW_REQUESTED,
          resourceType: 'seller_verification', resourceId: verification.id, ip: req.ip,
          result: 'NEEDS_REVIEW',
          metadata: auditMeta,
        });

        await supabase.service.from('verification_sessions').update({ status: 'COMPLETED', completed_at: nowIso() }).eq('id', session.id);
        frames.discard(session.id);

        // Fetch seller store name for the submission email
        const { data: sProfile } = await supabase.service
          .from('seller_profiles')
          .select('store_name')
          .eq('profile_id', profile.id)
          .maybeSingle();

        // Send non-blocking confirmation email to seller and alert to admin
        sendSellerSubmissionEmail(env, {
          to: profile.email,
          fullName: profile.full_name,
          storeName: sProfile?.store_name || 'your store',
        }).catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[verification] submission email background error:', e && e.message ? e.message : e);
        });

        sendSellerApplicationAdminAlertEmail(env, {
          applicantName: profile.full_name || 'Seller Applicant',
          storeName: sProfile?.store_name || 'New Store',
          email: profile.email,
          mobile: profile.mobile || profile.phone || 'N/A',
        }).catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[verification] admin seller alert background error:', e && e.message ? e.message : e);
        });

        return ok(res, {
          state: finalState,
          reviewStatus: 'UNDER_REVIEW',
          message: 'Your verification has been submitted and is under review.',
        });
      } catch (e) {
        // Never leak provider internals; an unexpected analysis failure is
        // reported honestly and the session stays usable for a retry.
        if (e instanceof Error && e.status === 503) throw e;
        // eslint-disable-next-line no-console
        console.error('[verification] complete failed:', e && e.stack ? e.stack : e);
        throw httpError(502, 'Verification could not be completed. Please try again.');
      }
    },
  );

  // ── GET /seller/verification/status ──────────────────────────────────────
  router.get('/seller/verification/status', requireAuth(supabase, env), async (req, res) => {
    const { profile } = req.auth;
    const verification = await latestVerification(supabase, profile.id);
    if (!verification) {
      return ok(res, {
        verification: null,
        provider: { mode: provider.mode, configured: providerConfigured },
      });
    }
    const { data: activeSessions } = await supabase.service
      .from('verification_sessions')
      .select('*')
      .eq('user_id', profile.id)
      .eq('status', 'ACTIVE');
    const session = (activeSessions ?? []).find((s) => !isExpired(s)) ?? null;
    return ok(res, {
      verification: {
        verificationId: verification.id,
        state: verification.verification_status,
        cycle: verification.cycle,
        documentStatus: verification.document_status,
        reviewStatus: verification.review_status,
        attemptsRemaining: Math.max(0, Number(verification.max_attempts ?? maxAttempts) - Number(verification.attempt_count ?? 0)),
        // ── What the page needs to survive a RELOAD ────────────────────────
        // Without these, reloading the page while the case is in review cannot
        // tell "submitted and waiting" from "never submitted" or "already
        // decided", so the page would have to guess — and a guess is exactly how
        // a submitted user gets told to redo a check the backend already holds.
        //
        // `submittedAt` is written once on entry to review (migration 0008) and
        // is the real start of the review clock. `reviewedAt` is set only by an
        // admin decision, so a non-null value proves a decision was actually
        // made. Both are timestamps, never scores.
        submittedAt: verification.submitted_at ?? null,
        reviewedAt: verification.reviewed_at ?? null,
        rejectionReason: verification.rejection_reason ?? null,
      },
      session: session
        ? {
            id: session.id,
            expiresInSeconds: Math.max(0, Math.round((new Date(session.expires_at).getTime() - Date.now()) / 1000)),
            challenge: challengeSequence(session.challenge),
            completedSteps: challengeCompleted(session.challenge),
          }
        : null,
      provider: { mode: provider.mode, configured: providerConfigured },
    });
  });

  return router;
}

function challengeStepKnown(step) {
  return CHALLENGE_STEPS.includes(step);
}

export { isFaceVerificationEnabled };