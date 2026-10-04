/**
 * Seller identity + face verification (KYC) — frontend types mirroring the
 * EXPRESS backend contract (server/src/routes/sellerVerification.js +
 * adminVerification.js). The backend alone decides every outcome; these types
 * only describe the request/response shapes. Scores and similarity are NEVER
 * part of any client-facing payload (server-side diagnostics only).
 */

export type VerificationState =
  | 'NOT_STARTED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_VALIDATING'
  | 'DOCUMENT_VERIFIED'
  | 'FACE_CAPTURE_REQUIRED'
  | 'FACE_PROCESSING'
  | 'LIVENESS_CHECK'
  | 'FACE_MATCHING'
  | 'VERIFIED'
  | 'MANUAL_REVIEW'
  | 'REJECTED'
  | 'REVERIFICATION_REQUIRED';

/**
 * There is NO pose challenge. The live check is ONE face check with ONE blink.
 *
 * `CaptureStep`, `CAPTURE_STEPS` and `CAPTURE_STEP_LABELS` were removed with the
 * four-pose flow. They are not deprecated-and-kept: the whole vocabulary is gone,
 * so a four-pose path cannot be reintroduced by accident. The one and only
 * liveness action is a blink, and the state machine that sequences it lives in
 * `src/lib/liveFaceCheck.ts`.
 */
export type CaptureStep = 'blink';

export type IdDocumentKind = 'COLLEGE_ID' | 'GOVERNMENT_ID' | 'OTHER';

export interface VerificationProviderInfo {
  mode: string;
  configured: boolean;
}

/** POST /seller/verification/session { consent: true } */
export interface VerificationSessionStart {
  verification: {
    verificationId: string;
    cycle: number;
    state: VerificationState;
  };
  session: {
    id: string;
    expiresInSeconds: number;
    challenge: CaptureStep[];
  };
  provider: VerificationProviderInfo;
}

/** POST /seller/verification/document?type=… (raw image bytes) */
export interface VerificationDocumentUpload {
  verificationId: string;
  state: VerificationState;
  review: 'PASSED' | 'NEEDS_REVIEW' | 'FAILED';
  message: string;
}

/**
 * POST /seller/verification/face?sessionId=…&step=…&final=…
 * (one raw jpeg/png frame per request).
 *
 * With the single-blink challenge there is exactly ONE final-frame shape for a
 * passing burst; the failure shapes are retained so a genuinely failed capture
 * is reported honestly rather than hidden.
 */
export type FaceFrameResponse =
  | { captured: true; step: CaptureStep; final: false }
  | {
      state: 'FACE_CAPTURE_REQUIRED';
      stepComplete?: boolean;
      remainingSteps?: CaptureStep[];
      stepFailed?: boolean;
      retriesLeft?: number;
      message?: string;
    }
  | {
      state: 'LIVENESS_CHECK';
      stepComplete: true;
      remainingSteps: CaptureStep[];
      allStepsComplete: true;
      message: string;
    }
  | { state: 'REJECTED'; stepFailed: true; message: string };

/**
 * POST /seller/verification/complete { sessionId }
 *
 * `state` is ALWAYS 'MANUAL_REVIEW' on success. It used to be able to return
 * 'VERIFIED' or 'REJECTED' straight from an automated similarity score, which
 * meant the customer's submission decided their own verification outcome. There
 * is no automatic approval and no automatic rejection: the engine's numbers are
 * recorded for an administrator, and only the admin-gated routes can move the
 * case on. `reviewStatus` says so explicitly.
 */
export interface VerificationComplete {
  state: 'MANUAL_REVIEW';
  reviewStatus: 'UNDER_REVIEW';
  message: string;
}

/**
 * GET /seller/verification/status
 *
 * `submittedAt` / `reviewedAt` are what make a RELOAD honest. Re-opening the page
 * while a case is in review must show the same UNDER_REVIEW screen, must not
 * restart the camera, and must not ask for another blink — and it can only know
 * that from these two timestamps, because the frontend keeps no state of its own
 * (no localStorage/sessionStorage).
 */
export interface VerificationStatus {
  verification: null | {
    verificationId: string;
    state: VerificationState;
    cycle: number;
    documentStatus: string | null;
    reviewStatus: string | null;
    attemptsRemaining: number;
    submittedAt: string | null;
    reviewedAt: string | null;
    rejectionReason: string | null;
  };
  session: null | {
    id: string;
    expiresInSeconds: number;
    challenge: CaptureStep[];
    completedSteps: CaptureStep[];
  };
  provider: VerificationProviderInfo;
}

/**
 * GET /admin/seller-verifications — ADMIN review surface (server-verified
 * role required; 403 for customers/sellers). Scores and similarity are never
 * present; documentUrl is a SHORT-LIVED signed URL the reviewer opens to
 * inspect the private ID document (null when no document was uploaded).
 */
export interface AdminVerificationRow {
  id: string;
  userId: string;
  email: string | null;
  sellerName?: string | null;
  storeName?: string | null;
  sellerId?: string | null;
  cycle: number;
  state: VerificationState;
  documentStatus: string | null;
  livenessStatus?: string | null;
  matchStatus: string | null;
  reviewStatus: string | null;
  rejectionReason: string | null;
  provider: string;
  attemptCount: number;
  createdAt: string | null;
  submittedAt?: string | null;
  reviewedAt: string | null;
  documentUrl: string | null;
}