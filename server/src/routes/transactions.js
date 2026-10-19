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

    // Server-side scope — query params are never trusted for this (§5-77).
    let scoped = all;
    if (profile.role === 'ADMIN') {
      // all rows
    } else if (isSellerViewer) {
      scoped = all.filter((t) => t.seller_id === profile.id);
    } else {
      scoped = all.filter((t) => t.customer_id === profile.id);
    }
    if (type === 'CR') scoped = scoped.filter((t) => t.entry === 'CREDIT');
    if (type === 'DR') scoped = scoped.filter((t) => t.entry === 'DEBIT');

    // Join data: orders (order numbers), profiles (customer/seller names), order_items (products).
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
    ] = await Promise.all([
      orderIds.length
        ? supabase.service.from('orders').select('id, order_number').in('id', orderIds)
        : Promise.resolve({ data: [], error: null }),
      profileIds.length
        ? supabase.service.from('profiles').select('id, full_name, email').in('id', profileIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? supabase.service.from('order_items').select('id, order_id, product_id, product_name, sku, seller_id').in('order_id', orderIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (orderError || profileError || itemError) {
      // eslint-disable-next-line no-console
      console.error('[transactions] join query failed:', orderError?.message ?? profileError?.message ?? itemError?.message);
      throw httpError(502, 'Unable to load transactions. Please try again later.');
    }
    const orderNumberById = new Map(orderRows.map((o) => [o.id, o.order_number ?? '']));
    const profileById = new Map(profileRows.map((p) => [p.id, p]));

    const transactions = scoped
      .map((t) => {
        const orderNumber = orderNumberById.get(t.order_id);
        const matchingItems = (itemRows ?? []).filter((it) => {
          if (it.order_id !== t.order_id) return false;
          if (isSellerViewer && t.seller_id) return it.seller_id === t.seller_id;
          return true;
        });
        const firstItem = matchingItems[0] || null;
        const productId = firstItem?.product_id || undefined;
        const productName = firstItem?.product_name || undefined;
        const productSku = firstItem?.sku || undefined;
        const productReference = productName
          ? `${productName}${productSku ? ` (${productSku})` : ''}`
          : (t.txn_type === 'PAYOUT' ? 'Settlement Payout' : undefined);

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
          type: t.entry === 'CREDIT' ? 'CR' : 'DR',
          category: categoryFor(t),
          description: descriptionFor(t, orderNumber, isSellerViewer, productName),
          amount: Number(t.amount) || 0,
          balanceAfter: Number(t.balance_after) || 0,
          status: 'POSTED',
          createdAt: t.created_at ? String(t.created_at) : '',
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return ok(res, { transactions });
  });

  return router;
}