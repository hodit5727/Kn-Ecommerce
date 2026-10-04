/**
 * DB order row (snake_case) → frontend Order contract
 * (src/types/order.ts, camelCase).
 *
 * The DB `order_status` enum has nine states (§17) while the frontend speaks
 * six COD states (COD_PENDING … COD_CANCELLED). The mapping below is
 * explicit and documented so it can never be mistaken for an invented value.
 *
 * Post-delivery states (RETURN_REQUESTED / RETURNED / REFUNDED) have no COD
 * equivalent: they surface as the nearest truthful COD state, and once the
 * money leaves the order (REFUNDED) the paymentStatus becomes VOID_CANCELLED.
 *
 * This module only SHAPES — visibility/ownership is decided in
 * routes/orders.js (§5-56/57: customer → own orders, seller → own-store
 * orders, admin → all).
 */
export const DB_TO_COD = Object.freeze({
  PLACED: 'COD_PENDING',
  CONFIRMED: 'COD_CONFIRMED',
  PROCESSING: 'COD_PROCESSING',
  READY_FOR_DELIVERY: 'COD_PROCESSING',
  OUT_FOR_DELIVERY: 'COD_SHIPPED',
  DELIVERED: 'COD_DELIVERED',
  CANCELLED: 'COD_CANCELLED',
  // Post-delivery dispute states — no COD slot exists for them.
  RETURN_REQUESTED: 'COD_PROCESSING', // in-flight return claim
  RETURNED: 'COD_DELIVERED', // was delivered, then physically returned
  REFUNDED: 'COD_DELIVERED', // was delivered; money already refunded
});

/** The six COD states a seller/admin may WRITE via PATCH /orders/:id/status. */
export const COD_TO_DB = Object.freeze({
  COD_PENDING: 'PLACED',
  COD_CONFIRMED: 'CONFIRMED',
  COD_PROCESSING: 'PROCESSING',
  COD_SHIPPED: 'OUT_FOR_DELIVERY',
  COD_DELIVERED: 'DELIVERED',
  COD_CANCELLED: 'CANCELLED',
});

const slugify = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

function toPaymentStatus(order) {
  if (order.status === 'CANCELLED' || order.status === 'REFUNDED' || order.status === 'RETURNED') {
    return 'VOID_CANCELLED';
  }
  if (order.status === 'DELIVERED' && order.received_amount != null) {
    return 'COLLECTED_COD';
  }
  return 'UNPAID_COD';
}

/** Cancellable while non-terminal only (full per-phase window rules come
 *  with the order lifecycle phase; this is the honest non-flow default). */
function isEligibleForCancel(order) {
  return ['PLACED', 'CONFIRMED', 'PROCESSING', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY'].includes(
    order.status,
  );
}

/** Return & refund eligible within 7 days of delivery (§22). */
function isEligibleForRefund(order) {
  if (order.status !== 'DELIVERED' || !order.delivered_at) return false;
  const deliveredAt = new Date(order.delivered_at).getTime();
  if (!Number.isFinite(deliveredAt)) return false;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const eligibilityDay = Math.floor((Date.now() - deliveredAt) / DAY_MS) + 1;
  return eligibilityDay <= 7;
}

/** Timeline is reconstructed ONLY from real DB timestamps (placed/delivered/
 *  cancelled/updated) — never fabricated (§5-88). */
export function buildOrderTimeline(order) {
  const events = [];
  const seen = new Set(['COD_PENDING']);
  const str = (v) => (v ? String(v) : '');
  events.push({
    status: 'COD_PENDING',
    timestamp: str(order.placed_at ?? order.created_at),
    description: 'Order placed',
  });
  if (order.delivered_at) {
    seen.add('COD_DELIVERED');
    events.push({
      status: 'COD_DELIVERED',
      timestamp: str(order.delivered_at),
      description: 'Order delivered',
    });
  }
  if (order.cancelled_at) {
    seen.add('COD_CANCELLED');
    events.push({
      status: 'COD_CANCELLED',
      timestamp: str(order.cancelled_at),
      description: order.cancel_reason ? `Cancelled: ${order.cancel_reason}` : 'Order cancelled',
    });
  }
  const current = DB_TO_COD[order.status] ?? 'COD_PENDING';
  if (!seen.has(current)) {
    events.push({
      status: current,
      timestamp: str(order.updated_at ?? order.created_at),
      description: `Status updated to ${current.replace('COD_', '')}`,
    });
  }
  return events;
}

/**
 * @param {object} order  orders row
 * @param {Array}  items  order_items rows for this order (line snapshots)
 * @param {object|null} customer profiles row (name/email/phone snapshot)
 */
export function formatOrderNumber(rawOrderNumber, orderId) {
  if (rawOrderNumber && String(rawOrderNumber).startsWith('KNOR-')) {
    return String(rawOrderNumber);
  }
  const match = String(rawOrderNumber ?? '').match(/\d{4}$/);
  if (match) return `KNOR-${match[0]}`;
  const hex = String(orderId ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
  const num = hex ? (parseInt(hex, 16) % 9000 + 1000) : 1001;
  return `KNOR-${num}`;
}

export function orderToFrontend(order, items = [], customer = null, productMap = null, seller = null) {
  if (!order) return null;
  const ship = order.ship_address && typeof order.ship_address === 'object' ? order.ship_address : {};

  // Line snapshots → CartItem shape. The product object carries fields
  // populated from the immutable line snapshot + joined product metadata/images.
  const lineItems = (Array.isArray(items) ? items : []).map((it) => {
    const prod = productMap?.get(it.product_id);
    return {
      id: it.id,
      product: {
        id: it.product_id,
        name: it.product_name,
        slug: slugify(it.product_name) || String(it.product_id ?? ''),
        tagline: '',
        description: prod?.description || '',
        price: Number(it.unit_price) || 0,
        category: prod?.category || '',
        images: (Array.isArray(prod?.images) && prod.images.length > 0)
          ? prod.images
          : (it.image_url ? [it.image_url] : (it.metadata?.image ? [it.metadata.image] : [])),
        sku: it.sku ?? '',
        rating: 0,
        reviewCount: 0,
        sellerId: it.seller_id || seller?.id || prod?.seller_id || '',
        sellerName: prod?.seller_name || seller?.storeName || seller?.sellerName || seller?.displayName || '',
        sellerEmail: prod?.seller_email || seller?.email || '',
        sellerPhone: prod?.seller_phone || seller?.phone || '',
        sellerBusinessId: prod?.seller_business_id || seller?.sellerBusinessId || '',
        sellerAddress: prod?.seller_address || seller?.address || '',
        sellerRating: 0,
        specifications: [],
        deliveryEstimateDays: 0,
        returnPolicyDays: 0,
        status: 'PUBLISHED', // this line existed in a placed order
        createdAt: '',
        updatedAt: '',
      },
      quantity: Number(it.quantity) || 0,
      selectedSize: it.size ?? undefined,
      selectedColor: it.color ?? undefined,
      addedAt: String(it.created_at ?? order.placed_at ?? ''),
    };
  });

  const customerSuffix = customer?.business_id ? String(customer.business_id).replace(/^KN[CS]R-/, '') : '';
  const customerBusinessId = customerSuffix ? `KNCR-${customerSuffix}` : (customer?.business_id ?? '');
  const customerPhone = customer?.phone || ship.phone || '';

  const sellerStoreName = seller?.storeName || seller?.seller_store_name || lineItems[0]?.product?.sellerName || '';
  const sellerPersonName = seller?.sellerName || seller?.full_name || '';
  const sellerDisplayName = sellerStoreName || sellerPersonName || seller?.displayName || 'Campus Store';
  const sellerEmail = seller?.email || lineItems[0]?.product?.sellerEmail || '';
  const sellerPhone = seller?.phone || lineItems[0]?.product?.sellerPhone || '';
  const sellerAddress = seller?.address || lineItems[0]?.product?.sellerAddress || '';
  const sellerBusinessId = seller?.sellerBusinessId || lineItems[0]?.product?.sellerBusinessId || '';

  return {
    id: order.id,
    orderNumber: order.order_number,
    orderCode: formatOrderNumber(order.order_number, order.id),
    customerId: order.customer_id,
    customerBusinessId,
    customerName: customer?.full_name ?? '',
    customerEmail: customer?.email ?? '',
    customerPhone,
    sellerId: seller?.id || order.seller_id || '',
    sellerBusinessId,
    sellerName: sellerDisplayName,
    sellerStoreName,
    sellerPersonName,
    sellerEmail,
    sellerPhone,
    sellerAddress,
    items: lineItems,
    shippingAddress: {
      fullName: customer?.full_name ?? '',
      phone: customerPhone,
      streetAddress: ship.line1 ?? '',
      apartmentSuite: ship.line2 ?? undefined,
      city: ship.city ?? '',
      stateOrProvince: ship.state ?? '',
      postalCode: ship.pincode ?? '',
      country: ship.country ?? 'India',
    },
    subtotal: Number(order.subtotal) || 0,
    deliveryFee: Number(order.delivery_fee) || 0,
    discount: Number(order.discount) || 0,
    totalAmount: Number(order.total) || 0,
    paymentMethod: 'CASH_ON_DELIVERY',
    paymentStatus: toPaymentStatus(order),
    orderStatus: DB_TO_COD[order.status] ?? 'COD_PENDING',
    isEligibleForCancel: isEligibleForCancel(order),
    isEligibleForRefund: isEligibleForRefund(order),
    timeline: buildOrderTimeline(order),
    cancellationReason: order.cancel_reason ?? undefined,
    createdAt: String(order.created_at ?? ''),
    updatedAt: String(order.updated_at ?? ''),
  };
}