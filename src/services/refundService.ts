/**
 * Refund service — REAL backend calls only.
 *
 * ─── Security design (removed legacy mock/localStorage refunds) ────────────
 * - No SEED_REFUNDS, no INITIAL_PRODUCTS fixtures, no localStorage refund
 *   store, no client-generated refund numbers, no simulateNetworkDelay.
 * - The server derives product, amount, customer, seller and order number
 *   from `orderId` — none of those client values are trusted (§5.59, §76).
 * - The server validates refund eligibility windows/timestamps before
 *   creating a claim (§5.59).
 * - Identity/scope come from the HttpOnly session cookie only; errors
 *   propagate as ApiError so pages can render real error states.
 *
 * ─── API contract for the Express backend (backend phase) ──────────────────
 * GET    /refunds                -> { refunds }  Session-scoped: customers
 *       query: customerId, sellerId              see their own claims, sellers
 *                                                their own, admins all. The
 *                                                legacy client customerId /
 *                                                sellerId params are HINTS
 *                                                ONLY and must be IGNORED for
 *                                                authorization (§5.56, §5.59,
 *                                                §5.77/78).
 * GET    /refunds/:id            -> { refund }   ownership/role-checked
 *                                                server-side (§5.56).
 * POST   /refunds                -> { refund }   body { orderId, reason,
 *                                                description }. The server
 *                                                derives every other field
 *                                                (product, amount, customer,
 *                                                seller, orderNumber) from the
 *                                                order and validates the
 *                                                eligibility window first
 *                                                (§5.59).
 * PATCH  /refunds/:id/status     -> { refund }   body { status, adminNotes }.
 *                                                ADMIN role-checked server-side
 *                                                (§5.60–5.62); status
 *                                                transitions and resolvedAt
 *                                                bookkeeping are owned by the
 *                                                server (§5.66).
 */
import type { RefundClaim, RefundStatus, RefundReason } from '../types/refund';
import { apiRequest } from '../api/http';

interface RefundsResponse {
  refunds: RefundClaim[];
}

interface RefundResponse {
  refund: RefundClaim;
}

export const refundService = {
  /**
   * `customerId` / `sellerId` are kept for call-site compatibility only —
   * the server derives the real scope from the session and ignores these
   * params for authorization.
   */
  async getRefunds(customerId?: string, sellerId?: string): Promise<RefundClaim[]> {
    const query = new URLSearchParams();
    if (customerId) query.set('customerId', customerId);
    if (sellerId) query.set('sellerId', sellerId);
    const qs = query.toString();

    const res = await apiRequest<RefundsResponse>(`/refunds${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
    return res.refunds;
  },

  /** Ownership/role is verified server-side; foreign ids return 403/404. */
  async getRefundById(refundId: string): Promise<RefundClaim> {
    const res = await apiRequest<RefundResponse>(`/refunds/${encodeURIComponent(refundId)}`, {
      method: 'GET',
    });
    return res.refund;
  },

  /**
   * Submit a refund claim. The full signature is preserved for existing
   * callers, but only server-derivable-safe fields are transmitted: the
   * product, amount, customer, seller and order number are all resolved
   * server-side from `orderId`.
   */
  async submitRefundClaim(claimData: {
    orderId: string;
    orderNumber: string;
    productId: string;
    productName: string;
    productImage: string;
    customerId: string;
    customerName: string;
    customerEmail: string;
    sellerId: string;
    sellerName: string;
    amount: number;
    reason: RefundReason;
    description: string;
  }): Promise<RefundClaim> {
    const res = await apiRequest<RefundResponse>('/refunds', {
      body: JSON.stringify({
        orderId: claimData.orderId,
        reason: claimData.reason,
        description: claimData.description,
      }),
    });
    return res.refund;
  },

  /** Admin arbitration. Role + transition legality enforced server-side. */
  async updateRefundStatus(
    refundId: string,
    status: RefundStatus,
    adminNotes?: string
  ): Promise<RefundClaim> {
    const res = await apiRequest<RefundResponse>(
      `/refunds/${encodeURIComponent(refundId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status, adminNotes }),
      }
    );
    return res.refund;
  },
};
