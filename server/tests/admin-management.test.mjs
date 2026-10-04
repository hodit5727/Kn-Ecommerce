/**
 * Phase 8/9 — admin management (stats, customers, sellers, products) and the
 * scoped orders READ/status surface. Fake Supabase, no network.
 *
 * Proves the server-side behaviour: ADMIN-only authorization, real DB
 * aggregates (never client counts), server-side pagination/search, verified
 * status toggles + accreditation + audit records, session-scoped order lists
 * and immutable terminal order states.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { sign } from 'cookie-signature';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';

const SESSION_SECRET = 'y'.repeat(48); // must match validEnv()
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
  return { status: res.status, body: json, headers: res.headers };
};

function cookieJar(res) {
  const jar = {};
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return jar;
}
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

// Deterministic UUIDs (a12 = 000000000001 …).
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function loginAdmin(base) {
  const res = await request(base, '/api/v1/admin/auth/login', {
    method: 'POST',
    body: { email: 'root@kshop.test', password: 'AdminPass#123' },
  });
  assert.equal(res.status, 200, 'admin login must succeed');
  return cookieJar(res);
}

/**
 * Customer session — seed the fake auth user + session and hand back signed
 * cookies (the browser-visible shape). The backend re-validates the token via
 * getUser() server-side, exactly like a real login.
 */
function seededSession(fake, userId, email) {
  fake.helpers.seedUser({ id: userId, email });
  return {
    ks_access: signedCookie(`at-${userId}`),
    ks_refresh: signedCookie(`rt-${userId}`),
  };
}

/** Seed admin + a full world of customers, sellers, products, orders. */
function seedWorld(fake) {
  fake.helpers.seedUser({ id: 'adm-1', email: 'root@kshop.test' });
  fake.helpers.seedProfile({
    id: 'adm-1', email: 'root@kshop.test', role: 'ADMIN', status: 'ACTIVE',
    roles: ['ADMIN'], full_name: 'Root Admin', created_at: '2026-08-01T00:00:00Z',
  });

  // Customers
  fake.helpers.seedProfile({
    id: uid(10), email: 'aarav@kshop.test', phone: '9876543210', role: 'CUSTOMER',
    roles: ['CUSTOMER'], status: 'ACTIVE', full_name: 'Aarav Kumar',
    business_id: 'KNCR-1234',
    created_at: '2026-09-01T10:00:00Z',
  });
  fake.helpers.seedProfile({
    id: uid(11), email: 'meera@kshop.test', phone: '9876543211', role: 'CUSTOMER',
    roles: ['CUSTOMER'], status: 'ACTIVE', full_name: 'Meera Nair',
    created_at: '2026-09-02T10:00:00Z',
  });
  // Sellers are CUSTOMER-role profiles (+ SELLER after approval) — §8.
  fake.helpers.seedProfile({
    id: uid(20), email: 'rohan@kshop.test', phone: '9876543220', role: 'CUSTOMER',
    roles: ['CUSTOMER', 'SELLER'], status: 'ACTIVE', full_name: 'Rohan Verma',
    created_at: '2026-08-20T10:00:00Z',
  });
  fake.helpers.seedProfile({
    id: uid(21), email: 'sia@kshop.test', phone: '9876543221', role: 'CUSTOMER',
    roles: ['CUSTOMER'], status: 'ACTIVE', full_name: 'Sia Kapoor',
    created_at: '2026-08-21T10:00:00Z',
  });
  fake.helpers.seedProfile({
    id: uid(22), email: 'kaav@kshop.test', phone: '9876543222', role: 'CUSTOMER',
    roles: ['CUSTOMER'], status: 'ACTIVE', full_name: 'Kaav Iyer',
    created_at: '2026-08-22T10:00:00Z',
  });

  // Seller applications
  fake.helpers.seedSeller({
    profile_id: uid(20), store_name: 'Rohan Atelier', seller_name: 'Rohan Verma',
    mobile: '9876543220', address: 'Store Street 1', store_category: 'Home Decor',
    verification_status: 'APPROVED', submitted_at: '2026-08-20T11:00:00Z',
    reviewed_at: '2026-08-22T11:00:00Z', created_at: '2026-08-20T10:00:00Z',
  });
  fake.helpers.seedSeller({
    profile_id: uid(21), store_name: 'Sia Studio', seller_name: 'Sia Kapoor',
    mobile: '9876543221', address: 'Store Street 2', store_category: 'Fashion',
    verification_status: 'PENDING', submitted_at: '2026-08-21T11:00:00Z',
    created_at: '2026-08-21T10:00:00Z',
  });
  fake.helpers.seedSeller({
    profile_id: uid(22), store_name: 'Kaav Craft', seller_name: 'Kaav Iyer',
    mobile: '9876543222', address: 'Store Street 3', store_category: 'Jewellery',
    verification_status: 'PENDING', submitted_at: '2026-08-22T11:00:00Z',
    created_at: '2026-08-22T10:00:00Z',
  });

  // Products (one APPROVED, one DRAFT)
  fake.helpers.seedProduct({
    id: uid(40), seller_id: uid(20), name: 'Brass Table Lamp', brand: 'LiteHome',
    category: 'Home Decor', description: 'Handcrafted brass lamp.',
    status: 'APPROVED', created_at: '2026-08-25T10:00:00Z', updated_at: '2026-08-25T10:00:00Z',
  });
  fake.helpers.seedProduct({
    id: uid(42), seller_id: uid(21), name: 'Silk Cushion', brand: 'Weave',
    category: 'Fashion', description: 'Handloom silk cushion.',
    status: 'DRAFT', created_at: '2026-08-26T10:00:00Z', updated_at: '2026-08-26T10:00:00Z',
  });
  fake.helpers.seedRow('product_variants', {
    id: uid(41), product_id: uid(40), sku: 'LAMP-BR-1', size: null, color: 'Brass',
    price: 1000, stock: 5, is_active: true, created_at: '2026-08-25T10:00:00Z',
  });
  fake.helpers.seedRow('product_variants', {
    id: uid(43), product_id: uid(42), sku: 'CUSH-S-1', size: 'M', color: 'Indigo',
    price: 400, stock: 3, is_active: true, created_at: '2026-08-26T10:00:00Z',
  });
  fake.helpers.seedRow('product_images', {
    id: uid(44), product_id: uid(40), storage_bucket: 'product-images',
    storage_path: 'lamp/img1.jpg', position: 0, is_primary: true, mime_type: 'image/jpeg',
    byte_size: 20000, created_at: '2026-08-25T10:00:00Z',
  });

  // Orders (statuses cover terminal + in-flight + cross-seller)
  fake.helpers.seedRow('orders', {
    id: uid(1), order_number: 'KS-20260901-0000001', customer_id: uid(10), seller_id: uid(20),
    status: 'DELIVERED', subtotal: 1000, delivery_fee: 50, discount: 0, total: 1050,
    ship_address: { line1: 'Hostel A, College Road', city: 'Madurai', pincode: '625001' },
    placed_at: '2026-09-01T09:00:00Z', delivered_at: '2026-09-03T09:00:00Z',
    received_amount: 1050, received_at: '2026-09-03T09:05:00Z',
    created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-03T09:05:00Z',
  });
  fake.helpers.seedRow('orders', {
    id: uid(2), order_number: 'KS-20260920-0000002', customer_id: uid(10), seller_id: uid(20),
    status: 'PLACED', subtotal: 900, delivery_fee: 0, discount: 0, total: 900,
    ship_address: { line1: 'Hostel B', city: 'Madurai', pincode: '625002' },
    placed_at: '2026-09-20T09:00:00Z', created_at: '2026-09-20T09:00:00Z',
    updated_at: '2026-09-20T09:00:00Z',
  });
  fake.helpers.seedRow('orders', {
    id: uid(3), order_number: 'KS-20260919-0000003', customer_id: uid(11), seller_id: uid(21),
    status: 'CONFIRMED', subtotal: 400, delivery_fee: 0, discount: 0, total: 400,
    ship_address: { line1: 'Flat 3, Lake View', city: 'Chennai', pincode: '600001' },
    placed_at: '2026-09-19T09:00:00Z', created_at: '2026-09-19T09:00:00Z',
    updated_at: '2026-09-19T12:00:00Z',
  });
  fake.helpers.seedRow('orders', {
    id: uid(4), order_number: 'KS-20260918-0000004', customer_id: uid(11), seller_id: uid(20),
    status: 'OUT_FOR_DELIVERY', subtotal: 250, delivery_fee: 0, discount: 0, total: 250,
    ship_address: { line1: 'Flat 3, Lake View', city: 'Chennai', pincode: '600001' },
    placed_at: '2026-09-18T09:00:00Z', created_at: '2026-09-18T09:00:00Z',
    updated_at: '2026-09-21T08:00:00Z',
  });

  // Line snapshots
  fake.helpers.seedRow('order_items', {
    id: uid(31), order_id: uid(1), product_id: uid(40), variant_id: uid(41), seller_id: uid(20),
    product_name: 'Brass Table Lamp', sku: 'LAMP-BR-1', size: null, color: 'Brass',
    unit_price: 1000, quantity: 1, line_total: 1000, created_at: '2026-09-01T09:00:00Z',
  });
  fake.helpers.seedRow('order_items', {
    id: uid(32), order_id: uid(2), product_id: uid(40), variant_id: uid(41), seller_id: uid(20),
    product_name: 'Brass Table Lamp', sku: 'LAMP-BR-1', size: null, color: 'Brass',
    unit_price: 900, quantity: 1, line_total: 900, created_at: '2026-09-20T09:00:00Z',
  });
  fake.helpers.seedRow('order_items', {
    id: uid(33), order_id: uid(3), product_id: uid(42), variant_id: uid(43), seller_id: uid(21),
    product_name: 'Silk Cushion', sku: 'CUSH-S-1', size: 'M', color: 'Indigo',
    unit_price: 400, quantity: 1, line_total: 400, created_at: '2026-09-19T09:00:00Z',
  });
  fake.helpers.seedRow('order_items', {
    id: uid(34), order_id: uid(4), product_id: uid(40), variant_id: uid(41), seller_id: uid(20),
    product_name: 'Brass Table Lamp', sku: 'LAMP-BR-1', size: null, color: 'Brass',
    unit_price: 250, quantity: 1, line_total: 250, created_at: '2026-09-18T09:00:00Z',
  });

  // Refunds / payouts / announcements (pending-vs-settled contrast)
  fake.helpers.seedRow('refunds', {
    id: uid(50), return_id: uid(60), order_id: uid(1), customer_id: uid(10),
    amount: 1050, commission_amount: 105, status: 'PENDING', created_at: '2026-09-05T00:00:00Z',
  });
  fake.helpers.seedRow('refunds', {
    id: uid(51), return_id: uid(61), order_id: uid(3), customer_id: uid(11),
    amount: 400, commission_amount: 40, status: 'PROCESSED', processed_at: '2026-09-22T00:00:00Z',
    created_at: '2026-09-20T00:00:00Z',
  });
  fake.helpers.seedRow('payouts', {
    id: uid(52), seller_id: uid(20), order_id: uid(1), amount: 945, commission_amount: 105,
    eligible_at: '2026-09-11T00:00:00Z', status: 'SCHEDULED', created_at: '2026-09-03T10:00:00Z',
  });
  fake.helpers.seedRow('payouts', {
    id: uid(53), seller_id: uid(20), order_id: uid(2), amount: 810, commission_amount: 90,
    eligible_at: '2026-09-28T00:00:00Z', status: 'RELEASED', released_at: '2026-09-28T00:00:00Z',
    created_at: '2026-09-20T10:00:00Z',
  });
  fake.helpers.seedRow('announcements', {
    id: uid(54), title: 'Welcome to K-Shop', body: 'New campus store is live.',
    audience: 'ALL', published_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z',
  });
  fake.helpers.seedRow('announcements', {
    id: uid(55), title: 'Draft notice', body: 'Not yet published.',
    audience: 'ALL', published_at: null, created_at: '2026-09-02T00:00:00Z',
  });

  return fake;
}

function makeWorld() {
  const fake = createFakeSupabase({
    passwordUsers: { 'root@kshop.test': { id: 'adm-1', password: 'AdminPass#123' } },
  });
  seedWorld(fake);
  return fake;
}

// ────────────────────────────────────────────────────────────────────────────

test('admin endpoints require an ADMIN session (401 anonymous, 403 customer)', async (t) => {
  const fake = makeWorld();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  for (const path of ['/api/v1/admin/stats', '/api/v1/admin/customers', '/api/v1/admin/sellers', '/api/v1/admin/products']) {
    const anon = await request(base, path);
    assert.equal(anon.status, 401, `${path} must 401 without a session (fixes the 404 console noise)`);
    assert.equal(anon.body.error.message, 'Not signed in.');
  }
  const unknown = await request(base, '/api/v1/orders');
  assert.equal(unknown.status, 401);

  const customerJar = seededSession(fake, uid(10), 'aarav@kshop.test');
  const denied = await request(base, '/api/v1/admin/stats', {
    headers: { Cookie: cookieHeader(customerJar) },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.message, 'Forbidden.');
});

test('GET /admin/stats returns real server-side aggregates', async (t) => {
  const fake = makeWorld();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());
  const jar = await loginAdmin(base);

  const res = await request(base, '/api/v1/admin/stats', { headers: { Cookie: cookieHeader(jar) } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.stats, {
    totalOrders: 4,
    totalCustomers: 5, // 5 CUSTOMER-role profiles (admins excluded)
    totalSellers: 3,
    totalProducts: 2,
    totalGrossRevenue: 2600, // 1050 + 900 + 400 + 250 (non-voided only)
    pendingRefundsCount: 1,
    pendingSettlementsCount: 1, // exactly one SCHEDULED payout
    activeAnnouncementsCount: 1, // exactly one published
  });
});

test('GET /admin/customers paginates, searches server-side, derives seller status', async (t) => {
  const fake = makeWorld();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());
  const jar = await loginAdmin(base);

  const res = await request(base, '/api/v1/admin/customers?page=1&perPage=20', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 5);
  assert.equal(res.body.totalPages, 1);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.perPage, 20);

  const aarav = res.body.customers.find((c) => c.email === 'aarav@kshop.test');
  assert.equal(aarav.customerId, 'KNCR-1234', 'DB-generated patron id must be exposed');
  assert.equal(aarav.phone, '9876543210', 'phone must be present for the Direct Contact column');
  assert.equal(aarav.fullName, 'Aarav Kumar');
  assert.equal(aarav.status, 'ACTIVE');
  assert.equal(aarav.orderCount, 2);
  assert.equal(aarav.totalSpent, 1950);
  assert.equal(aarav.sellerStatus, 'NONE');

  const rohan = res.body.customers.find((c) => c.email === 'rohan@kshop.test');
  assert.equal(rohan.sellerStatus, 'APPROVED', 'seller status must come from seller_profiles');

  const search = await request(base, '/api/v1/admin/customers?q=meera&page=1&perPage=20', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(search.status, 200);
  assert.equal(search.body.total, 1);
  assert.equal(search.body.customers[0].email, 'meera@kshop.test');

  const byId = await request(base, '/api/v1/admin/customers?q=KNCR-1234&page=1&perPage=20', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(byId.status, 200);
  assert.equal(byId.body.total, 1, 'patron id is searchable');
  assert.equal(byId.body.customers[0].customerId, 'KNCR-1234');

  const tiny = await request(base, '/api/v1/admin/customers?page=1&perPage=2', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(tiny.body.customers.length, 2);
  assert.equal(tiny.body.totalPages, 3, 'ceil(5/2)');

  const capped = await request(base, '/api/v1/admin/customers?page=1&perPage=999', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(capped.body.perPage, 50, 'perPage must be capped server-side');
});

test('POST /admin/customers/:id/toggle-status flips ACTIVE↔SUSPENDED, audits, 404s on non-customers', async (t) => {
  const fake = makeWorld();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());
  const jar = await loginAdmin(base);

  const first = await request(base, `/api/v1/admin/customers/${uid(10)}/toggle-status`, {
    method: 'POST',
    body: {},
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.customer.status, 'SUSPENDED');
  assert.equal(first.body.customer.customerId, 'KNCR-1234', 'toggle response keeps the patron id');
  assert.equal(fake.helpers.getProfile(uid(10)).status, 'SUSPENDED', 'must persist');

  const second = await request(base, `/api/v1/admin/customers/${uid(10)}/toggle-status`, {
    method: 'POST',
    body: {},
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(second.body.customer.status, 'ACTIVE');

  const adminTarget = await request(base, '/api/v1/admin/customers/adm-1/toggle-status', {
    method: 'POST',
    body: {},
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(adminTarget.status, 404, 'admin rows must never be toggleable');

  const unknown = await request(base, '/api/v1/admin/customers/00000000-0000-4000-8000-000000000999/toggle-status', {
    method: 'POST',
    body: {},
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(unknown.status, 404);
  assert.ok(fake.helpers.auditCount() >= 2, 'each toggle is audited');
});

test('GET /admin/sellers filters by pipeline status and derives product/order/revenue aggregates', async (t) => {
  const fake = makeWorld();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());
  const jar = await loginAdmin(base);

  const pending = await request(base, '/api/v1/admin/sellers?status=PENDING&page=1&perPage=20', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(pending.body.total, 2);

  const approved = await request(base, '/api/v1/admin/sellers?status=APPROVED&page=1&perPage=20', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(approved.body.total, 1);
  const rohan = approved.body.sellers[0];
  assert.equal(rohan.storeName, 'Rohan Atelier');
  assert.equal(rohan.email, 'rohan@kshop.test');
  assert.equal(rohan.productCount, 1);
  assert.equal(rohan.orderCount, 3); // orders 1 + 2 + 4
  assert.equal(rohan.grossRevenue, 2200, '1050 + 900 + 250, voided orders excluded');
  assert.equal(rohan.settlementStatus, 'UP_TO_DATE');
  assert.ok(rohan.reviewedDate, 'approved seller has a reviewedDate');

  const sia = pending.body.sellers.find((s) => s.storeName === 'Sia Studio');
  assert.equal(sia.settlementStatus, 'PENDING_APPROVAL');
  assert.equal(sia.orderCount, 1);
  assert.equal(sia.grossRevenue, 400);

  const all = await request(base, '/api/v1/admin/sellers?status=ALL&page=1&perPage=20', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(all.body.total, 3);
});

test('POST /admin/sellers/:id/review approves (adds SELLER role) and rejects (records reason) with audit', async (t) => {
  const fake = makeWorld();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());
  const jar = await loginAdmin(base);

  const approve = await request(base, `/api/v1/admin/sellers/${uid(21)}/review`, {
    method: 'POST',
    body: { decision: 'APPROVED' },
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.seller.status, 'APPROVED');
  assert.deepEqual(
    fake.helpers.getProfile(uid(21)).roles,
    ['CUSTOMER', 'SELLER'],
    'approved seller keeps CUSTOMER and gains SELLER (§8)',
  );
  assert.ok(fake.helpers.getSellerProfile(uid(21)).reviewed_at, 'reviewed_at recorded');

  const reject = await request(base, `/api/v1/admin/sellers/${uid(22)}/review`, {
    method: 'POST',
    body: { decision: 'REJECTED' },
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(reject.status, 200);
  assert.equal(reject.body.seller.status, 'REJECTED');
  assert.equal(
    fake.helpers.getSellerProfile(uid(22)).rejection_reason,
    'Rejected by administrator.',
    'schema CHECK requires a non-null reason',
  );

  const bad = await request(base, `/api/v1/admin/sellers/${uid(22)}/review`, {
    method: 'POST',
    body: { decision: 'MAYBE' },
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(bad.status, 400);

  const unknown = await request(base, '/api/v1/admin/sellers/00000000-0000-4000-8000-000000000999/review', {
    method: 'POST',
    body: { decision: 'APPROVED' },
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(unknown.status, 404);
  assert.ok(fake.helpers.auditCount() >= 2, 'review decisions are audited');
});

test('GET /admin/products lists every product across sellers (incl. DRAFT) with the public shape', async (t) => {
  const fake = makeWorld();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());
  const jar = await loginAdmin(base);

  const res = await request(base, '/api/v1/admin/products?page=1&perPage=20', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);

  const lamp = res.body.products.find((p) => p.name === 'Brass Table Lamp');
  assert.equal(lamp.status, 'PUBLISHED');
  assert.equal(lamp.price, 1000, 'min active-variant price');
  assert.equal(lamp.stock, 5);
  assert.equal(lamp.sellerName, 'Rohan Verma');
  assert.equal(lamp.images.length, 1);
  assert.ok(lamp.images[0].includes('/storage/v1/object/public/product-images/lamp/img1.jpg'));

  const cushion = res.body.products.find((p) => p.name === 'Silk Cushion');
  assert.equal(cushion.status, 'DRAFT', 'drafts are invisible to customers but indexed for admins');

  const search = await request(base, '/api/v1/admin/products?q=cushion', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(search.body.total, 1);
});

// ── Orders (Phase 9 READ + status surface) ──────────────────────────────────

test('GET /orders is session-scoped: admin sees all, customer sees only own', async (t) => {
  const fake = makeWorld();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const adminJar = await loginAdmin(base);
  const adminRes = await request(base, '/api/v1/orders', {
    headers: { Cookie: cookieHeader(adminJar) },
  });
  assert.equal(adminRes.status, 200);
  assert.equal(adminRes.body.orders.length, 4);

  const customerJar = seededSession(fake, uid(10), 'aarav@kshop.test');
  const customerRes = await request(base, '/api/v1/orders', {
    headers: { Cookie: cookieHeader(customerJar) },
  });
  assert.equal(customerRes.status, 200);
  assert.equal(customerRes.body.orders.length, 2, 'only orders owned by this customer');

  const delivered = customerRes.body.orders.find((o) => o.orderNumber === 'KS-20260901-0000001');
  assert.equal(delivered.orderStatus, 'COD_DELIVERED');
  assert.equal(delivered.paymentStatus, 'COLLECTED_COD');
  assert.equal(delivered.totalAmount, 1050);
  assert.equal(delivered.customerName, 'Aarav Kumar');
  assert.equal(delivered.customerEmail, 'aarav@kshop.test');
  assert.equal(delivered.items[0].product.name, 'Brass Table Lamp');
  assert.equal(delivered.items[0].quantity, 1);
  assert.equal(delivered.shippingAddress.city, 'Madurai');
  assert.equal(delivered.isEligibleForCancel, false);
  assert.equal(delivered.timeline[0].status, 'COD_PENDING', 'timeline starts at placement');

  const inFlight = customerRes.body.orders.find((o) => o.orderNumber === 'KS-20260920-0000002');
  assert.equal(inFlight.orderStatus, 'COD_PENDING');
  assert.equal(inFlight.paymentStatus, 'UNPAID_COD');
  assert.equal(inFlight.isEligibleForCancel, true);
});

test('GET /orders/:id enforces ownership (foreign order → 404, admin → 200)', async (t) => {
  const fake = makeWorld();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const customerJar = seededSession(fake, uid(10), 'aarav@kshop.test');
  const foreign = await request(base, `/api/v1/orders/${uid(3)}`, {
    headers: { Cookie: cookieHeader(customerJar) },
  });
  assert.equal(foreign.status, 404, 'must not leak existence of another customer’s order');

  const adminJar = await loginAdmin(base);
  const own = await request(base, `/api/v1/orders/${uid(3)}`, {
    headers: { Cookie: cookieHeader(adminJar) },
  });
  assert.equal(own.status, 200);
  assert.equal(own.body.order.orderNumber, 'KS-20260919-0000003');
  assert.equal(own.body.order.orderStatus, 'COD_CONFIRMED');
  assert.equal(own.body.order.customerName, 'Meera Nair');

  const malformed = await request(base, '/api/v1/orders/not-a-uuid', {
    headers: { Cookie: cookieHeader(adminJar) },
  });
  assert.equal(malformed.status, 404);
});

test('PATCH /orders/:id/status: roles, terminal states, mapping and timestamps', async (t) => {
  const fake = makeWorld();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  // Customer can never move an order (§5-55).
  const customerJar = seededSession(fake, uid(10), 'aarav@kshop.test');
  const forbidden = await request(base, `/api/v1/orders/${uid(2)}/status`, {
    method: 'PATCH',
    body: { status: 'COD_CONFIRMED' },
    headers: { Cookie: cookieHeader(customerJar) },
  });
  assert.equal(forbidden.status, 403);

  const adminJar = await loginAdmin(base);
  const auth = { headers: { Cookie: cookieHeader(adminJar) } };

  // Invalid vocabulary rejected.
  const invalid = await request(base, `/api/v1/orders/${uid(2)}/status`, {
    method: 'PATCH',
    body: { status: 'COD_BOGUS' },
    ...auth,
  });
  assert.equal(invalid.status, 400);

  // COD_PENDING is a placement state and cannot be written.
  const pending = await request(base, `/api/v1/orders/${uid(2)}/status`, {
    method: 'PATCH',
    body: { status: 'COD_PENDING' },
    ...auth,
  });
  assert.equal(pending.status, 400);

  // Forward to DELIVERED sets delivered_at + payment status.
  const delivered = await request(base, `/api/v1/orders/${uid(2)}/status`, {
    method: 'PATCH',
    body: { status: 'COD_DELIVERED' },
    ...auth,
  });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.order.orderStatus, 'COD_DELIVERED');
  assert.equal(delivered.body.order.paymentStatus, 'UNPAID_COD', 'COD receipt not yet recorded');
  assert.equal(fake.helpers.getRow('orders', uid(2)).status, 'DELIVERED');
  assert.ok(fake.helpers.getRow('orders', uid(2)).delivered_at, 'delivered_at must be written');

  // Terminal states are immutable.
  const terminal = await request(base, `/api/v1/orders/${uid(2)}/status`, {
    method: 'PATCH',
    body: { status: 'COD_CANCELLED' },
    ...auth,
  });
  assert.equal(terminal.status, 400);

  // Cancel path — cancelled_at + VOID payment.
  const cancelled = await request(base, `/api/v1/orders/${uid(4)}/status`, {
    method: 'PATCH',
    body: { status: 'COD_CANCELLED' },
    ...auth,
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.order.orderStatus, 'COD_CANCELLED');
  assert.equal(cancelled.body.order.paymentStatus, 'VOID_CANCELLED');
  assert.equal(cancelled.body.order.isEligibleForCancel, false);
  assert.ok(fake.helpers.getRow('orders', uid(4)).cancelled_at);

  // Unapproved sellers must NOT act on orders (§5-33/34) — uid22 is PENDING.
  const pendingJar = seededSession(fake, uid(22), 'kaav@kshop.test');
  const pendingAttempt = await request(base, `/api/v1/orders/${uid(3)}/status`, {
    method: 'PATCH',
    body: { status: 'COD_SHIPPED' },
    headers: { Cookie: cookieHeader(pendingJar) },
  });
  assert.equal(pendingAttempt.status, 403, 'unapproved seller cannot advance orders');

  // An APPROVED seller may advance ONLY their own orders (§5-34).
  const approve = await request(base, `/api/v1/admin/sellers/${uid(21)}/review`, {
    method: 'POST',
    body: { decision: 'APPROVED' },
    headers: { Cookie: cookieHeader(adminJar) },
  });
  assert.equal(approve.status, 200);

  const sellerJar = seededSession(fake, uid(21), 'sia@kshop.test');
  const theirOwn = await request(base, `/api/v1/orders/${uid(3)}/status`, {
    method: 'PATCH',
    body: { status: 'COD_SHIPPED' },
    headers: { Cookie: cookieHeader(sellerJar) },
  });
  assert.equal(theirOwn.status, 200);
  assert.equal(theirOwn.body.order.orderStatus, 'COD_SHIPPED');

  const notTheirOwn = await request(base, `/api/v1/orders/${uid(4)}/status`, {
    method: 'PATCH',
    body: { status: 'COD_DELIVERED' },
    headers: { Cookie: cookieHeader(sellerJar) },
  });
  assert.equal(notTheirOwn.status, 403, 'seller cannot touch another seller’s order');
});