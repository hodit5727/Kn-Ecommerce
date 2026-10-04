/**
 * Refunds / returns (BACKEND_SPEC §21/§22 — refund window math, commission
 * scale) + admin adjudication. Contract (src/services/refundService.ts):
 *
 *   GET   /refunds                     → { refunds: RefundClaim[] }
 *   GET   /refunds/:id                 → { refund: RefundClaim }
 *   POST  /refunds                     → { refund } body { orderId, reason,
 *                                        description? }
 *   PATCH /refunds/:id/status          → { refund } body { status,
 *                                        adminNotes? }  (ADMIN only)
 *
 * Security:
 * - Roles are scope gates, never client claims: ADMIN sees all, an APPROVED
 *   seller sees claims on its own orders, a customer sees its own claims.
 *   Cross-user access returns a generic 404 (§5-56/77).
 * - Eligibility window + commission are computed ONLY from server timestamps
 *   (delivered_at + now) — never from client time (§22, §5-59).
 * - POST is customer-only and ownership-checked; the DB's unique partial
 *   index `returns_open_uniq` is the race-proof backstop for double-claims.
 * - PATCH is ADMIN-only and only accepts APPROVED / REJECTED / COMPLETED;
 *   every transition writes its bookkeeping (audit + timestamps) server-side.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { HttpError, httpError, ok } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isApprovedSeller as isSeller } from '../middleware/seller.js';
import { writeAudit } from '../lib/audit.js';
import { validate } from '../lib/schema.js';
import { sendRefundRequestedAdminAlertEmail, sendRefundStatusCustomerEmail } from '../lib/mail.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const REFUND_REASONS = [
  'DAMAGED_ON_DELIVERY',
  'NOT_AS_DESCRIBED',
  'DEFECTIVE_COMPONENT',
  'WRONG_ITEM_RECEIVED',
  'OTHER',
];
const OPEN_RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED'];
/** PATCH /refunds/:id/status accepts only these (UNDER_REVIEW/PROCESSING are
 *  derived display states, not writable transitions — honest 400 otherwise). */
const WRITABLE_REFUND_TRANSITIONS = ['APPROVED', 'REJECTED', 'COMPLETED'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function fetchAll(supabase, table, label) {
  const { data, error } = await supabase.service.from(table).select('*');
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[refunds] ${label} query failed:`, error.message);
    throw httpError(502, 'Unable to load refunds. Please try again later.');
  }
  return data ?? [];
}

async function loadRefundContext(supabase) {
  const [orders, orderItems, profiles, sellerProfiles, returns, refunds] = await Promise.all([
    fetchAll(supabase, 'orders', 'orders'),
    fetchAll(supabase, 'order_items', 'order items'),
    fetchAll(supabase, 'profiles', 'profiles'),
    fetchAll(supabase, 'seller_profiles', 'seller profiles'),
    fetchAll(supabase, 'returns', 'returns'),
    fetchAll(supabase, 'refunds', 'refunds'),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const storeBySeller = new Map(sellerProfiles.map((s) => [s.profile_id, s]));
  const primaryItemByOrder = new Map();
  for (const it of orderItems) {
    if (!primaryItemByOrder.has(it.order_id)) primaryItemByOrder.set(it.order_id, it);
  }
  return { orderById, profileById, storeBySeller, primaryItemByOrder, returns, refunds };
}

export function formatReturnCode(rawCode, returnId) {
  if (rawCode && /^CNRT-\d{4}$/.test(String(rawCode))) {
    return String(rawCode);
  }
  const match = String(rawCode ?? '').match(/\d{4}$/);
  if (match) return `CNRT-${match[0]}`;
  const hex = String(returnId ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
  const num = hex ? ((parseInt(hex, 16) % 9000) + 1000) : 1001;
  return `CNRT-${num}`;
}

export function formatRefundCode(rawCode, refundId, fallbackReturnId) {
  if (rawCode && /^CNRF-\d{4}$/.test(String(rawCode))) {
    return String(rawCode);
  }
  const match = String(rawCode ?? '').match(/\d{4}$/);
  if (match) return `CNRF-${match[0]}`;
  const hex = String(refundId || fallbackReturnId || '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
  const num = hex ? ((parseInt(hex, 16) % 9000) + 1000) : 1001;
  return `CNRF-${num}`;
}

/** Maps DB return/refund rows to the FRONTEND RefundClaim contract. */
function claimFromRecords({ refund, ret, orderById, profileById, storeBySeller, primaryItemByOrder }) {
  const order = orderById.get(ret.order_id);
  const customer = profileById.get(ret.customer_id);
  const seller = order ? profileById.get(order.seller_id) : null;
  const store = order ? storeBySeller.get(order.seller_id) : null;
  const item = primaryItemByOrder.get(ret.order_id);

  let status;
  if (ret.status === 'REJECTED') status = 'REJECTED';
  else if (refund?.status === 'PROCESSED' || ret.status === 'COMPLETED') status = 'COMPLETED';
  else if (refund?.status === 'FAILED') status = 'REJECTED';
  else if (ret.status === 'IN_TRANSIT' || ret.status === 'RECEIVED') status = 'PROCESSING';
  else if (ret.status === 'APPROVED') status = 'UNDER_REVIEW';
  else status = 'REQUESTED';

  const reason = REFUND_REASONS.includes(ret.reason) ? ret.reason : 'OTHER';

  const ts = (v) => (v ? String(v) : '');
  const updated = [ret.updated_at, refund?.updated_at].filter(Boolean).sort().pop();

  const returnCode = formatReturnCode(ret.return_number || ret.id, ret.id);
  const refundCode = formatRefundCode(refund?.refund_number || refund?.id || ret.id, refund?.id, ret.id);

  return {
    id: refund?.id ?? ret.id,
    refundNumber: `REF-${String(refund?.id ?? ret.id).slice(0, 8).toUpperCase()}`,
    returnCode,
    refundCode,
    orderId: ret.order_id,
    orderNumber: order?.order_number ?? '',
    productId: item?.product_id ?? '',
    productName: item?.product_name ?? '',
    productImage: '', // no image snapshot exists on the return record — honest ''
    customerId: ret.customer_id,
    customerName: customer?.full_name ?? '',
    customerEmail: customer?.email ?? '',
    sellerId: order?.seller_id ?? '',
    sellerName: store?.store_name || seller?.full_name || '',
    amount: round2(refund?.amount ?? ret.refund_amount ?? 0),
    reason,
    description: ret.description ?? '',
    status,
    adminNotes: ret.rejection_reason ?? undefined,
    sellerResponse: ret.rejection_reason ?? undefined,
    requestedAt: ts(ret.requested_at),
    resolvedAt: ts(refund?.processed_at ?? ret.completed_at) || undefined,
    updatedAt: ts(updated),
  };
}

export function createRefundsRouter({ env, supabase }) {
  const router = Router();

  // ── GET /refunds — role-scoped listing ───────────────────────────────────
  router.get('/refunds', requireAuth(supabase, env), async (req, res) => {
    const profile = req.auth.profile;
    const ctx = await loadRefundContext(supabase);

    let visible = ctx.refunds;
    if (profile.role === 'ADMIN') {
      // all claims
    } else if (isSeller(profile)) {
      const orderIds = new Set(
        [...ctx.orderById.values()].filter((o) => o.seller_id === profile.id).map((o) => o.id),
      );
      visible = visible.filter((r) => orderIds.has(r.order_id));
    } else {
      visible = visible.filter((r) => r.customer_id === profile.id);
    }

    const refundByReturnId = new Map(ctx.refunds.map((r) => [r.return_id, r]));
    const refunds = visible
      .map((refund) => {
        const ret = ctx.returns.find((x) => x.id === refund.return_id);
        if (!ret) return null;
        return claimFromRecords({ refund, ret, ...ctx });
      })
      .filter(Boolean)
      .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));

    return ok(res, { refunds });
  });

  // ── GET /refunds/:id — single claim, ownership-scoped (generic 404) ──────
  router.get('/refunds/:id', requireAuth(supabase, env), async (req, res) => {
    const profile = req.auth.profile;
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Refund not found.');

    const ctx = await loadRefundContext(supabase);
    const refund = ctx.refunds.find((r) => r.id === id);
    if (!refund) throw httpError(404, 'Refund not found.');
    const ret = ctx.returns.find((x) => x.id === refund.return_id);
    if (!ret) throw httpError(404, 'Refund not found.');
    const order = ctx.orderById.get(ret.order_id);

    let allowed = false;
    if (profile.role === 'ADMIN') allowed = true;
    else if (isSeller(profile)) allowed = Boolean(order && order.seller_id === profile.id);
    else allowed = refund.customer_id === profile.id;
    if (!allowed) throw httpError(404, 'Refund not found.');

    return ok(res, { refund: claimFromRecords({ refund, ret, ...ctx }) });
  });

  // ── POST /refunds — customer initiates a claim (window + commission) ─────
  const CREATE_SCHEMA = {
    orderId: { type: 'uuid', required: true, label: 'Order' },
    reason: { type: 'string', required: true, enum: REFUND_REASONS, label: 'Reason' },
    description: { type: 'string', max: 1000, label: 'Description' },
  };

  router.post('/refunds', requireAuth(supabase, env), async (req, res) => {
    const { profile } = req.auth;
    if (
      profile.role === 'ADMIN' ||
      profile.seller_status === 'APPROVED' ||
      (Array.isArray(profile.roles) && profile.roles.includes('SELLER'))
    ) {
      throw httpError(403, 'Only customers can request refunds.');
    }
    if (profile.status && profile.status !== 'ACTIVE') {
      throw httpError(403, 'Your account is not active.');
    }

    const result = validate(req.body ?? {}, CREATE_SCHEMA);
    if (!result.ok) {
      const first = Object.values(result.errors)[0];
      throw httpError(400, typeof first === 'string' ? first : 'Please review the entered details.');
    }
    const { orderId, reason, description } = result.fields;

    const { orderById, returns } = await loadRefundContext(supabase);
    const order = orderById.get(orderId);
    if (!order || order.customer_id !== profile.id) {
      // Generic 404 — never leak order existence (§5-77).
      throw httpError(404, 'Order not found.');
    }

    const openClaim = returns.find(
      (r) => r.order_id === orderId && OPEN_RETURN_STATUSES.includes(r.status),
    );
    if (openClaim) {
      throw httpError(409, 'A refund request is already open for this order.');
    }

    if (order.status !== 'DELIVERED' || !order.delivered_at) {
      throw httpError(400, 'Refunds can only be requested after the order has been delivered.');
    }

    // §22 window math — SERVER time only (never client-provided).
    const now = new Date();
    const deliveredAt = new Date(order.delivered_at).getTime();
    if (!Number.isFinite(deliveredAt)) {
      throw httpError(502, 'Unable to compute the refund window for this order.');
    }
    const eligibilityDay = Math.floor((now.getTime() - deliveredAt) / DAY_MS) + 1;
    if (eligibilityDay > 7) {
      throw httpError(400, 'The refund window for this order has closed.');
    }
    const commissionPercent = eligibilityDay <= 3 ? 5 : 10;

    const total = round2(order.total);
    const commissionAmount = round2((total * commissionPercent) / 100);
    const refundAmount = round2(total - commissionAmount);

    const retId = crypto.randomUUID();
    const refundId = crypto.randomUUID();
    const nowIso = now.toISOString();
    try {
      const { error: retError } = await supabase.service.from('returns').insert({
        id: retId,
        order_id: orderId,
        customer_id: profile.id,
        reason,
        description: description || null,
        eligibility_day: eligibilityDay,
        commission_percent: commissionPercent,
        commission_amount: commissionAmount,
        refund_amount: refundAmount,
        requested_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      });
      if (retError) {
        if (/returns_open_uniq/i.test(String(retError.message ?? ''))) {
          throw httpError(409, 'A refund request is already open for this order.');
        }
        throw retError;
      }
      const { error: refundError } = await supabase.service.from('refunds').insert({
        id: refundId,
        return_id: retId,
        order_id: orderId,
        customer_id: profile.id,
        amount: refundAmount,
        commission_amount: commissionAmount,
        status: 'PENDING',
        created_at: nowIso,
        updated_at: nowIso,
      });
      if (refundError) throw refundError;
      const { error: orderError } = await supabase.service
        .from('orders')
        .update({ status: 'RETURN_REQUESTED', updated_at: nowIso })
        .eq('id', orderId);
      if (orderError) throw orderError;
    } catch (err) {
      // Best-effort rollback of the claim rows. returns/refunds are
      // APPEND-ONLY in production (0002 trigger), so deletion is attempted
      // first (works in the test fake) and, when the DB refuses, the claim
      // is honestly marked REJECTED/FAILED — never a dangling REQUESTED row.
      try {
        await supabase.service.from('refunds').delete().eq('return_id', retId);
        await supabase.service.from('returns').delete().eq('id', retId);
      } catch (rollbackError) {
        // eslint-disable-next-line no-console
        console.error('[refunds] create rollback delete failed (append-only?):', rollbackError?.message ?? rollbackError);
        try {
          const rollbackNote = 'Rolled back automatically: the request could not be completed.';
          await supabase.service
            .from('returns')
            .update({ status: 'REJECTED', rejection_reason: rollbackNote, updated_at: new Date().toISOString() })
            .eq('id', retId);
          await supabase.service
            .from('refunds')
            .update({ status: 'FAILED', failure_reason: rollbackNote, updated_at: new Date().toISOString() })
            .eq('return_id', retId);
        } catch (fallbackError) {
          // eslint-disable-next-line no-console
          console.error('[refunds] rollback reject fallback failed:', fallbackError?.message ?? fallbackError);
        }
      }
      if (err instanceof HttpError) throw err;
      // eslint-disable-next-line no-console
      console.error('[refunds] claim creation failed:', err?.message ?? err);
      throw httpError(502, 'Unable to submit the refund request. Please try again.');
    }

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'refund.requested',
      resourceType: 'refund',
      resourceId: refundId,
      ip: req.ip ?? null,
      metadata: { orderId, eligibilityDay, commissionPercent },
    });

    const ctx = await loadRefundContext(supabase);
    const refundRow = ctx.refunds.find((r) => r.id === refundId);
    const retRow = ctx.returns.find((r) => r.id === retId);

    // Trigger admin alert email (non-blocking)
    (async () => {
      try {
        const order = ctx.orderById.get(orderId);
        const orderCode = order ? `ORD-${order.order_number}` : orderId;
        await sendRefundRequestedAdminAlertEmail(env, {
          orderCode,
          customerName: profile.full_name || 'Customer',
          refundAmount,
          reason,
        });
      } catch (mailErr) {
        // eslint-disable-next-line no-console
        console.warn('[refunds] admin alert failed:', mailErr?.message || mailErr);
      }
    })();

    return ok(res, {
      refund: claimFromRecords({ refund: refundRow, ret: retRow, ...ctx }),
    });
  });

  // ── PATCH /refunds/:id/status — ADMIN adjudication ───────────────────────
  const STATUS_SCHEMA = {
    status: {
      type: 'string',
      required: true,
      enum: WRITABLE_REFUND_TRANSITIONS,
      label: 'Status',
    },
    adminNotes: { type: 'string', max: 1000, label: 'Admin notes' },
  };

  router.patch(
    '/refunds/:id/status',
    requireAuth(supabase, env),
    requireRole(supabase, env, 'ADMIN'),
    async (req, res) => {
      const profile = req.auth.profile;
      const id = String(req.params.id ?? '').trim();
      if (!UUID_RE.test(id)) throw httpError(404, 'Refund not found.');

      const result = validate(req.body ?? {}, STATUS_SCHEMA);
      if (!result.ok) {
        const first = Object.values(result.errors)[0];
        throw httpError(400, typeof first === 'string' ? first : 'Please review the entered details.');
      }
      const { status, adminNotes } = result.fields;

      const ctx = await loadRefundContext(supabase);
      const refund = ctx.refunds.find((r) => r.id === id);
      if (!refund) throw httpError(404, 'Refund not found.');
      const ret = ctx.returns.find((x) => x.id === refund.return_id);
      if (!ret) throw httpError(404, 'Refund not found.');
      const order = ctx.orderById.get(ret.order_id);
      if (!order) throw httpError(404, 'Refund not found.');

      if (ret.status === 'REJECTED' || ret.status === 'COMPLETED' || refund.status === 'PROCESSED') {
        throw httpError(400, 'This refund is already resolved.');
      }

      const nowIso = new Date().toISOString();
      if (status === 'APPROVED') {
        const { error } = await supabase.service
          .from('returns')
          .update({ status: 'APPROVED', approved_at: nowIso, updated_at: nowIso })
          .eq('id', ret.id);
        if (error) {
          // eslint-disable-next-line no-console
          console.error('[refunds] approve failed:', error.message);
          throw httpError(502, 'Unable to approve the refund. Please try again.');
        }
      } else if (status === 'REJECTED') {
        const reason = (adminNotes ?? 'Rejected by administration.').trim().slice(0, 1000);
        const { error: retError } = await supabase.service
          .from('returns')
          .update({ status: 'REJECTED', rejection_reason: reason, updated_at: nowIso })
          .eq('id', ret.id);
        if (retError) {
          // eslint-disable-next-line no-console
          console.error('[refunds] reject (return) failed:', retError.message);
          throw httpError(502, 'Unable to reject the refund. Please try again.');
        }
        const { error: refundError } = await supabase.service
          .from('refunds')
          .update({ status: 'FAILED', failure_reason: reason, updated_at: nowIso })
          .eq('id', refund.id);
        if (refundError) {
          // eslint-disable-next-line no-console
          console.error('[refunds] reject (refund) failed:', refundError.message);
          throw httpError(502, 'Unable to reject the refund. Please try again.');
        }
        // The return is refused → the order goes back to delivered.
        const { error: orderError } = await supabase.service
          .from('orders')
          .update({ status: 'DELIVERED', updated_at: nowIso })
          .eq('id', order.id);
        if (orderError) {
          // eslint-disable-next-line no-console
          console.error('[refunds] reject (order revert) failed:', orderError.message);
          throw httpError(502, 'Unable to reject the refund. Please try again.');
        }
      } else if (status === 'COMPLETED') {
        const { error: retError } = await supabase.service
          .from('returns')
          .update({ status: 'COMPLETED', completed_at: nowIso, updated_at: nowIso })
          .eq('id', ret.id);
        if (retError) {
          // eslint-disable-next-line no-console
          console.error('[refunds] complete (return) failed:', retError.message);
          throw httpError(502, 'Unable to complete the refund. Please try again.');
        }
        const { error: refundError } = await supabase.service
          .from('refunds')
          .update({ status: 'PROCESSED', processed_at: nowIso, updated_at: nowIso })
          .eq('id', refund.id);
        if (refundError) {
          // eslint-disable-next-line no-console
          console.error('[refunds] complete (refund) failed:', refundError.message);
          throw httpError(502, 'Unable to complete the refund. Please try again.');
        }
        const { error: orderError } = await supabase.service
          .from('orders')
          .update({ status: 'REFUNDED', updated_at: nowIso })
          .eq('id', order.id);
        if (orderError) {
          // eslint-disable-next-line no-console
          console.error('[refunds] complete (order) failed:', orderError.message);
          throw httpError(502, 'Unable to complete the refund. Please try again.');
        }
      }

      await writeAudit(supabase, {
        actorId: profile.id,
        actorRole: profile.role,
        action: `refund.${status.toLowerCase()}`,
        resourceType: 'refund',
        resourceId: refund.id,
        ip: req.ip ?? null,
        metadata: { adminNotes: adminNotes ?? null },
      });

      const refreshed = await loadRefundContext(supabase);
      const updatedRefund = refreshed.refunds.find((r) => r.id === refund.id);
      const updatedRet = refreshed.returns.find((x) => x.id === ret.id);

      // Trigger customer refund status email (non-blocking)
      (async () => {
        try {
          const cust = refreshed.profileById.get(ret.customer_id);
          const ord = refreshed.orderById.get(ret.order_id);
          const orderCode = ord ? `ORD-${ord.order_number}` : ret.order_id;
          if (cust?.email) {
            await sendRefundStatusCustomerEmail(env, {
              to: cust.email,
              orderCode,
              customerName: cust.full_name || 'Valued Customer',
              status,
              refundAmount: refund.amount,
              notes: adminNotes || undefined,
            });
          }
        } catch (mailErr) {
          // eslint-disable-next-line no-console
          console.warn('[refunds] customer email failed:', mailErr?.message || mailErr);
        }
      })();

      return ok(res, {
        refund: claimFromRecords({ refund: updatedRefund, ret: updatedRet, ...refreshed }),
      });
    },
  );

  return router;
}