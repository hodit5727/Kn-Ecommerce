/**
 * Seller identity + face verification service — REAL backend calls only.
 *
 * Security design (mirrors the backend + AGENTS.md §2):
 * - The backend alone evaluates documents, liveness, anti-spoof and face
 *   matches and decides every outcome. This service never submits a status,
 *   a score, a verdict or a role — the request bodies contain only consent,
 *   document kind, session id, step name and raw image bytes.
 * - Face frames travel as raw octet-stream bytes, one per request; the
 *   backend caps size/type and keeps frames only in server RAM. The client
 *   never persists frames anywhere.
 * - No localStorage/sessionStorage is touched: the auth session is an
 *   HttpOnly cookie handled by apiRequest (credentials: 'include').
 * - 503 (provider disabled) and 410 (session expired) are surfaced as
 *   ApiError so the UI can render honest terminal/restart states.
 */
import { apiRequest } from '../api/http';
import type {
  CaptureStep,
  FaceFrameResponse,
  IdDocumentKind,
  VerificationComplete,
  VerificationDocumentUpload,
  VerificationSessionStart,
  VerificationStatus,
} from '../types/verification';

export const verificationService = {
  /**
   * Consent + start (or reuse) a short-lived verification session with a
   * server-randomized liveness challenge. The returned session id and
   * challenge are required for every frame upload.
   */
  async startSession(): Promise<VerificationSessionStart> {
    return apiRequest<VerificationSessionStart>('/seller/verification/session', {
      body: JSON.stringify({ consent: true }),
    });
  },

  /** Upload the ID document photo (server sniffs the real MIME type). */
  async uploadDocument(kind: IdDocumentKind, bytes: ArrayBuffer): Promise<VerificationDocumentUpload> {
    return apiRequest<VerificationDocumentUpload>(`/seller/verification/document?type=${kind}`, {
      method: 'POST',
      body: bytes,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  },

  /**
   * Send one live-capture frame.
   *
   * `final: true` is what makes the backend take the burst for the step and run
   * the liveness analysis on it. With the single-blink challenge there is only
   * ever one final frame per attempt, and the backend rejects a second one for
   * the same step (409) — so a double-submit cannot turn into two analyses.
   *
   * Each sent frame is analysed by the on-server model, so a request takes
   * several seconds on CPU; the UI must show an honest waiting state and must
   * not offer Submit again while one is in flight.
   */
  async sendFrame(
    sessionId: string,
    step: CaptureStep,
    bytes: ArrayBuffer,
    final: boolean,
  ): Promise<FaceFrameResponse> {
    return apiRequest<FaceFrameResponse>(
      `/seller/verification/face?sessionId=${encodeURIComponent(sessionId)}&step=${step}&final=${final ? 'true' : 'false'}`,
      {
        method: 'POST',
        body: bytes,
        headers: { 'Content-Type': 'application/octet-stream' },
      },
    );
  },

  /**
   * Hand the live check to the backend for review.
   *
   * The response is ALWAYS `{ state: 'MANUAL_REVIEW', reviewStatus: 'UNDER_REVIEW' }`.
   * It cannot report VERIFIED and it cannot report REJECTED: no automated
   * similarity score approves or rejects a person. The engine's numbers stay on
   * the server for an administrator, and the client learns only that a human
   * will look at it. `reviewStatus` is asserted as the literal
   * `'UNDER_REVIEW'` in the type so a future backend change that reintroduced an
   * automatic outcome would be a type error here rather than a silent lie in
   * the UI.
   */
  async complete(sessionId: string): Promise<VerificationComplete> {
    return apiRequest<VerificationComplete>('/seller/verification/complete', {
      body: JSON.stringify({ sessionId }),
    });
  },

  /** Honest current state — the page loads this to pick up where it left off. */
  async getStatus(): Promise<VerificationStatus> {
    return apiRequest<VerificationStatus>('/seller/verification/status', {
      method: 'GET',
    });
  },
};