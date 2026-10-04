/**
 * Seller console (BACKEND_SPEC §10/§12/§13/§14, §22/§23/§24):
 * seller product CRUD with verified images, storefront metrics,
 * revenue chart, inventory restock, settlements + payout requests.
 * Fake Supabase, no network.
 *
 * Proves: ownership-scoped product writes (IDOR → generic 404), honest
 * status mapping (PUBLISHED → SUBMITTED; approval is admin-only), image URLs
 * verified against storage (no fabricated product_images metadata), metrics
 * recomputed from DB rows (never client numbers), restock only for owned
 * variants, payout requests validated against the available balance.
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
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

const SELLER = uid(20);      // Rohan — APPROVED seller
const OTHER_SELLER = uid(21); // Sia
const IMAGE_BASE = 'https://abc.supabase.co';

function seedSellerWorld(fake) {
  fake.helpers.seedUser({ id: SELLER, email: 'rohan@kshop.test' });
  fake.helpers.seedProfile({
    id: SELLER, email: 'rohan@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE', full_name: 'Rohan Verma', phone: '9876543220',
  });
  fake.helpers.seedSeller({ profile_id: SELLER, verification_status: 'APPROVED', store_name: 'Rohan Store' });

  fake.helpers.seedUser({ id: OTHER_SELLER, email: 'sia@kshop.test' });
  fake.helpers.seedProfile({
    id: OTHER_SELLER, email: 'sia@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE', full_name: 'Sia Kapoor', phone: '9876543221',
  });
  fake.helpers.seedSeller({ profile_id: OTHER_SELLER, verification_status: 'APPROVED', store_name: 'Sia Studio' });
}

const sellerCookie = () => `ks_access=${signedCookie(`at-${SELLER}`)}; ks_refresh=${signedCookie(`rt-${SELLER}`)}`;

// ── product catalogue CRUD ─────────────────────────────────────────────────
test('GET /seller/products lists OWN catalogue including drafts', async () => {
  const fake = createFakeSupabase();
  seedSellerWorld(fake);
  fake.helpers.seedProduct({
    id: uid(30), seller_id: SELLER, name: 'Approved Kurta', brand: 'VibeCraft', category: 'Indian Wear',
    description: 'Ready.', status: 'APPROVED',
    variants: [{ id: uid(31), product_id: uid(30), sku: 'KUR-1', price: 499, stock: 8, is_active: true }],
    images: [], seller: { status: 'ACTIVE', full_name: 'Rohan Verma' },
  });
  fake.helpers.seedRow('product_variants', { id: uid(31), product_id: uid(30), sku: 'KUR-1', price: 499, stock: 8, is_active: true });
  fake.helpers.seedProduct({
    id: uid(32), seller_id: SELLER, name: 'Draft Kurta', brand: 'VibeCraft', category: 'Indian Wear',
    description: 'WIP.', status: 'DRAFT',
    variants: [{ id: uid(33), product_id: uid(32), sku: 'KUR-2', price: 599, stock: 3, is_active: true }],
    images: [], seller: { status: 'ACTIVE', full_name: 'Rohan Verma' },
  });
  fake.helpers.seedRow('product_variants', { id: uid(33), product_id: uid(32), sku: 'KUR-2', price: 599, stock: 3, is_active: true });
  // Somebody else's product must NOT appear.
  fake.helpers.seedProduct({
    id: uid(34), seller_id: OTHER_SELLER, name: 'Silk Sari', brand: 'SiaSilk', category: 'Indian Wear',
    description: 'Others.', status: 'APPROVED',
    variants: [{ id: uid(35), product_id: uid(34), sku: 'SAR-1', price: 799, stock: 20, is_active: true }],
    images: [],
  });

  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/seller/products', { headers: { cookie: sellerCookie() } });
    assert.equal(res.status, 200);
    assert.equal(res.body.products.length, 2);
    const names = res.body.products.map((p) => p.name).sort();
    assert.deepEqual(names, ['Approved Kurta', 'Draft Kurta']);
    const approved = res.body.products.find((p) => p.name === 'Approved Kurta');
    assert.equal(approved.status, 'PUBLISHED'); // DB APPROVED → PUBLISHED
    const draft = res.body.products.find((p) => p.name === 'Draft Kurta');
    assert.equal(draft.status, 'DRAFT');
  } finally {
    server.close();
  }
});

test('POST /seller/products creates product+variant+images with VERIFIED storage objects', async () => {
  const fake = createFakeSupabase();
  seedSellerWorld(fake);
  // Pre-upload a real object to the public bucket, the way the upload route does.
  await fake.service.storage.from('product-images').upload('seller-a/pic-1.jpg', JPEG, { contentType: 'image/jpeg' });

  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/seller/products', {
      method: 'POST',
      headers: { cookie: sellerCookie() },
      body: {
        name: 'New Cotton Kurta',
        brand: 'VibeCraft',
        category: 'Indian Wear',
        price: 649,
        stock: 25,
        sku: 'NCK-01',
        images: [`${IMAGE_BASE}/storage/v1/object/public/product-images/seller-a/pic-1.jpg`],
        status: 'PUBLISHED', // → DB SUBMITTED (review pipeline)
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = res.body.product;
    assert.equal(p.name, 'New Cotton Kurta');
    assert.equal(p.status, 'DRAFT'); // SUBMITTED reads back as DRAFT until approved
    assert.equal(p.price, 649);
    assert.equal(p.images.length, 1);
    assert.match(p.images[0], /product-images\/seller-a\/pic-1\.jpg$/);

    // The DB rows carry REAL storage metadata (no fabricated mimetype).
    const images = fake.helpers.rows('product_images');
    assert.equal(images.length, 1);
    assert.equal(images[0].mime_type, 'image/jpeg');
    assert.ok(images[0].byte_size > 0);
    const variant = fake.helpers.rows('product_variants')[0];
    assert.equal(variant.sku, 'NCK-01');
    assert.equal(Number(variant.stock), 25);
  } finally {
    server.close();
  }
});

test('POST /seller/products rejects external/unverifiable image URLs', async () => {
  const fake = createFakeSupabase();
  seedSellerWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    // Unsplash-style URL — could never be verified against this project's storage.
    const res = await request(base, '/api/v1/seller/products', {
      method: 'POST',
      headers: { cookie: sellerCookie() },
      body: {
        name: 'New Kurta', brand: 'VibeCraft', category: 'Indian Wear',
        price: 649, stock: 25, sku: 'NCK-02',
        images: ['https://images.unsplash.com/photo-123'],
        status: 'PUBLISHED',
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /uploaded through the store upload flow/);
    // Nothing was written.
    assert.equal(fake.helpers.rows('products').length, 0);
  } finally {
    server.close();
  }
});

test('PUT /seller/products/:id partially updates only OWN product; cross-seller → 404', async () => {
  const fake = createFakeSupabase();
  seedSellerWorld(fake);
  fake.helpers.seedProduct({
    id: uid(30), seller_id: SELLER, name: 'Approved Kurta', brand: 'VibeCraft', category: 'Indian Wear',
    description: 'Ready.', status: 'APPROVED',
    variants: [{ id: uid(31), product_id: uid(30), sku: 'KUR-1', price: 499, stock: 8, is_active: true }],
    images: [], seller: { status: 'ACTIVE', full_name: 'Rohan Verma' },
  });
  fake.helpers.seedRow('product_variants', { id: uid(31), product_id: uid(30), sku: 'KUR-1', price: 499, stock: 8, is_active: true });
  fake.helpers.seedProduct({
    id: uid(34), seller_id: OTHER_SELLER, name: 'Silk Sari', brand: 'SiaSilk', category: 'Indian Wear',
    description: 'Others.', status: 'APPROVED',
    variants: [{ id: uid(35), product_id: uid(34), sku: 'SAR-1', price: 799, stock: 20, is_active: true }],
    images: [],
  });
  fake.helpers.seedRow('product_variants', { id: uid(35), product_id: uid(34), sku: 'SAR-1', price: 799, stock: 20, is_active: true });

  const { server, base } = await makeServer(fake);
  try {
    const updated = await request(base, `/api/v1/seller/products/${uid(30)}`, {
      method: 'PUT',
      headers: { cookie: sellerCookie() },
      body: { name: 'Premium Kurta', price: 699, stock: 12 },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.product.name, 'Premium Kurta');
    assert.equal(updated.body.product.price, 699);

    // A seller can never self-set APPROVED.
    const escalate = await request(base, `/api/v1/seller/products/${uid(30)}`, {
      method: 'PUT',
      headers: { cookie: sellerCookie() },
      body: { status: 'APPROVED' },
    });
    assert.equal(escalate.status, 400);
    // APPROVED is outside the seller-writable enum — rejected at validation
    // (the same security property the route's business rule enforces).
    assert.match(escalate.body.error.message, /Status is invalid/);

    // Cross-seller update is an IDOR → generic 404.
    const foreign = await request(base, `/api/v1/seller/products/${uid(34)}`, {
      method: 'PUT',
      headers: { cookie: sellerCookie() },
      body: { name: 'Hijacked' },
    });
    assert.equal(foreign.status, 404);
  } finally {
    server.close();
  }
});

test('DELETE /seller/products/:id soft-deletes (DRAFT + inactive variants); cross-seller → 404', async () => {
  const fake = createFakeSupabase();
  seedSellerWorld(fake);
  fake.helpers.seedProduct({
    id: uid(30), seller_id: SELLER, name: 'Retiring Kurta', brand: 'VibeCraft', category: 'Indian Wear',
    description: 'Ready.', status: 'APPROVED',
    variants: [{ id: uid(31), product_id: uid(30), sku: 'KUR-1', price: 499, stock: 8, is_active: true }],
    images: [], seller: { status: 'ACTIVE', full_name: 'Rohan Verma' },
  });
  fake.helpers.seedRow('product_variants', { id: uid(31), product_id: uid(30), sku: 'KUR-1', price: 499, stock: 8, is_active: true });
  fake.helpers.seedProduct({
    id: uid(34), seller_id: OTHER_SELLER, name: 'Silk Sari', brand: 'SiaSilk', category: 'Indian Wear',
    description: 'Others.', status: 'APPROVED',
    variants: [{ id: uid(35), product_id: uid(34), sku: 'SAR-1', price: 799, stock: 20, is_active: true }],
    images: [],
  });
  fake.helpers.seedRow('product_variants', { id: uid(35), product_id: uid(34), sku: 'SAR-1', price: 799, stock: 20, is_active: true });

  const { server, base } = await makeServer(fake);
  try {
    const foreign = await request(base, `/api/v1/seller/products/${uid(34)}`, { method: 'DELETE', headers: { cookie: sellerCookie() } });
    assert.equal(foreign.status, 404);

    const gone = await request(base, `/api/v1/seller/products/${uid(30)}`, { method: 'DELETE', headers: { cookie: sellerCookie() } });
    assert.equal(gone.status, 200);
    assert.equal(gone.body.success, true);
    const product = fake.helpers.getRow('products', uid(30));
    assert.equal(product.status, 'DRAFT'); // hidden from the public catalogue
    const variant = fake.helpers.getRow('product_variants', uid(31));
    assert.equal(variant.is_active, false);
  } finally {
    server.close();
  }
});

// ── metrics / inventory / settlements ──────────────────────────────────────
function seedBooksWorld(fake) {
  seedSellerWorld(fake);
  // Products (1 APPROVED + 1 DRAFT with a low-stock variant).
  fake.helpers.seedProduct({
    id: uid(30), seller_id: SELLER, name: 'Approved Kurta', brand: 'VibeCraft', category: 'Indian Wear',
    description: 'Ready.', status: 'APPROVED',
    variants: [{ id: uid(31), product_id: uid(30), sku: 'KUR-1', price: 499, stock: 8, is_active: true }],
    images: [], seller: { status: 'ACTIVE', full_name: 'Rohan Verma' },
  });
  fake.helpers.seedRow('product_variants', { id: uid(31), product_id: uid(30), sku: 'KUR-1', price: 499, stock: 8, is_active: true });
  fake.helpers.seedProduct({
    id: uid(32), seller_id: SELLER, name: 'Draft Kurta', brand: 'VibeCraft', category: 'Indian Wear',
    description: 'WIP.', status: 'DRAFT',
    variants: [{ id: uid(33), product_id: uid(32), sku: 'KUR-2', price: 599, stock: 3, is_active: true }],
    images: [], seller: { status: 'ACTIVE', full_name: 'Rohan Verma' },
  });
  fake.helpers.seedRow('product_variants', { id: uid(33), product_id: uid(32), sku: 'KUR-2', price: 599, stock: 3, is_active: true });

  // Orders: 1000 (delivered), 500 (cancelled → void), 2000 (delivered + open return).
  for (const [id, status, total] of [
    ['o1', 'DELIVERED', 1000],
    ['o2', 'CANCELLED', 500],
    ['o3', 'DELIVERED', 2000],
  ]) {
    fake.helpers.seedRow('orders', {
      id, customer_id: uid(10), seller_id: SELLER, status,
      subtotal: total, delivery_fee: 75, discount: 0, total,
      order_number: `KS-20260925-0000${id.slice(1)}`,
      placed_at: '2026-08-15T10:00:00Z', delivered_at: status === 'DELIVERED' ? '2026-09-05T10:00:00Z' : null,
    });
  }
  fake.helpers.seedRow('order_items', { id: 'i1', order_id: 'o1', product_id: uid(30), variant_id: uid(31), seller_id: SELLER, product_name: 'Approved Kurta', sku: 'KUR-1', unit_price: 499, quantity: 2, line_total: 998 });
  fake.helpers.seedRow('order_items', { id: 'i2', order_id: 'o3', product_id: uid(30), variant_id: uid(31), seller_id: SELLER, product_name: 'Approved Kurta', sku: 'KUR-1', unit_price: 499, quantity: 1, line_total: 499 });

  // Open return on o3 (so refundRequestsCount = 1).
  fake.helpers.seedRow('returns', {
    id: 'r1', return_number: 'RT-20260925-0000001', order_id: 'o3', customer_id: uid(10),
    reason: 'DAMAGED_ON_DELIVERY', description: 'Torn sleeve.', status: 'REQUESTED',
    requested_at: '2026-09-06T10:00:00Z',
  });

  // Payouts: 400 eligible now, 300 not yet eligible.
  fake.helpers.seedRow('payouts', {
    id: 'pay1', seller_id: SELLER, order_id: 'o1', status: 'SCHEDULED',
    amount: 400, commission_amount: 20, eligible_at: '2026-09-01T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
  });
  fake.helpers.seedRow('payouts', {
    id: 'pay2', seller_id: SELLER, order_id: 'o3', status: 'SCHEDULED',
    amount: 300, commission_amount: 15, eligible_at: '2099-01-01T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
  });

  // Passbook: this seller's revenue + commission, plus ANOTHER seller's txn.
  fake.helpers.seedRow('transactions', { id: 't1', txn_ref: 'TXN-0000000001', seller_id: SELLER, order_id: 'o1', txn_type: 'COD_RECEIPT', entry: 'CREDIT', amount: 1000, balance_after: 1000, created_at: '2026-08-16T10:00:00Z' });
  fake.helpers.seedRow('transactions', { id: 't2', txn_ref: 'TXN-0000000002', seller_id: SELLER, order_id: 'o1', txn_type: 'COMMISSION', entry: 'CREDIT', amount: 50, balance_after: 1050, created_at: '2026-08-16T10:00:00Z' });
  fake.helpers.seedRow('transactions', { id: 't3', txn_ref: 'TXN-0000000003', seller_id: OTHER_SELLER, order_id: 'oX', txn_type: 'COD_RECEIPT', entry: 'CREDIT', amount: 500, balance_after: 500, created_at: '2026-08-16T10:00:00Z' });
}

test('GET /seller/metrics aggregates from DB rows only', async () => {
  const fake = createFakeSupabase();
  seedBooksWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/seller/metrics', { headers: { cookie: sellerCookie() } });
    assert.equal(res.status, 200);
    const m = res.body.metrics;
    assert.equal(m.grossSales, 3000); // 1000 + 2000 (cancelled order excluded)
    assert.equal(m.platformFeesPaid, 50);
    assert.equal(m.netRevenue, 2950);
    assert.equal(m.pendingSettlement, 700);
    assert.equal(m.availableSettlement, 400);
    assert.equal(m.totalOrders, 3);
    assert.equal(m.activeProductsCount, 1); // only APPROVED product
    assert.equal(m.lowStockCount, 1); // v2 stock 3 ≤ 5
    assert.equal(m.refundRequestsCount, 1);
  } finally {
    server.close();
  }
});

test('GET /seller/revenue-chart returns 6 monthly buckets from server time', async () => {
  const fake = createFakeSupabase();
  seedBooksWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/seller/revenue-chart', { headers: { cookie: sellerCookie() } });
    assert.equal(res.status, 200);
    assert.equal(res.body.chartData.length, 6);
    const aug = res.body.chartData.find((d) => d.month.includes('Aug'));
    assert.equal(aug.gross, 3000); // both delivered orders placed in Aug
    assert.equal(aug.net, 2950);
    assert.equal(aug.orders, 2);
  } finally {
    server.close();
  }
});

test('GET /seller/inventory lists variants with sold quantity + status; restock via PUT is ownership-scoped', async () => {
  const fake = createFakeSupabase();
  seedBooksWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const list = await request(base, '/api/v1/seller/inventory', { headers: { cookie: sellerCookie() } });
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 2);
    const v1 = list.body.items.find((i) => i.id === uid(31));
    assert.equal(v1.productName, 'Approved Kurta');
    assert.equal(v1.availableStock, 8);
    assert.equal(v1.soldQuantity, 3); // 2 (o1) + 1 (o3), cancelled orders excluded
    assert.equal(v1.status, 'IN_STOCK'); // 8 > threshold 5
    const v2 = list.body.items.find((i) => i.id === uid(33));
    assert.equal(v2.status, 'LOW_STOCK'); // 3 ≤ 5

    // Restock an owned variant.
    const restock = await request(base, `/api/v1/seller/inventory/${uid(31)}`, {
      method: 'PUT', headers: { cookie: sellerCookie() }, body: { availableStock: 20 },
    });
    assert.equal(restock.status, 200, JSON.stringify(restock.body));
    assert.equal(restock.body.item.availableStock, 20);
    assert.equal(restock.body.item.status, 'IN_STOCK');

    // A variant the seller does not own is an IDOR → generic 404.
    fake.helpers.seedProduct({
      id: uid(34), seller_id: OTHER_SELLER, name: 'Silk Sari', brand: 'SiaSilk', category: 'Indian Wear',
      description: 'Others.', status: 'APPROVED',
      variants: [{ id: uid(35), product_id: uid(34), sku: 'SAR-1', price: 799, stock: 20, is_active: true }],
      images: [],
    });
    fake.helpers.seedRow('product_variants', { id: uid(35), product_id: uid(34), sku: 'SAR-1', price: 799, stock: 20, is_active: true });
    const foreign = await request(base, `/api/v1/seller/inventory/${uid(35)}`, {
      method: 'PUT', headers: { cookie: sellerCookie() }, body: { availableStock: 1 },
    });
    assert.equal(foreign.status, 404);
  } finally {
    server.close();
  }
});

test('settlements read from payouts; payout requests are validated against available balance', async () => {
  const fake = createFakeSupabase();
  seedBooksWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const list = await request(base, '/api/v1/seller/settlements', { headers: { cookie: sellerCookie() } });
    assert.equal(list.status, 200);
    assert.equal(list.body.settlements.length, 2);
    // STL- ref is derived from the payout id prefix (server-owned).
    assert.equal(list.body.settlements.find((s) => s.grossAmount === 400).settlementNumber, 'STL-PAY1');
    assert.equal(list.body.settlements.find((s) => s.grossAmount === 400).status, 'PENDING'); // eligible now
    assert.equal(list.body.settlements.find((s) => s.grossAmount === 300).status, 'PROCESSING'); // future eligible_at
    assert.equal(list.body.settlements.find((s) => s.grossAmount === 400).netSettlementAmount, 380); // 400 - 20 commission

    // Requesting more than the available balance is rejected.
    const tooMuch = await request(base, '/api/v1/seller/settlements/payout', {
      method: 'POST', headers: { cookie: sellerCookie() }, body: { amount: 500 },
    });
    assert.equal(tooMuch.status, 400);
    assert.match(tooMuch.body.error.message, /exceeds your available settlement balance/);

    // A valid request returns a PENDING record and is audit-logged.
    const ok2 = await request(base, '/api/v1/seller/settlements/payout', {
      method: 'POST', headers: { cookie: sellerCookie() }, body: { amount: 400 },
    });
    assert.equal(ok2.status, 200);
    assert.equal(ok2.body.settlement.status, 'PENDING');
    assert.match(ok2.body.settlement.settlementNumber, /^PRQ-/);
    assert.equal(ok2.body.settlement.grossAmount, 400);
    assert.ok(fake.helpers.auditCount() >= 1);
  } finally {
    server.close();
  }
});

test('seller console routes reject plain customers with 403', async () => {
  const fake = createFakeSupabase();
  seedSellerWorld(fake);
  fake.helpers.seedUser({ id: uid(10), email: 'aarav@kshop.test' });
  fake.helpers.seedProfile({
    id: uid(10), email: 'aarav@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER'],
    status: 'ACTIVE', full_name: 'Aarav Kumar', phone: '9876543210',
  });
  const { server, base } = await makeServer(fake);
  try {
    const cookie = `ks_access=${signedCookie(`at-${uid(10)}`)}; ks_refresh=${signedCookie(`rt-${uid(10)}`)}`;
    const res = await request(base, '/api/v1/seller/metrics', { headers: { cookie } });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});