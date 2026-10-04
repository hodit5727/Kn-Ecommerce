/**
 * Seller identity + face verification — domain constants (spec §13, §17).
 *
 * States, legal transitions, retry limits and audit event names live here so
 * the routes, the DB trigger and the tests all speak one vocabulary.
 */
export const VERIFICATION_STATES = Object.freeze([
  'NOT_STARTED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_VALIDATING',
  'DOCUMENT_VERIFIED',
  'FACE_CAPTURE_REQUIRED',
  'FACE_PROCESSING',
  'LIVENESS_CHECK',
  'FACE_MATCHING',
  'VERIFIED',
  'MANUAL_REVIEW',
  'REJECTED',
  'REVERIFICATION_REQUIRED',
]);

/**
 * Legal state transitions (§13 — "REJECTED → VERIFIED must never happen
 * directly"). Mirrored by the DB trigger `verification_transition_check`
 * (supabase/migrations/0006_seller_verification.sql); this map is used by the
 * application layer to fail fast with a clean 409.
 */
export const VERIFICATION_TRANSITIONS = Object.freeze({
  NOT_STARTED: ['DOCUMENT_UPLOADED', 'DOCUMENT_VALIDATING'],
  DOCUMENT_UPLOADED: ['DOCUMENT_VALIDATING', 'REJECTED'],
  DOCUMENT_VALIDATING: ['DOCUMENT_VERIFIED', 'REJECTED', 'MANUAL_REVIEW'],
  DOCUMENT_VERIFIED: ['FACE_CAPTURE_REQUIRED'],
  FACE_CAPTURE_REQUIRED: ['FACE_PROCESSING', 'FACE_CAPTURE_REQUIRED', 'REJECTED'],
  FACE_PROCESSING: ['LIVENESS_CHECK', 'REJECTED'],
  LIVENESS_CHECK: ['FACE_MATCHING', 'LIVENESS_CHECK', 'REJECTED'],
  FACE_MATCHING: ['VERIFIED', 'MANUAL_REVIEW', 'REJECTED'],
  MANUAL_REVIEW: ['VERIFIED', 'REJECTED', 'REVERIFICATION_REQUIRED'],
  REJECTED: ['REVERIFICATION_REQUIRED'],
  REVERIFICATION_REQUIRED: ['DOCUMENT_UPLOADED', 'NOT_STARTED'],
  VERIFIED: [],
});

/** Default verification attempt cap per cycle (spec §8: no unlimited retries). */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** Default short-lived session lifetime (spec §17 — sessions expire). */
export const SESSION_TTL_MINUTES = 15;

/**
 * THE LIVENESS CHALLENGE — exactly one action.
 *
 * This was a randomized four-pose sequence
 * (`['look_straight', 'blink', 'turn_left', 'turn_right']`). It is now a SINGLE
 * blink. The four-pose vocabulary is removed rather than deprecated: no head
 * turn, no look up/down, and no "pose 2 of 4" anywhere in the contract, the
 * database, or the client.
 *
 * Why one action:
 *  - A single blink defeats a static-photo replay, which is the threat this step
 *    exists for, and it is far kinder than four timed poses.
 *  - The server measures it with a real eye-aspect-ratio + gesture model
 *    (`provider.computeLiveness({ step: 'blink' })`), so the AUTHORITY for
 *    liveness is the backend. The browser's own blink detection is a UX prompt
 *    that only enables the submit button — it never decides anything.
 *  - Fewer required frames means less biometric data retained, which is the
 *    correct default for a KYC flow (data minimisation).
 */
export const CHALLENGE_STEPS = ['blink'];

/** Audit event vocabulary (§22) — written via lib/audit.js writeAudit(). */
export const VERIFICATION_EVENTS = Object.freeze({
  DOCUMENT_UPLOADED: 'verification.document_uploaded',
  DOCUMENT_VALIDATION_FAILED: 'verification.document_validation_failed',
  FACE_SESSION_CREATED: 'verification.face_session_created',
  FACE_CAPTURE_STARTED: 'verification.face_capture_started',
  LIVENESS_FAILED: 'verification.liveness_failed',
  FACE_MATCH_FAILED: 'verification.face_match_failed',
  VERIFICATION_COMPLETED: 'verification.completed',
  MANUAL_REVIEW_REQUESTED: 'verification.manual_review_requested',
  SELLER_APPROVED: 'verification.seller_approved',
  SELLER_REJECTED: 'verification.seller_rejected',
  REVERIFICATION_REQUESTED: 'verification.reverification_requested',
});

/**
 * Terminal states — a verification in one of these cannot keep progressing
 * without a new cycle (admin request-reverification) or an admin decision.
 */
export const TERMINAL_STATES = Object.freeze(['VERIFIED', 'REJECTED']);