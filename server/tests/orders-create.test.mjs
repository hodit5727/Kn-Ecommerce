/**
 * Order placement + cancellation (Phase 9 write side — POST /orders,
 * POST /orders/:id/cancel). Fake Supabase, no network.
 *
 * Proves the server actions per BACKEND_SPEC §16/§17 + §5.49–59:
 * - server-computed subtotal / delivery fee / total from DB rows (client
 *   prices, fees and totals are impossible to inject), single-store checkout
 *   guard, stock re-checked then decremented per line,
 * - ownership-scoped cancellation with stock restock, generic 404 for
 *   cross-user attempts, cancelled from pre-delivery states only.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { sign } from 'cookie-signature';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';

const SESSION_SECRET = 'y'.repeat(48);
const signedCookie = (token) => `s:${sign(token, SESSION_SECRET)}`;

const validEnv = () => ({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  BACKEND_URL: 'http://localhost:3001',
  CORS_ORIGINS: 'http://localhost:5173',
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  SESSION_SECRET: 'y'.repeat(48),
  SESSION_TTL_MINUTES: '60',
  ADMIN_BOOTSTRAP_EMAIL: 'admin@kshop.test',
});

async function makeServer(supabase) {
  const env = loadEnv(validEnv());
  const app = createApp({ env, supabase });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

const request = async (base, path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: json };
};

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CUSTOMER = uid(10);
const OTHER_CUSTOMER = uid(11);
const SELLER = uid(20);

function seedWorld(fake) {
  fake.helpers.seedUser({ id: CUSTOMER, email: 'aarav@kshop.test' });
  fake.helpers.seedProfile({
    id: CUSTOMER, email: 'aarav@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER'],
    status: 'ACTIVE', full_name: 'Aarav Kumar', phone: '9876543210',
  });
  fake.helpers.seedUser({ id: OTHER_CUSTOMER, email: 'meera@kshop.test' });
  fake.helpers.seedProfile({
    id: OTHER_CUSTOMER, email: 'meera@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER'],
    status: 'ACTIVE', full_name: 'Meera Nair', phone: '9876543211',
  });
  // Seller: CUSTOMER-role profile + APPROVED seller application (§8 promotion).
  fake.helpers.seedUser({ id: SELLER, email: 'rohan@kshop.test' });
  fake.helpers.seedProfile({
    id: SELLER, email: 'rohan@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE', full_name: 'Rohan Verma', phone: '9876543220',
  });
  fake.helpers.seedSeller({ profile_id: SELLER, verification_status: 'APPROVED', store_name: 'Rohan Store' });

  // Product rows carry the nested variants/seller shape the fake resolves
  // from the embedded-relation select; the variants ALSO exist as flat
  // product_variants rows so the per-line stock re-read works.
  const kurtaVariants = [
    { id: uid(31), product_id: uid(30), sku: 'KUR-01', size: null, color: null, price: 499, stock: 12, is_active: true },
  ];
  fake.helpers.seedProduct({
    id: uid(30), seller_id: SELLER, name: 'Blue Cotton Kurta', brand: 'VibeCraft',
    category: 'Indian Wear', description: 'Handloom cotton. True to size.', status: 'APPROVED',
    created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z',
    variants: kurtaVariants,
    images: [],
    seller: { status: 'ACTIVE', full_name: 'Rohan Verma' },
  });
  fake.helpers.seedRow('product_variants', { ...kurtaVariants[0] });

  const watchVariants = [
    { id: uid(32), product_id: uid(32), sku: 'WAT-01', size: null, color: null, price: 9999, stock: 5, is_active: true },
  ];
  fake.helpers.seedProduct({
    id: uid(32), seller_id: SELLER, name: 'Classic Watch', brand: 'TimeKeep',
    category: 'Accessories', description: 'Minimal analog watch.', status: 'APPROVED',
    created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z',
    variants: watchVariants,
    images: [],
    seller: { status: 'ACTIVE', full_name: 'Rohan Verma' },
  });
  fake.helpers.seedRow('product_variants', { ...watchVariants[0] });

  // Second seller — proves the single-store guard.
  fake.helpers.seedUser({ id: uid(21), email: 'sia@kshop.test' });
  fake.helpers.seedProfile({
    id: uid(21), email: 'sia@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE', full_name: 'Sia Kapoor', phone: '9876543221',
  });
  fake.helpers.seedSeller({ profile_id: uid(21), verification_status: 'APPROVED', store_name: 'Sia Studio' });
  const sariVariants = [
    { id: uid(33), product_id: uid(34), sku: 'SAR-01', size: null, color: null, price: 799, stock: 20, is_active: true },
  ];
  fake.helpers.seedProduct({
    id: uid(34), seller_id: uid(21), name: 'Silk Sari', brand: 'SiaSilk',
    category: 'Indian Wear', description: 'Pure silk drape.', status: 'APPROVED',
    created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z',
    variants: sariVariants, images: [],
    seller: { status: 'ACTIVE', full_name: 'Sia Kapoor' },
  });
  fake.helpers.seedRow('product_variants', { ...sariVariants[0] });
}

const customerCookie = () => `ks_access=${signedCookie(`at-${CUSTOMER}`)}; ks_refresh=${signedCookie(`rt-${CUSTOMER}`)}`;
const otherCookie = () => `ks_access=${signedCookie(`at-${OTHER_CUSTOMER}`)}; ks_refresh=${signedCookie(`rt-${OTHER_CUSTOMER}`)}`;

const ADDRESS = {
  fullName: 'Aarav Kumar',
  phone: '9876543210',
  streetAddress: '12 MG Road',
  city: 'Chennai',
  stateOrProvince: 'Tamil Nadu',
  postalCode: '600001',
  country: 'India',
};

test('POST /orders requires an authenticated session', async () => {
  const fake = createFakeSupabase();
  seedWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/orders', {
      method: 'POST',
      body: { items: [{ productId: uid(30), quantity: 1 }], shippingAddress: ADDRESS, paymentMethod: 'COD' },
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('POST /orders computes totals server-side, ignores client prices, decrements stock', async () => {
  const fake = createFakeSupabase();
  seedWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    // The client tries to smuggle prices, fees and a total — none are trusted.
    const res = await request(base, '/api/v1/orders', {
      method: 'POST',
      headers: { cookie: customerCookie() },
      body: {
        items: [
          { productId: uid(30), quantity: 2, price: 1, lineTotal: 2 },
          { productId: uid(32), quantity: 1, price: 1, lineTotal: 1 },
        ],
        shippingAddress: ADDRESS,
        paymentMethod: 'COD',
        subtotal: 3,
        deliveryFee: 0,
        total: 3,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const order = res.body.order;
    // subtotal = 499*2 + 9999 = 10997 > 10000 → free shipping (₹0).
    assert.equal(order.subtotal, 10997);
    assert.equal(order.deliveryFee, 0);
    assert.equal(order.totalAmount, 10997);
    assert.match(order.orderNumber, /^KS-\d{8}-\d{7}$/);
    assert.equal(order.orderStatus, 'COD_PENDING');
    assert.equal(order.lineItems ? order.lineItems.length : order.items.length, 2);
    assert.equal(order.items[0].product.price, 499);

    // Stock decremented on the flat variant rows.
    const kurtaVariant = fake.helpers.getRow('product_variants', uid(31));
    assert.equal(kurtaVariant.stock, 10); // 12 - 2
  } finally {
    server.close();
  }
});

test('POST /orders charges delivery fee below the free-shipping threshold', async () => {
  const fake = createFakeSupabase();
  seedWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/orders', {
      method: 'POST',
      headers: { cookie: customerCookie() },
      body: { items: [{ productId: uid(30), quantity: 1 }], shippingAddress: ADDRESS, paymentMethod: 'COD' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.order.subtotal, 499);
    assert.equal(res.body.order.deliveryFee, 75); // env default ₹75
    assert.equal(res.body.order.totalAmount, 574);
  } finally {
    server.close();
  }
});

test('POST /orders forbids multi-store checkouts with a clear 400', async () => {
  const fake = createFakeSupabase();
  seedWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/orders', {
      method: 'POST',
      headers: { cookie: customerCookie() },
      body: {
        items: [
          { productId: uid(30), quantity: 1 },
          { productId: uid(34), quantity: 1 }, // Sia's store
        ],
        shippingAddress: ADDRESS,
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /single store at a time/);
  } finally {
    server.close();
  }
});

test('POST /orders rejects quantity beyond available stock and oversized carts', async () => {
  const fake = createFakeSupabase();
  seedWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const tooMany = await request(base, '/api/v1/orders', {
      method: 'POST',
      headers: { cookie: customerCookie() },
      body: { items: [{ productId: uid(30), quantity: 200 }], shippingAddress: ADDRESS },
    });
    assert.equal(tooMany.status, 400); // above the 99-unit validator cap (UX guard)

    const outOfStock = await request(base, '/api/v1/orders', {
      method: 'POST',
      headers: { cookie: customerCookie() },
      body: { items: [{ productId: uid(32), quantity: 9 }], shippingAddress: ADDRESS },
    });
    assert.equal(outOfStock.status, 400);
    assert.match(outOfStock.body.error.message, /Only 5 units of "Classic Watch" left in stock/);
  } finally {
    server.close();
  }
});

test('POST /orders/:id/cancel restores stock and blocks non-owners (generic 404)', async () => {
  const fake = createFakeSupabase();
  seedWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const created = await request(base, '/api/v1/orders', {
      method: 'POST',
      headers: { cookie: customerCookie() },
      body: { items: [{ productId: uid(30), quantity: 3 }], shippingAddress: ADDRESS },
    });
    const orderId = created.body.order.id;
    assert.equal(created.body.order.orderStatus, 'COD_PENDING');

    // Another customer cannot cancel it — generic 404, no existence leak.
    const foreign = await request(base, `/api/v1/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { cookie: otherCookie() },
      body: { reason: 'hacked' },
    });
    assert.equal(foreign.status, 404);

    // The owner can — and the held stock comes back.
    const cancelled = await request(base, `/api/v1/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { cookie: customerCookie() },
      body: { reason: 'Changed my mind' },
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.order.orderStatus, 'COD_CANCELLED');
    const kurtaVariant = fake.helpers.getRow('product_variants', uid(31));
    assert.equal(kurtaVariant.stock, 12); // 12 - 3 + 3

    // Double-cancel is refused — the order is already terminal.
    const again = await request(base, `/api/v1/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { cookie: customerCookie() },
    });
    assert.equal(again.status, 400);
    assert.match(again.body.error.message, /can no longer be cancelled/);
  } finally {
    server.close();
  }
});

test('POST /orders/:id/cancel refuses post-delivery orders', async () => {
  const fake = createFakeSupabase();
  seedWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const orderId = uid(40);
    fake.helpers.seedRow('orders', {
      id: orderId, customer_id: CUSTOMER, seller_id: SELLER, status: 'DELIVERED',
      subtotal: 499, delivery_fee: 75, discount: 0, total: 574,
      order_number: 'KS-20260925-0000099',
      placed_at: '2026-09-10T10:00:00Z', delivered_at: '2026-09-12T10:00:00Z',
    });
    const res = await request(base, `/api/v1/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { cookie: customerCookie() },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /can no longer be cancelled/);
  } finally {
    server.close();
  }
});