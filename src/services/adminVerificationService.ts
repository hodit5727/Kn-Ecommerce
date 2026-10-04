/**
 * Seller identity + face verification — ADMIN review service (real backend
 * calls only). Mirrors server/src/routes/adminVerification.js.
 *
 * Security design:
 * - Every /admin/seller-verifications/* call is role-gated SERVER-side
 *   (ADMIN only); a customer/seller session receives 403 — this service
 *   never relies on client-side role flags.
 * - Only the reviewer's decision (approve/reject/re-open) and a reason are
 *   sent to the backend. Verdicts, scores and states are never submitted —
 *   the backend + DB decide.
 * - The ID document is never exposed as a public URL: documentUrl is a
 *   short-lived signed URL minted by the backend for the private bucket.
 * - No localStorage/sessionStorage; auth is the HttpOnly cookie handled by
 *   apiRequest (credentials: 'include').
 */
import { apiRequest } from '../api/http';
import type { AdminVerificationRow } from '../types/verification';

interface AdminVerificationsResponse {
  verifications: AdminVerificationRow[];
}

interface AdminDocumentResponse {
  documentUrl: string;
}

interface AdminVerificationActionResponse {
  id: string;
  state: string;
  sellerId?: string | null;
}

export const adminVerificationService = {
  /** All latest-cycle verifications (admin gate on the server). */
  async list(): Promise<AdminVerificationRow[]> {
    const res = await apiRequest<AdminVerificationsResponse>(
      '/admin/seller-verifications',
      { method: 'GET' },
    );
    return res.verifications ?? [];
  },

  /** Fresh short-lived signed URL for the applicant's private ID document. */
  async getDocumentUrl(id: string): Promise<string> {
    const res = await apiRequest<AdminDocumentResponse>(
      `/admin/seller-verifications/${id}/document`,
      { method: 'GET' },
    );
    return res.documentUrl;
  },

  /** Approve a MANUAL_REVIEW verification (server requires a real score). */
  async approve(id: string): Promise<AdminVerificationActionResponse> {
    return apiRequest<AdminVerificationActionResponse>(
      `/admin/seller-verifications/${id}/approve`,
      { body: JSON.stringify({}) },
    );
  },

  /** Reject a MANUAL_REVIEW verification with a mandatory reason. */
  async reject(id: string, reason: string): Promise<AdminVerificationActionResponse> {
    return apiRequest<AdminVerificationActionResponse>(
      `/admin/seller-verifications/${id}/reject`,
      { body: JSON.stringify({ reason }) },
    );
  },

  /** Re-open a REJECTED / MANUAL_REVIEW verification for a fresh attempt. */
  async requestReverification(id: string, reason: string): Promise<AdminVerificationActionResponse> {
    return apiRequest<AdminVerificationActionResponse>(
      `/admin/seller-verifications/${id}/request-reverification`,
      { body: JSON.stringify({ reason }) },
    );
  },
};