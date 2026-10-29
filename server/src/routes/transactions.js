/**
 * Financial passbook (BACKEND_SPEC §28/§29 — immutable virtual ledger).
 * Contract (src/services/transactionService.ts):
 *
 *   GET /transactions?type=CR|DR → { transactions: FinancialTransaction[] }
 *
 * Security:
 * - Scope is derived ONLY from the session: ADMIN sees every row, an APPROVED
 *   seller sees its own seller-scoped rows, a customer sees its own. The
 *   optional `customerId` / `sellerId` query params in the service are
 *   IGNORED for authorization; cross-tenant reads are impossible (§5-76/77).
 * - `type` is validated CR|DR; anything else is a clean 400.
 * - Category mapping is server-owned (ledger_type → business category); every
 *   amount is read from immutable ledger rows, never recomputed client-side.
 */
import { Router } from 'express';
import { httpError, ok } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { isApprovedSeller as isSeller } from '../middleware/seller.js';

/** ledger_type + entry → frontend TransactionCategory (server-owned mapping). */
function categoryFor(txn) {
  const base = String(txn.txn_type ?? '');
  if (base === 'COD_RECEIPT' && txn.entry === 'CREDIT') return 'ORDER_REVENUE';
  if (base === 'COMMISSION' && txn.entry === 'CREDIT') return 'PLATFORM_FEE';
  if (base === 'REFUND' && txn.entry === 'DEBIT') return 'REFUND_DEDUCTION';
  if (base === 'PAYOUT' && txn.entry === 'DEBIT') return 'SETTLEMENT_PAYOUT';
  return 'CORRECTION_ADJUSTMENT'; // ADJUSTMENT or any unexpected combination
}

function descriptionFor(txn, orderNumber, isSellerViewer, productInfo) {
  const itemSuffix = productInfo ? ` — ${productInfo}` : '';
  const orderRef = orderNumber ? ` — order ${orderNumber}` : '';

  if (isSellerViewer) {
    switch (String(txn.txn_type ?? '')) {
      case 'COD_RECEIPT':
        return `Item sale proceeds credited to escrow${itemSuffix}`;
      case 'COMMISSION':
        return 'Platform marketplace commission (5%)';
      case 'REFUND':
        return `Customer refund deduction${itemSuffix}`;
      case 'PAYOUT':
        return 'Settlement payout disbursed to registered bank';
      default:
        return String(txn.metadata?.note ?? 'Escrow balance adjustment').slice(0, 300);
    }
  }

  // Admin / Treasury view
  switch (String(txn.txn_type ?? '')) {
    case 'COD_RECEIPT':
      return `COD payment collected${orderRef}`;
    case 'COMMISSION':
      return `Platform commission retained${orderRef}`;
    case 'REFUND':
      return `Customer refund payout${orderRef}`;
    case 'PAYOUT':
      return `Settlement payout released to seller${orderRef}`;
    default:
      return String(txn.metadata?.note ?? 'Treasury balance adjustment').slice(0, 300);
  }
}

export function createTransactionsRouter({ env, supabase }) {
  const router = Router();

  router.get('/transactions', requireAuth(supabase, env), async (req, res) => {
    const profile = req.auth.profile;

    const type = req.query?.type === undefined ? null : String(req.query.type).toUpperCase();
    if (type !== null && type !== 'CR' && type !== 'DR') {
      throw httpError(400, 'type must be CR or DR.');
    }

    const { data: rows, error } = await supabase.service.from('transactions').select('*');
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[transactions] query failed:', error.message);
      throw httpError(502, 'Unable to load transactions. Please try again later.');
    }
    const all = rows ?? [];

    const isSellerViewer = isSeller(profile);
    const ordersWithPayout = new Set(all.filter((t) => t.txn_type === 'PAYOUT' && t.order_id).map((t) => t.order_id));

    // Server-side scope — query params are never trusted for this (§5-77).
    let scoped = all;
    if (profile.role === 'ADMIN') {
      scoped = all.filter((t) => !(t.txn_type === 'COMMISSION' && ordersWithPayout.has(t.order_id)));
    } else if (isSellerViewer) {
      scoped = all.filter((t) => t.seller_id === profile.id && !(t.txn_type === 'COMMISSION' && ordersWithPayout.has(t.order_id)));
    } else {
      scoped = all.filter((t) => t.customer_id === profile.id);
    }
    if (type === 'CR') scoped = scoped.filter((t) => t.entry === 'CREDIT');
    if (type === 'DR') scoped = scoped.filter((t) => t.entry === 'DEBIT');

    // Join data: orders (order numbers, totals, payment method), profiles (customer/seller names), order_items (products), payouts (settlements).
    const orderIds = [...new Set(scoped.map((t) => t.order_id).filter(Boolean))];
    const profileIds = [
      ...new Set([
        ...scoped.map((t) => t.customer_id).filter(Boolean),
        ...scoped.map((t) => t.seller_id).filter(Boolean),
      ]),
    ];
    const [
      { data: orderRows = [], error: orderError },
      { data: profileRows = [], error: profileError },
      { data: itemRows = [], error: itemError },
      { data: payoutRows = [], error: payoutError },
    ] = await Promise.all([
      orderIds.length
        ? supabase.service.from('orders').select('id, order_number, total').in('id', orderIds)
        : Promise.resolve({ data: [], error: null }),
      profileIds.length
        ? supabase.service.from('profiles').select('id, full_name, email').in('id', profileIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? supabase.service.from('order_items').select('id, order_id, product_id, product_name, sku, seller_id').in('order_id', orderIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? supabase.service.from('payouts').select('id, order_id, seller_id, amount, commission_amount, status, released_at').in('order_id', orderIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (orderError) {
      // eslint-disable-next-line no-console
      console.warn('[transactions] orders join notice:', orderError.message);
    }
    if (profileError) {
      // eslint-disable-next-line no-console
      console.warn('[transactions] profiles join notice:', profileError.message);
    }
    if (itemError) {
      // eslint-disable-next-line no-console
      console.warn('[transactions] order_items join notice:', itemError.message);
    }
    if (payoutError) {
      // eslint-disable-next-line no-console
      console.warn('[transactions] payouts join notice:', payoutError.message);
    }
    const orderById = new Map(orderRows.map((o) => [o.id, o]));
    const profileById = new Map(profileRows.map((p) => [p.id, p]));
    const payoutByOrderId = new Map(payoutRows.map((p) => [p.order_id, p]));

    // Chronological order for accurate running-balance accumulation
    const chronological = [...scoped].sort((a, b) =>
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    );

    let runningAdminBalance = 0;
    let runningSellerBalance = 0;

    const computedList = chronological.map((t) => {
      const order = orderById.get(t.order_id);
      const orderNumber = order?.order_number;
      const payout = payoutByOrderId.get(t.order_id);

      const matchingItems = (itemRows ?? []).filter((it) => {
        if (it.order_id !== t.order_id) return false;
        if (isSellerViewer && t.seller_id) return it.seller_id === t.seller_id;
        return true;
      });
      const firstItem = matchingItems[0] || null;
      const productId = firstItem?.product_id || undefined;
      const productName = firstItem?.product_name || (t.txn_type === 'PAYOUT' ? 'Settlement Payout' : undefined);
      const productSku = firstItem?.sku || undefined;
      const productReference = productName
        ? `${productName}${productSku ? ` (${productSku})` : ''}`
        : (t.txn_type === 'PAYOUT' ? 'Settlement Payout' : undefined);

      // Financial breakdown:
      const grossAmount = Number(payout?.amount) || Number(order?.total) || Number(t.amount) || 0;
      const commissionRate = 5;
      const commissionAmount = payout?.commission_amount !== undefined && payout.commission_amount !== null
        ? Number(payout.commission_amount)
        : Math.round(grossAmount * 0.05 * 100) / 100;
      const netAmount = Math.max(0, Math.round((grossAmount - commissionAmount) * 100) / 100);

      const payoutReference = t.metadata?.bankReference || (payout?.id ? `WIRE-KN-${payout.id.slice(0, 8).toUpperCase()}` : (t.txn_type === 'PAYOUT' ? 'WIRE-SETTLEMENT' : undefined));
      const paymentMethod = t.txn_type === 'PAYOUT' ? 'Bank Wire (NEFT/RTGS)' : (order?.payment_method || 'Cash on Delivery (COD)');

      let displayAmount = Number(t.amount) || 0;
      let balanceAfter = Number(t.balance_after) || 0;

      if (profile.role === 'ADMIN') {
        if (t.txn_type === 'COMMISSION') {
          balanceAfter = runningAdminBalance;
        } else if (t.entry === 'CREDIT') {
          runningAdminBalance = Math.round((runningAdminBalance + displayAmount) * 100) / 100;
          balanceAfter = runningAdminBalance;
        } else {
          runningAdminBalance = Math.round((runningAdminBalance - displayAmount) * 100) / 100;
          balanceAfter = runningAdminBalance;
        }
      } else if (isSellerViewer) {
        if (t.txn_type === 'COD_RECEIPT') {
          // Seller net proceeds (95% of gross order total after 5% platform fee)
          displayAmount = netAmount;
          runningSellerBalance = Math.round((runningSellerBalance + displayAmount) * 100) / 100;
          balanceAfter = runningSellerBalance;
        } else if (t.txn_type === 'PAYOUT') {
          runningSellerBalance = Math.max(0, Math.round((runningSellerBalance - displayAmount) * 100) / 100);
          balanceAfter = runningSellerBalance;
        } else if (t.txn_type === 'COMMISSION') {
          balanceAfter = Number(t.balance_after) || runningSellerBalance;
        } else if (t.entry === 'CREDIT') {
          runningSellerBalance = Math.round((runningSellerBalance + displayAmount) * 100) / 100;
          balanceAfter = runningSellerBalance;
        } else {
          runningSellerBalance = Math.max(0, Math.round((runningSellerBalance - displayAmount) * 100) / 100);
          balanceAfter = runningSellerBalance;
        }
      }

      return {
        id: t.id,
        transactionNumber: t.txn_ref ?? '',
        referenceId: t.txn_ref ?? '',
        sellerId: t.seller_id ?? undefined,
        sellerName: (t.seller_id && profileById.get(t.seller_id)?.full_name) || undefined,
        customerId: t.customer_id ?? undefined,
        customerName: (t.customer_id && profileById.get(t.customer_id)?.full_name) || undefined,
        orderId: t.order_id ?? undefined,
        orderNumber: (t.order_id && orderNumber) || undefined,
        productId,
        productName,
        productSku,
        productReference,
        grossAmount,
        commissionRate,
        commissionAmount,
        netAmount,
        payoutReference,
        paymentMethod,
        type: t.entry === 'CREDIT' ? 'CR' : 'DR',
        category: categoryFor(t),
        description: descriptionFor(t, orderNumber, isSellerViewer, productName),
        amount: displayAmount,
        balanceAfter,
        status: t.status || 'POSTED',
        createdAt: t.created_at ? String(t.created_at) : '',
      };
    });

    const transactions = computedList.sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt))
    );

    return ok(res, { transactions });
  });

  return router;
}