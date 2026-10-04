/**
 * Seller storefront analytics + inventory + settlements (BACKEND_SPEC §24,
 * §22/§23 payout, §28 passbook). Contract (src/services/sellerService.ts):
 *
 *   GET  /seller/metrics                 → { metrics: SellerMetrics }
 *   GET  /seller/revenue-chart           → { chartData: RevenueChartDataPoint[] }
 *   GET  /seller/inventory               → { items: InventoryItem[] }
 *   PUT  /seller/inventory/:id           → { item }   body { availableStock }
 *   GET  /seller/settlements             → { settlements: SettlementRecord[] }
 *   POST /seller/settlements/payout      → { settlement } body { amount }
 *
 * Security:
 * - Every route derives the seller from the SESSION profile and gates on
 *   APPROVED seller status / SELLER role (never client-supplied ids — the
 *   service's optional `sellerId` param is deliberately ignored).
 * - ALL numbers are recomputed from DB rows (orders, transactions, payouts,
 *   variants). Nothing is client-supplied; zero-fill happens only where a
 *   state genuinely does not exist on the books yet.
 * - POST /seller/settlements/payout is a REQUEST, not a release: it validates
 *   the amount against the seller's real available balance (eligible SCHEDULED
 *   payouts), persists the request in the audit log, and returns a PENDING
 *   record. Releasing funds is the admin/backend phase-§23 step and this code
 *   never fabricates ledger/payout rows.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { httpError, ok } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { assertApprovedSeller as assertSeller } from '../middleware/seller.js';
import { writeAudit } from '../lib/audit.js';
import { validate } from '../lib/schema.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Order statuses that are VOID for revenue purposes: the customer never
 *  completes the purchase, so money never reaches the seller's books. */
const VOID_ORDER_STATUSES = new Set(['CANCELLED', 'RETURN_REQUESTED', 'RETURNED', 'REFUNDED']);
const OPEN_RETURN_STATUSES = new Set(['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED']);

async function fetchAll(supabase, table, label) {
  const { data, error } = await supabase.service.from(table).select('*');
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[seller] ${label} query failed:`, error.message);
    throw httpError(502, `Unable to load ${label}. Please try again later.`);
  }
  return data ?? [];
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Returns rows the seller actually owns (orders/order_items are seller-scoped
 *  via the FOREIGN-KEY-verified seller_id; products via eq). */
async function loadSellerData(supabase, profileId) {
  const [orders, orderItems, products, transactions, payouts, returns, refunds] = await Promise.all([
    fetchAll(supabase, 'orders', 'orders'),
    fetchAll(supabase, 'order_items', 'order items'),
    (async () => {
      const { data, error } = await supabase.service
        .from('products')
        .select('*')
        .eq('seller_id', profileId);
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[seller] products query failed:', error.message);
        throw httpError(502, 'Unable to load products. Please try again later.');
      }
      return data ?? [];
    })(),
    fetchAll(supabase, 'transactions', 'transactions'),
    (async () => {
      const { data, error } = await supabase.service
        .from('payouts')
        .select('*')
        .eq('seller_id', profileId);
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[seller] payouts query failed:', error.message);
        throw httpError(502, 'Unable to load settlements. Please try again later.');
      }
      return data ?? [];
    })(),
    fetchAll(supabase, 'returns', 'refund requests'),
    fetchAll(supabase, 'refunds', 'refunds'),
  ]);

  // Scope refund claims to THIS seller's orders (returns/refunds carry the
  // customer_id, not the seller id — the join goes through orders).
  const myOrderIds = new Set(orders.filter((o) => o.seller_id === profileId).map((o) => o.id));
  const myReturns = returns.filter((r) => myOrderIds.has(r.order_id));
  const myRefundIds = new Set(myReturns.map((r) => r.id));
  const myRefunds = refunds.filter((r) => myRefundIds.has(r.return_id));

  return { orders, orderItems, products, transactions, payouts, myReturns, myRefunds };
}

/** Computes the seller's book state — used by metrics + settlements together
 *  so both endpoints never disagree. */
function computeBooks({ orders, transactions, payouts, myReturns }, nowIso) {
  const now = new Date(nowIso).getTime();
  const nonVoided = orders.filter((o) => !VOID_ORDER_STATUSES.has(o.status));

  const grossSales = round2(nonVoided.reduce((s, o) => s + (Number(o.total) || 0), 0));
  const platformFeesPaid = round2(
    transactions
      .filter((t) => t.txn_type === 'COMMISSION' && t.entry === 'CREDIT')
      .reduce((s, t) => s + (Number(t.amount) || 0), 0),
  );
  const netRevenue = round2(grossSales - platformFeesPaid);

  const scheduled = payouts.filter((p) => p.status === 'SCHEDULED');
  const pendingSettlement = round2(scheduled.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const availableSettlement = round2(
    scheduled
      .filter((p) => new Date(p.eligible_at).getTime() <= now)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0),
  );

  const refundRequestsCount = myReturns.filter((r) => OPEN_RETURN_STATUSES.has(r.status)).length;

  return {
    grossSales,
    netRevenue,
    pendingSettlement,
    availableSettlement,
    platformFeesPaid,
    refundRequestsCount,
    scheduled,
  };
}

/** Monthly gross/net/orders for the last `months` calendar months — computed
 *  from placed_at timestamps only, never client-supplied aggregation. */
function buildRevenueChart(orders, transactions, months = 6) {
  const now = new Date();
  const buckets = new Map();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, {
      month: d.toLocaleString('en-IN', { month: 'short', year: 'numeric' }),
      gross: 0,
      fees: 0,
      orders: 0,
    });
  }
  for (const o of orders) {
    if (VOID_ORDER_STATUSES.has(o.status)) continue;
    const placed = new Date(o.placed_at ?? o.created_at);
    const key = `${placed.getFullYear()}-${String(placed.getMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.gross = round2(bucket.gross + (Number(o.total) || 0));
    bucket.orders += 1;
  }
  // Platform fees come from the passbook when it is written (§28); absent
  // rows honestly report fee = 0 for that month.
  for (const t of transactions) {
    if (t.txn_type !== 'COMMISSION' || t.entry !== 'CREDIT') continue;
    const created = new Date(t.created_at);
    const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.fees = round2(bucket.fees + (Number(t.amount) || 0));
  }
  // Month grouping is calendar-ordered for the chart.
  return [...buckets.values()].map((b) => ({
    month: b.month,
    gross: b.gross,
    net: Math.max(0, round2(b.gross - b.fees)),
    orders: b.orders,
  }));
}

/** Inventory rows: one per ACTIVE variant of the seller's products. */
async function buildInventory(supabase, profileId, orders, orderItems, products, lowStockThreshold) {
  const threshold = Math.max(1, Number(lowStockThreshold) || 5);
  const myProducts = products.filter((p) => p.seller_id === profileId);
  const productById = new Map(myProducts.map((p) => [p.id, p]));
  const productIds = myProducts.map((p) => p.id);

  let variants = [];
  if (productIds.length) {
    const { data, error } = await supabase.service
      .from('product_variants')
      .select('*')
      .in('product_id', productIds);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[seller] variants query failed:', error.message);
      throw httpError(502, 'Unable to load inventory. Please try again later.');
    }
    variants = data ?? [];
  }

  const orderStatusById = new Map(orders.map((o) => [o.id, o.status]));
  const soldByVariant = new Map();
  for (const it of orderItems) {
    if (VOID_ORDER_STATUSES.has(orderStatusById.get(it.order_id))) continue;
    const key = it.variant_id;
    soldByVariant.set(key, (soldByVariant.get(key) ?? 0) + (Number(it.quantity) || 0));
  }

  return variants
    .filter((v) => v.is_active !== false)
    .map((v) => {
      const product = productById.get(v.product_id);
      const stock = Number(v.stock) || 0;
      const isLow = stock > 0 && stock <= threshold;
      return {
        id: v.id,
        productId: v.product_id,
        productName: product?.name ?? '',
        sku: v.sku ?? '',
        category: product?.category ?? '',
        price: round2(v.price),
        availableStock: stock,
        reservedStock: 0, // no reservation model exists in the schema yet — honest zero
        soldQuantity: soldByVariant.get(v.id) ?? 0,
        lowStockThreshold: threshold,
        isLowStock: isLow,
        status: stock === 0 ? 'OUT_OF_STOCK' : isLow ? 'LOW_STOCK' : 'IN_STOCK',
        updatedAt: v.updated_at ? String(v.updated_at) : '',
      };
    });
}

function settlementFromPayout(payout, sellerName, nowIso) {
  const eligible = new Date(payout.eligible_at);
  const periodStart = new Date(eligible.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const releasable = eligible.getTime() <= new Date(nowIso).getTime();
  return {
    id: payout.id,
    // Server-derived reference — never client-supplied.
    settlementNumber: `STL-${String(payout.id).slice(0, 8).toUpperCase()}`,
    sellerId: payout.seller_id,
    sellerName,
    periodStart,
    periodEnd: payout.eligible_at ? String(payout.eligible_at) : '',
    grossAmount: round2(payout.amount),
    platformFee: round2(payout.commission_amount ?? 0),
    netSettlementAmount: round2((Number(payout.amount) || 0) - (Number(payout.commission_amount) || 0)),
    status:
      payout.status === 'RELEASED'
        ? 'COMPLETED'
        : payout.status === 'CANCELLED'
          ? 'FAILED'
          : releasable
            ? 'PENDING'
            : 'PROCESSING',
    createdAt: payout.created_at ? String(payout.created_at) : '',
    processedAt: payout.released_at ? String(payout.released_at) : undefined,
  };
}

export function createSellerRouter({ env, supabase }) {
  const router = Router();

  router.use('/seller', requireAuth(supabase, env), (req, _res, next) => {
    try {
      if (req.auth.profile?.role === 'ADMIN' && (req.path.includes('settlements') || req.originalUrl?.includes('settlements'))) {
        return next();
      }
      assertSeller(req.auth.profile);
      return next();
    } catch (err) {
      return next(err);
    }
  });

  // ── GET /seller/metrics ──────────────────────────────────────────────────
  router.get('/seller/metrics', async (req, res) => {
    const profile = req.auth.profile;
    const nowIso = new Date().toISOString();
    const { orders, orderItems, products, transactions, payouts, myReturns } = await loadSellerData(
      supabase,
      profile.id,
    );
    const books = computeBooks({ orders, transactions, payouts, myReturns }, nowIso);

    const activeProductsCount = products.filter((p) => p.status === 'APPROVED').length;

    const productIds = products.map((p) => p.id);
    let lowStockCount = 0;
    if (productIds.length) {
      const { data: variants = [], error } = await supabase.service
        .from('product_variants')
        .select('*')
        .in('product_id', productIds);
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[seller] low-stock variants query failed:', error.message);
        throw httpError(502, 'Unable to load stock levels. Please try again later.');
      }
      lowStockCount = variants.filter(
        (v) => v.is_active !== false && (Number(v.stock) || 0) <= env.ORDER_LOW_STOCK_THRESHOLD,
      ).length;
    }

    return ok(res, {
      metrics: {
        grossSales: books.grossSales,
        netRevenue: books.netRevenue,
        pendingSettlement: books.pendingSettlement,
        availableSettlement: books.availableSettlement,
        totalOrders: orders.length,
        activeProductsCount,
        lowStockCount,
        refundRequestsCount: books.refundRequestsCount,
        platformFeesPaid: books.platformFeesPaid,
      },
    });
  });

  // ── GET /seller/revenue-chart (last 6 calendar months) ───────────────────
  router.get('/seller/revenue-chart', async (req, res) => {
    const profile = req.auth.profile;
    const { orders, transactions } = await loadSellerData(supabase, profile.id);
    const myOrders = orders.filter((o) => o.seller_id === profile.id);
    const chartData = buildRevenueChart(myOrders, transactions);
    return ok(res, { chartData });
  });

  // ── GET /seller/inventory ────────────────────────────────────────────────
  router.get('/seller/inventory', async (req, res) => {
    const profile = req.auth.profile;
    const { orders, orderItems, products } = await loadSellerData(supabase, profile.id);
    const items = await buildInventory(
      supabase,
      profile.id,
      orders,
      orderItems,
      products,
      env.ORDER_LOW_STOCK_THRESHOLD,
    );
    return ok(res, { items });
  });

  // ── PUT /seller/inventory/:id — restock a variant the seller owns ────────
  const STOCK_SCHEMA = {
    availableStock: { type: 'integer', required: true, label: 'Available stock', minValue: 0, maxValue: 100000 },
  };

  router.put('/seller/inventory/:id', async (req, res) => {
    const profile = req.auth.profile;
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Inventory item not found.');

    const result = validate(req.body ?? {}, STOCK_SCHEMA);
    if (!result.ok) {
      const first = Object.values(result.errors)[0];
      throw httpError(400, typeof first === 'string' ? first : 'Please review the entered details.');
    }

    const { data: variant, error: readError } = await supabase.service
      .from('product_variants')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (readError) {
      // eslint-disable-next-line no-console
      console.error('[seller] inventory read failed:', readError.message);
      throw httpError(502, 'Unable to load the inventory item. Please try again.');
    }
    if (!variant) throw httpError(404, 'Inventory item not found.');

    const { data: product, error: productError } = await supabase.service
      .from('products')
      .select('*')
      .eq('id', variant.product_id)
      .maybeSingle();
    if (productError) {
      // eslint-disable-next-line no-console
      console.error('[seller] inventory product read failed:', productError.message);
      throw httpError(502, 'Unable to load the inventory item. Please try again.');
    }
    if (!product || product.seller_id !== profile.id) {
      // Cross-seller stock editing is IDOR — generic 404 (§5-34/77).
      throw httpError(404, 'Inventory item not found.');
    }

    const { error: updateError } = await supabase.service
      .from('product_variants')
      .update({ stock: result.fields.availableStock, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) {
      // eslint-disable-next-line no-console
      console.error('[seller] inventory update failed:', updateError.message);
      throw httpError(502, 'Unable to update stock. Please try again.');
    }

    const { orders, orderItems, products } = await loadSellerData(supabase, profile.id);
    const items = await buildInventory(
      supabase,
      profile.id,
      orders,
      orderItems,
      products,
      env.ORDER_LOW_STOCK_THRESHOLD,
    );
    const item = items.find((i) => i.id === id) ?? null;
    return ok(res, { item });
  });

  // ── GET /seller/settlements ──────────────────────────────────────────────
  router.get('/seller/settlements', async (req, res) => {
    const profile = req.auth.profile;
    const nowIso = new Date().toISOString();
    const isAdmin = profile.role === 'ADMIN';

    let payouts = [];
    let sellersMap = new Map();

    if (isAdmin) {
      payouts = await fetchAll(supabase, 'payouts', 'all payouts');
      const profiles = await fetchAll(supabase, 'profiles', 'all profiles');
      sellersMap = new Map(profiles.map((p) => [p.id, p.full_name || p.seller_store_name || 'Artisan']));
    } else {
      const data = await loadSellerData(supabase, profile.id);
      payouts = data.payouts ?? [];
      const sellerName = profile.full_name || profile.seller_store_name || '';
      sellersMap.set(profile.id, sellerName);
    }

    const settlements = (payouts ?? [])
      .map((p) => {
        const sName = sellersMap.get(p.seller_id) || profile.full_name || profile.seller_store_name || '';
        return settlementFromPayout(p, sName, nowIso);
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return ok(res, { settlements });
  });

  // ── POST /seller/settlements/payout — validated REQUEST (admin releases) ─
  const PAYOUT_SCHEMA = {
    amount: { type: 'number', required: true, label: 'Amount', minValue: 0.01, maxValue: 1000000000 },
  };

  router.post('/seller/settlements/payout', async (req, res) => {
    const profile = req.auth.profile;
    const nowIso = new Date().toISOString();
    const { payouts } = await loadSellerData(supabase, profile.id);
    const books = computeBooks({ orders: [], transactions: [], payouts, myReturns: [] }, nowIso);
    const available = books.availableSettlement;

    const result = validate(req.body ?? {}, PAYOUT_SCHEMA);
    if (!result.ok) {
      const first = Object.values(result.errors)[0];
      throw httpError(400, typeof first === 'string' ? first : 'Please review the entered details.');
    }
    const amount = round2(result.fields.amount);
    if (amount > available) {
      throw httpError(
        400,
        `The requested amount (₹${amount.toLocaleString('en-IN')}) exceeds your available settlement balance (₹${available.toLocaleString('en-IN')}).`,
      );
    }
    if (available <= 0) {
      throw httpError(400, 'No settlement funds are available yet.');
    }

    // Persisted REQUEST — the actual release stays in the admin/backend §23
    // flow; this endpoint never writes payout/ledger rows it cannot back.
    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'seller.payout.rsRequested',
      resourceType: 'settlement',
      resourceId: null,
      ip: req.ip ?? null,
      metadata: { amount, availableBalance: available },
    });

    const releasablePayouts = (payouts ?? []).filter(
      (p) => p.status === 'SCHEDULED' && new Date(p.eligible_at).getTime() <= new Date(nowIso).getTime(),
    );
    const sellerName = profile.full_name || profile.seller_store_name || '';
    const firstEligible = releasablePayouts.length
      ? releasablePayouts.reduce((a, b) =>
          new Date(a.eligible_at).getTime() < new Date(b.eligible_at).getTime() ? a : b,
        )
      : null;
    const requestRef = `PRQ-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    return ok(res, {
      settlement: {
        id: requestRef,
        settlementNumber: requestRef,
        sellerId: profile.id,
        sellerName,
        periodStart: firstEligible ? settlementFromPayout(firstEligible, sellerName, nowIso).periodStart : nowIso,
        periodEnd: firstEligible ? String(firstEligible.eligible_at) : nowIso,
        grossAmount: amount,
        // The per-order commission split is applied at release (§23) — no
        // fabricated fees are reported on the request.
        platformFee: 0,
        netSettlementAmount: amount,
        status: 'PENDING',
        createdAt: nowIso,
      },
    });
  });

  return router;
}