/**
 * Orders READ + seller/admin status surface (Phase 9 READ side; the COD
 * order-creation phase adds POST /orders + cancellation).
 *
 * Contract (src/services/orderService.ts + src/types/order.ts):
 *   GET   /orders              → { orders: Order[] }   scoped by session
 *   GET   /orders/:id          → { order: Order }
 *   PATCH /orders/:id/status   { status: CODOrderStatus } → { order }
 *
 * Authorization (server-derived, §5-56/57/77):
 *   - ADMIN  → every order
 *   - SELLER (approved) → orders whose seller_id is this profile
 *   - CUSTOMER → orders whose customer_id is this profile
 * The legacy `customerId` / `sellerId` query params are HINTS ONLY and are
 * ignored for authorization — they can never widen or narrow access.
 *
 * Status writes (§5-55): only the order's SELLER or an ADMIN may move an
 * order; terminal states (DELIVERED / CANCELLED / RETURNED / REFUNDED)
 * are immutable. The COD→DB vocabulary is the single source of truth
 * (lib/orderShape.js).
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { HttpError, httpError, ok } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { isApprovedSeller as isSeller } from '../middleware/seller.js';
import { writeAudit } from '../lib/audit.js';
import { COD_TO_DB, DB_TO_COD, orderToFrontend, formatOrderNumber } from '../lib/orderShape.js';
import { resolveImageUrl } from '../lib/productShape.js';
import {
  sendOrderDeliveredEmail,
  sendOrderPlacedCustomerEmail,
  sendOrderPlacedAdminAlertEmail,
  sendOrderPlacedSellerAlertEmail,
  sendOrderCancelledCustomerEmail,
  sendOrderCancelledAdminAlertEmail,
  sendOrderCancelledSellerAlertEmail,
  sendOrderDeliveredAdminAlertEmail,
  sendOrderDeliveredSellerRevenueEmail,
} from '../lib/mail.js';
import { validate } from '../lib/schema.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL_DB_STATUSES = new Set(['DELIVERED', 'CANCELLED', 'RETURNED', 'REFUNDED']);
// Statuses a seller/admin may WRITE (COD_PENDING is a placement state only).
const WRITABLE_COD_STATUSES = new Set([
  'COD_CONFIRMED',
  'COD_PROCESSING',
  'COD_SHIPPED',
  'COD_DELIVERED',
  'COD_CANCELLED',
]);

// Products (with variants/seller) as read back for order placement — the
// server re-prices every line from these rows, never from the request body.
const ORDER_PRODUCT_SELECT = `
  id, name, brand, category, description, status, seller_id,
  seller:profiles!products_seller_id_fkey(status, full_name),
  variants:product_variants(id, sku, size, color, price, stock, is_active),
  images:product_images(storage_bucket, storage_path, position, is_primary, mime_type)
`;

async function fetchRowsOrThrow(supabase, table, label) {
  const { data, error } = await supabase.service.from(table).select('*');
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[orders] ${label} query failed:`, error.message);
    throw httpError(502, 'Unable to load orders. Please try again later.');
  }
  return data ?? [];
}

function hasPrivilegedOrderAccess(profile) {
  if (!profile) return false;
  const allRoles = new Set();
  if (profile.role) allRoles.add(String(profile.role).toUpperCase());
  if (Array.isArray(profile.roles)) {
    profile.roles.forEach((r) => allRoles.add(String(r).toUpperCase()));
  }
  return (
    allRoles.has('ADMIN') ||
    allRoles.has('SUPER_ADMIN') ||
    allRoles.has('DELIVERY_PERSON')
  );
}

/** Resolve which orders the authenticated profile may see. */
async function scopedOrderIds({ profile }, orders) {
  if (hasPrivilegedOrderAccess(profile)) {
    return null; // all
  }
  if (isSeller(profile)) return orders.filter((o) => o.seller_id === profile.id).map((o) => o.id);
  return orders.filter((o) => o.customer_id === profile.id).map((o) => o.id);
}

async function canActOnOrder({ profile }, order) {
  if (hasPrivilegedOrderAccess(profile)) {
    return true;
  }
  if (isSeller(profile)) return order.seller_id === profile.id;
  return false;
}

async function shapeOrders(supabase, orders, imageBase = '') {
  if (!orders.length) return [];
  const orderIds = orders.map((o) => o.id);

  let items = [];
  let profileRows = [];
  let sellerProfileRows = [];
  let products = [];
  let productImages = [];

  try {
    const res = await Promise.all([
      fetchRowsOrThrow(supabase, 'order_items', 'order items'),
      fetchRowsOrThrow(supabase, 'profiles', 'order profiles'),
      fetchRowsOrThrow(supabase, 'seller_profiles', 'order seller profiles').catch(() => []),
      fetchRowsOrThrow(supabase, 'products', 'order products').catch(() => []),
      fetchRowsOrThrow(supabase, 'product_images', 'order product images').catch(() => []),
    ]);
    items = res[0];
    profileRows = res[1];
    sellerProfileRows = res[2] || [];
    products = res[3] || [];
    productImages = res[4] || [];
  } catch (e) {
    items = await fetchRowsOrThrow(supabase, 'order_items', 'order items');
    profileRows = await fetchRowsOrThrow(supabase, 'profiles', 'order profiles');
    sellerProfileRows = await fetchRowsOrThrow(supabase, 'seller_profiles', 'order seller profiles').catch(() => []);
  }

  const itemsByOrder = new Map();
  for (const it of items) {
    if (!orderIds.includes(it.order_id)) continue;
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
    itemsByOrder.get(it.order_id).push(it);
  }
  const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]));
  const sellerProfileById = new Map((sellerProfileRows ?? []).map((sp) => [sp.profile_id, sp]));

  const getFullSeller = (sellerId) => {
    if (!sellerId) return null;
    const prof = profileById.get(sellerId);
    const sp = sellerProfileById.get(sellerId);
    if (!prof && !sp) return null;

    const storeName = sp?.store_name || prof?.seller_store_name || '';
    const sellerPersonName = sp?.seller_name || prof?.full_name || '';
    const displayName = storeName || sellerPersonName || prof?.email || 'Campus Store';
    const email = prof?.email || '';
    const phone = sp?.mobile || prof?.phone || '';
    const address = sp?.address || '';
    const storeCategory = sp?.store_category || '';

    const suffix = prof?.business_id ? String(prof.business_id).replace(/^KN[CS]R-/, '') : '';
    const sellerBusinessId = suffix ? `KNSR-${suffix}` : (prof?.business_id || '');

    return {
      id: sellerId,
      sellerBusinessId,
      storeName,
      sellerName: sellerPersonName,
      displayName,
      email,
      phone,
      address,
      storeCategory,
    };
  };

  const imagesByProduct = new Map();
  for (const img of productImages) {
    if (!imagesByProduct.has(img.product_id)) imagesByProduct.set(img.product_id, []);
    imagesByProduct.get(img.product_id).push(img);
  }

  const productMap = new Map();
  for (const p of products) {
    const rawImgs = imagesByProduct.get(p.id) || [];
    const sorted = rawImgs.slice().sort((a, b) => {
      const primary = Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary));
      if (primary !== 0) return primary;
      return (a.position ?? 0) - (b.position ?? 0);
    });
    let urls = sorted.map((img) => resolveImageUrl(img, imageBase)).filter(Boolean);

    if (!urls.length) {
      if (Array.isArray(p.images) && p.images.length > 0) {
        urls = p.images.map((img) => resolveImageUrl(img, imageBase)).filter(Boolean);
      } else if (Array.isArray(p.verification_meta?.images) && p.verification_meta.images.length > 0) {
        urls = p.verification_meta.images.map((img) => resolveImageUrl(img, imageBase)).filter(Boolean);
      } else if (typeof p.image_url === 'string' && p.image_url) {
        urls = [resolveImageUrl(p.image_url, imageBase)];
      }
    }

    const prodSeller = getFullSeller(p.seller_id);

    productMap.set(p.id, {
      ...p,
      images: urls,
      brand: p.brand || '',
      seller_name: prodSeller?.storeName || prodSeller?.sellerName || p.seller?.full_name || '',
      seller_email: prodSeller?.email || '',
      seller_phone: prodSeller?.phone || '',
      seller_business_id: prodSeller?.sellerBusinessId || '',
      seller_address: prodSeller?.address || '',
    });
  }

  return orders.map((o) => {
    const orderItems = itemsByOrder.get(o.id) ?? [];
    const sellerId = o.seller_id || orderItems[0]?.seller_id || '';
    const sellerInfo = getFullSeller(sellerId);
    return orderToFrontend(
      o,
      orderItems,
      profileById.get(o.customer_id) ?? null,
      productMap,
      sellerInfo,
    );
  });
}

export function createOrdersRouter({ env, supabase }) {
  const router = Router();
  const imageBase = String(env.SUPABASE_URL || '').replace(/\/+$/, '');

  // ── GET /orders ───────────────────────────────────────────────────────
  router.get('/orders', requireAuth(supabase, env), async (req, res) => {
    const orders = await fetchRowsOrThrow(supabase, 'orders', 'order list');
    const allowed = await scopedOrderIds(req.auth, orders);
    const visible = orders
      .filter((o) => allowed === null || allowed.includes(o.id))
      .sort((a, b) => String(b.placed_at ?? b.created_at ?? '').localeCompare(String(a.placed_at ?? a.created_at ?? '')) || a.id.localeCompare(b.id));

    const shaped = await shapeOrders(supabase, visible, imageBase);
    return ok(res, { orders: shaped });
  });

  // ── GET /orders/:id ───────────────────────────────────────────────────
  router.get('/orders/:id', requireAuth(supabase, env), async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Order not found.');

    const order = (await fetchRowsOrThrow(supabase, 'orders', 'order detail')).find((o) => o.id === id);
    // Generic 404 — never reveal whether an order with this id exists when the
    // caller may not see it (§5-56/57/77).
    if (!order) throw httpError(404, 'Order not found.');

    const allowed = await scopedOrderIds(req.auth, [order]);
    if (allowed !== null && !allowed.includes(order.id)) throw httpError(404, 'Order not found.');

    const [shaped] = await shapeOrders(supabase, [order], imageBase);
    return ok(res, { order: shaped });
  });

  // ── PATCH /orders/:id/status ──────────────────────────────────────────
  router.patch('/orders/:id/status', requireAuth(supabase, env), async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Order not found.');

    const order = (await fetchRowsOrThrow(supabase, 'orders', 'order status update')).find((o) => o.id === id);
    if (!order) throw httpError(404, 'Order not found.');

    if (!(await canActOnOrder(req.auth, order))) {
      throw httpError(403, 'Forbidden.');
    }

    const requested = String(req.body?.status ?? '').trim().toUpperCase();
    if (!WRITABLE_COD_STATUSES.has(requested)) {
      throw httpError(400, 'Invalid order status.');
    }
    const nextDb = COD_TO_DB[requested];
    if (TERMINAL_DB_STATUSES.has(order.status)) {
      throw httpError(400, 'Order status cannot be changed from its current state.');
    }

    const now = new Date().toISOString();
    const patch = { status: nextDb, updated_at: now };
    if (nextDb === 'DELIVERED') {
      patch.delivered_at = now;
      if (req.body?.collectedCod === true || req.body?.receivedAmount != null) {
        patch.received_amount = Number(req.body?.receivedAmount ?? order.total) || 0;
        patch.received_at = now;
        patch.received_by = req.auth.profile.id;
      }
    }
    if (nextDb === 'CANCELLED') {
      patch.cancelled_at = now;
      if (String(req.body?.cancelReason ?? '').trim()) patch.cancel_reason = String(req.body.cancelReason).trim();
    }

    const { error: updateError } = await supabase.service
      .from('orders')
      .update(patch)
      .eq('id', id);
    if (updateError) {
      // eslint-disable-next-line no-console
      console.error('[orders] status update failed:', updateError.message);
      throw httpError(502, 'Unable to update the order status. Please try again.');
    }

    await writeAudit(supabase, {
      actorId: req.auth.profile.id,
      actorRole: req.auth.profile.role,
      action: `order.status.${DB_TO_COD[nextDb] ?? nextDb}`,
      resourceType: 'order',
      resourceId: id,
      ip: req.ip ?? null,
      metadata: { from: order.status, to: nextDb },
    });

    if (nextDb === 'DELIVERED') {
      const orderTotal = Number(order.total) || 0;
      const commission = Math.round(orderTotal * 0.05 * 100) / 100; // 5% platform fee

      // 1. Escrow Mapping: Ensure payout row exists in payouts table mapped to seller
      try {
        if (order.seller_id && orderTotal > 0) {
          const { data: existingPayouts } = await supabase.service
            .from('payouts')
            .select('id')
            .eq('order_id', order.id);
          if (!existingPayouts || existingPayouts.length === 0) {
            await supabase.service.from('payouts').insert({
              id: crypto.randomUUID(),
              seller_id: order.seller_id,
              order_id: order.id,
              amount: orderTotal,
              commission_amount: commission,
              eligible_at: now,
              status: 'SCHEDULED',
              created_at: now,
              updated_at: now,
            });
          }
        }
      } catch (payoutErr) {
        // eslint-disable-next-line no-console
        console.error('[orders] escrow payout mapping failed:', payoutErr?.message ?? payoutErr);
      }

      // 2. Financial Passbook: Record COD receipt credit into transactions table
      try {
        if (orderTotal > 0) {
          const { data: existingTxns } = await supabase.service
            .from('transactions')
            .select('id')
            .eq('order_id', order.id)
            .eq('txn_type', 'COD_RECEIPT');

          if (!existingTxns || existingTxns.length === 0) {
            const { data: allTxns } = await supabase.service
              .from('transactions')
              .select('balance_after');
            const prevBalance = (allTxns ?? []).reduce(
              (max, t) => Math.max(max, Number(t.balance_after) || 0),
              0,
            );
            const newBalance = Math.round((prevBalance + orderTotal) * 100) / 100;

            const cryptoTxnDigits = String(crypto.randomInt(1000000000, 10000000000));
            const txnRef = `TXN-${cryptoTxnDigits}`;

            await supabase.service.from('transactions').insert({
              id: crypto.randomUUID(),
              txn_ref: txnRef,
              order_id: order.id,
              customer_id: order.customer_id,
              seller_id: order.seller_id,
              txn_type: 'COD_RECEIPT',
              entry: 'CREDIT',
              amount: orderTotal,
              commission_amount: 0,
              refund_amount: 0,
              payout_amount: 0,
              balance_after: newBalance,
              status: 'POSTED',
              actor_id: req.auth.profile.id,
              metadata: {
                note: `COD payment collected for order #${order.order_number}`,
                delivered_at: now,
              },
              created_at: now,
            });
          }
        }
      } catch (txnErr) {
        // eslint-disable-next-line no-console
        console.error('[orders] ledger transaction recording failed:', txnErr?.message ?? txnErr);
      }

      // 3. Delivery Confirmation & Escrow Revenue Emails
      try {
        const orderCode = formatOrderNumber(order.order_number, order.id);
        const { data: customerRow } = await supabase.service
          .from('profiles')
          .select('email, full_name')
          .eq('id', order.customer_id)
          .maybeSingle();

        const { data: sellerRow } = await supabase.service
          .from('seller_profiles')
          .select('store_name')
          .eq('profile_id', order.seller_id)
          .maybeSingle();

        const { data: sellerUser } = await supabase.service
          .from('profiles')
          .select('email')
          .eq('id', order.seller_id)
          .maybeSingle();

        const storeName = sellerRow?.store_name || 'Campus Merchant';
        const customerName = customerRow?.full_name || 'Valued Customer';

        if (customerRow?.email) {
          await sendOrderDeliveredEmail(env, {
            to: customerRow.email,
            orderCode,
            customerName,
            totalAmount: order.total,
          });
        }

        await sendOrderDeliveredAdminAlertEmail(env, {
          orderCode,
          customerName,
          totalAmount: order.total,
          storeName,
        });

        if (sellerUser?.email) {
          const netAmount = Math.max(0, Math.round((orderTotal - commission) * 100) / 100);
          await sendOrderDeliveredSellerRevenueEmail(env, {
            to: sellerUser.email,
            orderCode,
            storeName,
            totalAmount: order.total,
            netAmount,
          });
        }
      } catch (e) {
        // non-fatal delivery notification
      }
    }

    if (nextDb === 'CANCELLED') {
      try {
        const orderCode = formatOrderNumber(order.order_number, order.id);
        const { data: customerRow } = await supabase.service
          .from('profiles')
          .select('email, full_name')
          .eq('id', order.customer_id)
          .maybeSingle();
        const { data: sellerRow } = await supabase.service
          .from('seller_profiles')
          .select('store_name')
          .eq('profile_id', order.seller_id)
          .maybeSingle();
        const { data: sellerUser } = await supabase.service
          .from('profiles')
          .select('email')
          .eq('id', order.seller_id)
          .maybeSingle();

        const customerName = customerRow?.full_name || 'Valued Customer';
        if (customerRow?.email) {
          await sendOrderCancelledCustomerEmail(env, {
            to: customerRow.email,
            orderCode,
            customerName,
            reason: req.body?.cancelReason || 'Cancelled by merchant or operator',
          });
        }
        await sendOrderCancelledAdminAlertEmail(env, {
          orderCode,
          customerName,
          cancelledBy: req.auth.profile.role,
          reason: req.body?.cancelReason,
        });
        if (sellerUser?.email) {
          await sendOrderCancelledSellerAlertEmail(env, {
            to: sellerUser.email,
            orderCode,
            storeName: sellerRow?.store_name || 'Merchant',
            reason: req.body?.cancelReason,
          });
        }
      } catch (e) {
        // non-fatal cancel notification
      }
    }

    const updated = (await fetchRowsOrThrow(supabase, 'orders', 'order reload')).find((o) => o.id === id);
    const shaped = (await shapeOrders(supabase, [updated], imageBase))[0];
    return ok(res, { order: shaped });
  });

  // ── POST /orders (COD order creation — Phase 9 WRITE side) ────────────────
  // The server recalcs EVERY amount (subtotal/delivery fee/total) from DB
  // rows; client-supplied prices, fees, coupons and totals are never trusted
  // (§16, §5.49–53, §75). Identity comes from the session cookie only.
  const CREATE_ORDER_SCHEMA = {
    items: {
      type: 'array',
      required: true,
      label: 'Order items',
      maxItems: 50,
      arrayOf: {
        productId: { type: 'uuid', required: true, label: 'Product' },
        quantity: { type: 'integer', required: true, label: 'Quantity', minValue: 1, maxValue: 99 },
        selectedSize: { type: 'string', max: 24, label: 'Size' },
        selectedColor: { type: 'string', max: 40, label: 'Colour' },
      },
    },
    shippingAddress: {
      type: 'object',
      required: true,
      label: 'Shipping address',
      object: {
        fullName: { type: 'string', required: true, min: 2, max: 120, label: 'Recipient name' },
        phone: { type: 'phone', required: true, label: 'Recipient phone' },
        streetAddress: { type: 'string', required: true, min: 3, max: 200, label: 'Street address' },
        apartmentSuite: { type: 'string', max: 200, label: 'Apartment / suite' },
        city: { type: 'string', required: true, min: 2, max: 100, label: 'City' },
        stateOrProvince: { type: 'string', required: true, min: 2, max: 100, label: 'State' },
        postalCode: { type: 'pincode', required: true, label: 'Postal code' },
        country: { type: 'string', max: 60, label: 'Country' },
      },
    },
  };

  router.post('/orders', requireAuth(supabase, env), async (req, res) => {
    const { profile } = req.auth;
    if (profile.status && profile.status !== 'ACTIVE') {
      throw httpError(403, 'Your account is not active.');
    }
    // The order snapshot records the customer from the REAL profile row — a
    // client cannot choose who the order belongs to (§16, §2.3).
    if (!profile.full_name || !profile.phone) {
      throw httpError(400, 'Complete your customer profile before placing an order.');
    }

    const result = validate(req.body ?? {}, CREATE_ORDER_SCHEMA);
    if (!result.ok) {
      const first = Object.values(result.errors)[0];
      throw httpError(400, typeof first === 'string' ? first : 'Please review the entered details.');
    }
    const { items, shippingAddress: addr } = result.fields;

    // ── Load products + variants + seller gate (server truth) ─────────────
    const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
    const { data: productRows, error: productError } = await supabase.service
      .from('products')
      .select(ORDER_PRODUCT_SELECT)
      .in('id', productIds);
    if (productError) {
      // eslint-disable-next-line no-console
      console.error('[orders] product query failed:', productError.message);
      throw httpError(502, 'Unable to place your order. Please try again later.');
    }
    const products = productRows ?? [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const sellerIds = [...new Set(products.map((p) => p.seller_id).filter(Boolean))];
    const { data: sellerRows, error: sellerError } = await supabase.service
      .from('seller_profiles')
      .select('profile_id, verification_status')
      .in('profile_id', sellerIds.length ? sellerIds : ['00000000-0000-0000-0000-000000000000']);
    if (sellerError) {
      // eslint-disable-next-line no-console
      console.error('[orders] seller gate query failed:', sellerError.message);
      throw httpError(502, 'Unable to place your order. Please try again later.');
    }
    const approvedSellers = new Set(
      (sellerRows ?? []).filter((s) => s.verification_status === 'APPROVED').map((s) => s.profile_id),
    );

    // ── Resolve variants + re-price from the DB (never the client) ────────
    const lines = []; // { product, variant, qty, size, color, unitPrice, lineTotal }
    for (const item of items) {
      const product = productById.get(item.productId);
      if (!product || product.status !== 'APPROVED') {
        throw httpError(400, 'One of the selected products is no longer available.');
      }
      if (!approvedSellers.has(product.seller_id) || (product.seller?.status ?? '') !== 'ACTIVE') {
        throw httpError(400, 'One of the selected products is no longer available.');
      }

      const actives = (product.variants ?? []).filter((v) => v.is_active !== false);
      const pick =
        item.selectedSize === undefined && item.selectedColor === undefined
          ? actives.find((v) => v.size == null && v.color == null) ?? actives[0]
          : actives.find(
              (v) => (v.size ?? null) === (item.selectedSize ?? null) &&
                     (v.color ?? null) === (item.selectedColor ?? null),
            );
      if (!pick) {
        throw httpError(400, `The selected option for "${product.name}" is no longer available.`);
      }
      const stock = Number(pick.stock) || 0;
      if (stock < item.quantity) {
        throw httpError(
          400,
          `Only ${stock} unit${stock === 1 ? '' : 's'} of "${product.name}" left in stock.`,
        );
      }
      const unitPrice = Math.round(Number(pick.price) * 100) / 100;
      lines.push({
        product,
        variant: pick,
        qty: item.quantity,
        size: item.selectedSize ?? null,
        color: item.selectedColor ?? null,
        unitPrice,
        lineTotal: Math.round(unitPrice * item.quantity * 100) / 100,
      });
    }

    // Schema orders table has ONE seller_id per order (0001 §16) — a
    // multi-store cart is split by the customer into separate orders.
    const sellerSet = new Set(lines.map((l) => l.product.seller_id));
    if (sellerSet.size !== 1) {
      throw httpError(400, 'Checkout currently supports items from a single store at a time. Please place separate orders.');
    }
    const sellerId = [...sellerSet][0];

    const subtotal = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
    // Fee rules are SERVER-owned (env-configurable; defaults match the UI).
    const deliveryFee = subtotal > env.ORDER_FREE_SHIPPING_THRESHOLD ? 0 : env.ORDER_DELIVERY_FEE;
    const discount = 0; // coupon redemption lands in its own phase (no silent client discount)
    const total = Math.round((subtotal + deliveryFee - discount) * 100) / 100;

    const orderId = crypto.randomUUID();
    const now = new Date().toISOString();
    const shipAddress = {
      line1: addr.streetAddress,
      ...(addr.apartmentSuite ? { line2: addr.apartmentSuite } : {}),
      city: addr.city,
      state: addr.stateOrProvince,
      pincode: addr.postalCode,
      country: addr.country || 'India',
      recipient_name: addr.fullName,
      recipient_phone: addr.phone,
    };

    // Cryptographically secure unguessable order number
    // Format: KS-YYYYMMDD-XXXXXXX (7 random digits), satisfying DB schema and regexes
    const datePart = now.slice(0, 10).replace(/-/g, '');
    const cryptoOrderSuffix = String(crypto.randomInt(1000000, 10000000));
    const orderNumber = `KS-${datePart}-${cryptoOrderSuffix}`;

    try {
      const { error: orderError } = await supabase.service.from('orders').insert({
        id: orderId,
        order_number: orderNumber,
        customer_id: profile.id,
        seller_id: sellerId,
        status: 'PLACED',
        subtotal,
        delivery_fee: deliveryFee,
        discount,
        total,
        ship_address: shipAddress,
        placed_at: now,
        created_at: now,
        updated_at: now,
      });
      if (orderError) throw orderError;

      const { error: itemsError } = await supabase.service.from('order_items').insert(
        lines.map((l) => ({
          id: crypto.randomUUID(),
          order_id: orderId,
          product_id: l.product.id,
          variant_id: l.variant.id,
          seller_id: sellerId,
          product_name: l.product.name,
          sku: l.variant.sku,
          size: l.size,
          color: l.color,
          unit_price: l.unitPrice,
          quantity: l.qty,
          line_total: l.lineTotal,
          created_at: now,
        })),
      );
      if (itemsError) throw itemsError;

      // Decrement stock AFTER the order + lines are on record. Each
      // decrement re-reads the variant so a stale checkout can never drive
      // stock negative (DB CHECK stock >= 0 is the final guard, §5-41/75).
      const decremented = [];
      for (const l of lines) {
        const { data: current, error: readError } = await supabase.service
          .from('product_variants')
          .select('*')
          .eq('id', l.variant.id)
          .maybeSingle();
        if (readError) throw readError;
        if (!current || Number(current.stock) < l.qty) {
          throw httpError(
            409,
            `Sorry, only ${current ? Number(current.stock) : 0} unit${current && Number(current.stock) === 1 ? '' : 's'} of "${l.product.name}" left in stock.`,
          );
        }
        const { error: stockError } = await supabase.service
          .from('product_variants')
          .update({ stock: Number(current.stock) - l.qty, updated_at: new Date().toISOString() })
          .eq('id', l.variant.id);
        if (stockError) throw stockError;
        decremented.push({ id: l.variant.id, qty: l.qty });
      }
    } catch (err) {
      // Best-effort rollback so a failed placement leaves no ghost order.
      // orders/order_items are APPEND-ONLY in production (0002 trigger), so
      // deletion is attempted first (works in the test fake) and, when the
      // DB refuses, the order is honestly CANCELLED — never left PLACED.
      try {
        for (const d of decremented) {
          const { data: current } = await supabase.service
            .from('product_variants')
            .select('*')
            .eq('id', d.id)
            .maybeSingle()
            .catch(() => ({ data: null }));
          if (current) {
            await supabase.service
              .from('product_variants')
              .update({ stock: Number(current.stock) + d.qty })
              .eq('id', d.id)
              .catch((e) => console.error('[orders] rollback restock failed:', e?.message ?? e));
          }
        }
        await supabase.service.from('order_items').delete().eq('order_id', orderId);
        await supabase.service.from('orders').delete().eq('id', orderId);
      } catch (rollbackError) {
        // eslint-disable-next-line no-console
        console.error('[orders] rollback delete failed (append-only?):', rollbackError?.message ?? rollbackError);
        try {
          await supabase.service
            .from('orders')
            .update({
              status: 'CANCELLED',
              cancelled_at: new Date().toISOString(),
              cancel_reason: 'Placement failed — order rolled back.',
              updated_at: new Date().toISOString(),
            })
            .eq('id', orderId);
        } catch (fallbackError) {
          // eslint-disable-next-line no-console
          console.error('[orders] rollback cancel fallback failed:', fallbackError?.message ?? fallbackError);
        }
      }
      if (err instanceof HttpError) throw err;
      // eslint-disable-next-line no-console
      console.error('[orders] order placement failed:', err?.message ?? err);
      throw httpError(502, 'Unable to place your order. Please try again.');
    }

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'order.placed',
      resourceType: 'order',
      resourceId: orderId,
      ip: req.ip ?? null,
      metadata: { total, items: lines.length },
    });

    const placed = (await fetchRowsOrThrow(supabase, 'orders', 'placed order reload')).find(
      (o) => o.id === orderId,
    );
    const shaped = (await shapeOrders(supabase, [placed]))[0];

    // Trigger transactional order placement emails (non-blocking)
    (async () => {
      try {
        const orderCode = formatOrderNumber(placed?.order_number, placed?.id || orderId);
        const { data: customerRow } = await supabase.service
          .from('profiles')
          .select('email, full_name')
          .eq('id', profile.id)
          .maybeSingle();

        const { data: sellerRow } = await supabase.service
          .from('seller_profiles')
          .select('store_name')
          .eq('profile_id', sellerId)
          .maybeSingle();

        const { data: sellerUser } = await supabase.service
          .from('profiles')
          .select('email')
          .eq('id', sellerId)
          .maybeSingle();

        const customerEmail = customerRow?.email || profile.email;
        const customerName = customerRow?.full_name || profile.full_name || 'Valued Customer';
        const storeName = sellerRow?.store_name || 'Campus Merchant';

        if (customerEmail) {
          await sendOrderPlacedCustomerEmail(env, {
            to: customerEmail,
            orderCode,
            customerName,
            totalAmount: total,
            deliveryFee,
            items: lines.map((l) => ({
              productName: l.product.name,
              quantity: l.qty,
              lineTotal: l.lineTotal,
              size: l.size,
              color: l.color,
            })),
          });
        }

        await sendOrderPlacedAdminAlertEmail(env, {
          orderCode,
          customerName,
          totalAmount: total,
          itemCount: lines.length,
          storeName,
        });

        if (sellerUser?.email) {
          await sendOrderPlacedSellerAlertEmail(env, {
            to: sellerUser.email,
            orderCode,
            storeName,
            totalAmount: total,
          });
        }
      } catch (mailErr) {
        // eslint-disable-next-line no-console
        console.warn('[orders] post-order emails failed:', mailErr?.message || mailErr);
      }
    })();

    return ok(res, { order: shaped });
  });

  // ── POST /orders/:id/cancel ─────────────────────────────────────────────
  // Ownership + eligibility are re-checked server-side (§5.55/56/77); the
  // DB CHECK orders_cancelled_state keeps status ⇄ cancelled_at consistent.
  const CANCELLABLE_DB_STATUSES = new Set([
    'PLACED',
    'CONFIRMED',
    'PROCESSING',
    'READY_FOR_DELIVERY',
    'OUT_FOR_DELIVERY',
  ]);

  router.post('/orders/:id/cancel', requireAuth(supabase, env), async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Order not found.');

    const order = (await fetchRowsOrThrow(supabase, 'orders', 'order cancel lookup')).find((o) => o.id === id);
    if (!order) throw httpError(404, 'Order not found.');
    const isOwner = order.customer_id === req.auth.profile.id;
    if (!isOwner && req.auth.profile.role !== 'ADMIN') {
      // Generic 404 — never reveal the order's existence to non-owners (§5-77).
      throw httpError(404, 'Order not found.');
    }
    if (!CANCELLABLE_DB_STATUSES.has(order.status)) {
      throw httpError(400, 'This order can no longer be cancelled.');
    }
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 500)
        : null;

    const now = new Date().toISOString();
    const { error: cancelError } = await supabase.service
      .from('orders')
      .update({ status: 'CANCELLED', cancelled_at: now, cancel_reason: reason, updated_at: now })
      .eq('id', id);
    if (cancelError) {
      // eslint-disable-next-line no-console
      console.error('[orders] cancel update failed:', cancelError.message);
      throw httpError(502, 'Unable to cancel the order. Please try again.');
    }

    // Return the held stock to the variants (best-effort per line: a variant
    // deleted after placement is logged loudly, never silently skipped).
    const items = await fetchRowsOrThrow(supabase, 'order_items', 'cancel restock');
    for (const it of items.filter((i) => i.order_id === id)) {
      const { data: variant, error: readError } = await supabase.service
        .from('product_variants')
        .select('*')
        .eq('id', it.variant_id)
        .maybeSingle();
      if (readError) {
        // eslint-disable-next-line no-console
        console.error('[orders] cancel restock read failed:', readError.message);
        continue;
      }
      if (!variant) {
        // eslint-disable-next-line no-console
        console.error('[orders] cancel restock: variant missing:', it.variant_id);
        continue;
      }
      const { error: stockError } = await supabase.service
        .from('product_variants')
        .update({ stock: Number(variant.stock) + Number(it.quantity) })
        .eq('id', it.variant_id);
      if (stockError) {
        // eslint-disable-next-line no-console
        console.error('[orders] cancel restock failed:', stockError.message);
      }
    }

    await writeAudit(supabase, {
      actorId: req.auth.profile.id,
      actorRole: req.auth.profile.role,
      action: 'order.cancelled',
      resourceType: 'order',
      resourceId: id,
      ip: req.ip ?? null,
      metadata: { reason },
    });

    const updated = (await fetchRowsOrThrow(supabase, 'orders', 'cancelled order reload')).find((o) => o.id === id);
    const shaped = (await shapeOrders(supabase, [updated]))[0];

    // Trigger cancellation notifications (non-blocking)
    (async () => {
      try {
        const orderCode = formatOrderNumber(updated?.order_number, updated?.id || id);
        const { data: customerRow } = await supabase.service
          .from('profiles')
          .select('email, full_name')
          .eq('id', updated.customer_id)
          .maybeSingle();
        const { data: sellerRow } = await supabase.service
          .from('seller_profiles')
          .select('store_name')
          .eq('profile_id', updated.seller_id)
          .maybeSingle();
        const { data: sellerUser } = await supabase.service
          .from('profiles')
          .select('email')
          .eq('id', updated.seller_id)
          .maybeSingle();

        const customerName = customerRow?.full_name || 'Valued Customer';
        if (customerRow?.email) {
          await sendOrderCancelledCustomerEmail(env, {
            to: customerRow.email,
            orderCode,
            customerName,
            reason: reason || 'Customer requested cancellation',
          });
        }
        await sendOrderCancelledAdminAlertEmail(env, {
          orderCode,
          customerName,
          cancelledBy: isOwner ? 'Customer' : 'Admin',
          reason,
        });
        if (sellerUser?.email) {
          await sendOrderCancelledSellerAlertEmail(env, {
            to: sellerUser.email,
            orderCode,
            storeName: sellerRow?.store_name || 'Campus Merchant',
            reason,
          });
        }
      } catch (mailErr) {
        // eslint-disable-next-line no-console
        console.warn('[orders] cancel emails failed:', mailErr?.message || mailErr);
      }
    })();

    return ok(res, { order: shaped });
  });

  return router;
}