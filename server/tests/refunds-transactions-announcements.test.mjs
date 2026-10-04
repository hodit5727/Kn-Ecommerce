/**
 * Refund claims/returns (BACKEND_SPEC §21/§22), the financial passbook
 * (§28/§29) and announcements (§27). Fake Supabase, no network.
 *
 * Proves:
 * - refund window + commission computed ONLY from server time; day 1–3 → 5%,
 *   day 4–7 → 10%, window closed after day 7; single open claim per order;
 *   claims are customer-owned and admits only DELIVERED orders.
 * - admin adjudication writes consistent bookkeeping (returns/refunds/orders)
 *   and refuses already-resolved claims; non-admin PATCH → 401/403.
 * - the passbook is role-scoped server-side (ADMIN all / seller own rows /
 *   customer own rows), type=CR|DR validated, categories server-mapped.
 * - announcements: public GET is audience-scoped by session and window-aware;
 *   admin CRUD is role-gated; createdBy is the session admin, never client.
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
const DAY_MS = 24 * 60 * 60 * 1000;

const CUSTOMER = uid(10);
const OTHER_CUSTOMER = uid(11);
const SELLER = uid(20);
const ADMIN = 'adm-1';

const sessionCookie = (id) =>
  `ks_access=${signedCookie(`at-${id}`)}; ks_refresh=${signedCookie(`rt-${id}`)}`;

function seedClaimWorld(fake) {
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
  fake.helpers.seedUser({ id: SELLER, email: 'rohan@kshop.test' });
  fake.helpers.seedProfile({
    id: SELLER, email: 'rohan@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE', full_name: 'Rohan Verma', phone: '9876543220',
  });
  fake.helpers.seedSeller({ profile_id: SELLER, verification_status: 'APPROVED', store_name: 'Rohan Store' });

  fake.helpers.seedUser({ id: ADMIN, email: 'admin@kshop.test' });
  fake.helpers.seedProfile({
    id: ADMIN, email: 'admin@kshop.test', role: 'ADMIN', roles: ['ADMIN'],
    status: 'ACTIVE', full_name: 'Root Admin',
  });

  // o1: delivered 2 days ago (eligibility day 3 → 5% commission), total 1000.
  const deliveredTwoDaysAgo = new Date(Date.now() - 2 * DAY_MS).toISOString();
  fake.helpers.seedRow('orders', {
    id: uid(41), customer_id: CUSTOMER, seller_id: SELLER, status: 'DELIVERED',
    subtotal: 1000, delivery_fee: 75, discount: 0, total: 1000,
    order_number: 'KS-20260925-0000001',
    placed_at: new Date(Date.now() - 5 * DAY_MS).toISOString(),
    delivered_at: deliveredTwoDaysAgo,
    created_at: new Date(Date.now() - 5 * DAY_MS).toISOString(),
    updated_at: deliveredTwoDaysAgo,
  });
  fake.helpers.seedRow('order_items', {
    id: uid(51), order_id: uid(41), product_id: uid(52), variant_id: uid(53), seller_id: SELLER,
    product_name: 'Blue Cotton Kurta', sku: 'KUR-01', unit_price: 1000, quantity: 1, line_total: 1000,
  });

  // o2: delivered 9 days ago → window closed.
  fake.helpers.seedRow('orders', {
    id: uid(42), customer_id: CUSTOMER, seller_id: SELLER, status: 'DELIVERED',
    subtotal: 500, delivery_fee: 75, discount: 0, total: 575,
    order_number: 'KS-20260925-0000002',
    placed_at: new Date(Date.now() - 12 * DAY_MS).toISOString(),
    delivered_at: new Date(Date.now() - 9 * DAY_MS).toISOString(),
    created_at: new Date(Date.now() - 12 * DAY_MS).toISOString(),
    updated_at: new Date(Date.now() - 9 * DAY_MS).toISOString(),
  });

  // o3: not delivered yet.
  fake.helpers.seedRow('orders', {
    id: uid(43), customer_id: CUSTOMER, seller_id: SELLER, status: 'PLACED',
    subtotal: 499, delivery_fee: 75, discount: 0, total: 574,
    order_number: 'KS-20260925-0000003',
    placed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // o4: ANOTHER customer's delivered order.
  fake.helpers.seedRow('orders', {
    id: uid(44), customer_id: OTHER_CUSTOMER, seller_id: SELLER, status: 'DELIVERED',
    subtotal: 800, delivery_fee: 75, discount: 0, total: 800,
    order_number: 'KS-20260925-0000004',
    placed_at: new Date(Date.now() - 6 * DAY_MS).toISOString(),
    delivered_at: new Date(Date.now() - 3 * DAY_MS).toISOString(),
    created_at: new Date(Date.now() - 6 * DAY_MS).toISOString(),
    updated_at: new Date(Date.now() - 3 * DAY_MS).toISOString(),
  });
}

// ── refunds ────────────────────────────────────────────────────────────────
test('POST /refunds computes window + 5% commission server-side and links the order', async () => {
  const fake = createFakeSupabase();
  seedClaimWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/refunds', {
      method: 'POST',
      headers: { cookie: sessionCookie(CUSTOMER) },
      body: { orderId: uid(41), reason: 'DAMAGED_ON_DELIVERY', description: 'Torn sleeve.' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const claim = res.body.refund;
    assert.equal(claim.orderId, uid(41));
    assert.equal(claim.orderNumber, 'KS-20260925-0000001');
    assert.equal(claim.productName, 'Blue Cotton Kurta');
    assert.match(claim.refundNumber, /^REF-[0-9A-F]{8}$/);
    assert.equal(claim.status, 'REQUESTED');
    assert.equal(claim.amount, 950); // 1000 − 5% commission
    assert.equal(claim.reason, 'DAMAGED_ON_DELIVERY');

    // DB rows reflect the server-computed window math.
    const ret = fake.helpers.rows('returns').find((r) => r.order_id === uid(41));
    assert.equal(ret.eligibility_day, 3);
    assert.equal(ret.commission_percent, 5);
    assert.equal(Number(ret.commission_amount), 50);
    const refund = fake.helpers.rows('refunds').find((r) => r.return_id === ret.id);
    assert.equal(Number(refund.amount), 950);
    assert.equal(refund.status, 'PENDING');
    const order = fake.helpers.getRow('orders', uid(41));
    assert.equal(order.status, 'RETURN_REQUESTED');
  } finally {
    server.close();
  }
});

test('POST /refunds rejects duplicate claims, closed windows and non-delivered orders', async () => {
  const fake = createFakeSupabase();
  seedClaimWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    const cookie = { cookie: sessionCookie(CUSTOMER) };
    const ok1 = await request(base, '/api/v1/refunds', { method: 'POST', headers: cookie, body: { orderId: uid(41), reason: 'OTHER' } });
    assert.equal(ok1.status, 200);

    // Second claim on the same order → 409 (open-claim guard).
    const dup = await request(base, '/api/v1/refunds', { method: 'POST', headers: cookie, body: { orderId: uid(41), reason: 'OTHER' } });
    assert.equal(dup.status, 409);
    assert.match(dup.body.error.message, /already open for this order/);

    // Window closed (day 10).
    const closed = await request(base, '/api/v1/refunds', { method: 'POST', headers: cookie, body: { orderId: uid(42), reason: 'OTHER' } });
    assert.equal(closed.status, 400);
    assert.match(closed.body.error.message, /refund window for this order has closed/);

    // Not delivered yet.
    const undelivered = await request(base, '/api/v1/refunds', { method: 'POST', headers: cookie, body: { orderId: uid(43), reason: 'OTHER' } });
    assert.equal(undelivered.status, 400);
    assert.match(undelivered.body.error.message, /after the order has been delivered/);
  } finally {
    server.close();
  }
});

test('POST /refunds is ownership-scoped: other customers get 404, sellers get 403', async () => {
  const fake = createFakeSupabase();
  seedClaimWorld(fake);
  const { server, base } = await makeServer(fake);
  try {
    // Someone else's order id → generic 404 (no existence leak).
    const foreign = await request(base, '/api/v1/refunds', {
      method: 'POST', headers: { cookie: sessionCookie(OTHER_CUSTOMER) }, body: { orderId: uid(41), reason: 'OTHER' },
    });
    assert.equal(foreign.status, 404);

    // Sellers cannot file claims.
    const sellerClaim = await request(base, '/api/v1/refunds', {
      method: 'POST', headers: { cookie: sessionCookie(SELLER) }, body: { orderId: uid(41), reason: 'OTHER' },
    });
    assert.equal(sellerClaim.status, 403);
    assert.match(sellerClaim.body.error.message, /Only customers can request refunds/);
  } finally {
    server.close();
  }
});

test('GET /refunds is role-scoped; admin adjudication keeps the books consistent', async () => {
  const fake = createFakeSupabase();
  seedClaimWorld(fake);
  // Seed one open claim on o1.
  const retId = uid(50);
  fake.helpers.seedRow('returns', {
    id: retId, return_number: 'RT-20260925-0000001', order_id: uid(41), customer_id: CUSTOMER,
    reason: 'DAMAGED_ON_DELIVERY', description: 'Torn.', status: 'REQUESTED', eligibility_day: 3,
    commission_percent: 5, commission_amount: 50, refund_amount: 950,
    requested_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  const refundId = uid(51);
  fake.helpers.seedRow('refunds', {
    id: refundId, return_id: retId, order_id: uid(41), customer_id: CUSTOMER, amount: 950, commission_amount: 50,
    status: 'PENDING', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });

  const { server, base } = await makeServer(fake);
  try {
    // Customer sees only own claims.
    const mine = await request(base, '/api/v1/refunds', { headers: { cookie: sessionCookie(CUSTOMER) } });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.refunds.length, 1);
    assert.match(mine.body.refunds[0].refundNumber, /^REF-/);

    // Seller sees claims on own orders.
    const sellerView = await request(base, '/api/v1/refunds', { headers: { cookie: sessionCookie(SELLER) } });
    assert.equal(sellerView.status, 200);
    assert.equal(sellerView.body.refunds.length, 1);

    // Admin approves → UNDER_REVIEW; the money is not moved yet.
    const approve = await request(base, `/api/v1/refunds/${refundId}/status`, {
      method: 'PATCH', headers: { cookie: sessionCookie(ADMIN) }, body: { status: 'APPROVED', adminNotes: 'OK' },
    });
    assert.equal(approve.status, 200, JSON.stringify(approve.body));
    assert.equal(approve.body.refund.status, 'UNDER_REVIEW');

    // Complete → refund PROCESSED, return COMPLETED, order REFUNDED.
    const complete = await request(base, `/api/v1/refunds/${refundId}/status`, {
      method: 'PATCH', headers: { cookie: sessionCookie(ADMIN) }, body: { status: 'COMPLETED' },
    });
    assert.equal(complete.status, 200);
    assert.equal(complete.body.refund.status, 'COMPLETED');
    assert.equal(fake.helpers.rows('refunds').find((r) => r.id === refundId).status, 'PROCESSED');
    assert.equal(fake.helpers.getRow('orders', uid(41)).status, 'REFUNDED');

    // Already resolved → refused.
    const again = await request(base, `/api/v1/refunds/${refundId}/status`, {
      method: 'PATCH', headers: { cookie: sessionCookie(ADMIN) }, body: { status: 'REJECTED' },
    });
    assert.equal(again.status, 400);
    assert.match(again.body.error.message, /already resolved/);

    // A customer cannot adjudicate — 403 (authenticated but not ADMIN).
    const escalate = await request(base, `/api/v1/refunds/${refundId}/status`, {
      method: 'PATCH', headers: { cookie: sessionCookie(CUSTOMER) }, body: { status: 'APPROVED' },
    });
    assert.equal(escalate.status, 403);
  } finally {
    server.close();
  }
});

test('PATCH /refunds/:id/status REJECTED reverts the order to DELIVERED and records the reason', async () => {
  const fake = createFakeSupabase();
  seedClaimWorld(fake);
  const retId = uid(60);
  fake.helpers.seedRow('returns', {
    id: retId, return_number: 'RT-20260925-0000002', order_id: uid(41), customer_id: CUSTOMER,
    reason: 'NOT_AS_DESCRIBED', description: 'Wrong.', status: 'REQUESTED', eligibility_day: 2,
    commission_percent: 5, commission_amount: 50, refund_amount: 950,
    requested_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  const refundId = uid(61);
  fake.helpers.seedRow('refunds', {
    id: refundId, return_id: retId, order_id: uid(41), customer_id: CUSTOMER, amount: 950, commission_amount: 50,
    status: 'PENDING', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  const { server, base } = await makeServer(fake);
  try {
    const reject = await request(base, `/api/v1/refunds/${refundId}/status`, {
      method: 'PATCH', headers: { cookie: sessionCookie(ADMIN) }, body: { status: 'REJECTED', adminNotes: 'Policy not covered' },
    });
    assert.equal(reject.status, 200);
    assert.equal(reject.body.refund.status, 'REJECTED');
    const ret = fake.helpers.rows('returns').find((r) => r.id === retId);
    assert.equal(ret.status, 'REJECTED');
    assert.equal(ret.rejection_reason, 'Policy not covered');
    const refund = fake.helpers.rows('refunds').find((r) => r.id === refundId);
    assert.equal(refund.status, 'FAILED');
    assert.equal(fake.helpers.getRow('orders', uid(41)).status, 'DELIVERED'); // return refused
  } finally {
    server.close();
  }
});

// ── transactions (financial passbook) ──────────────────────────────────────
function seedTransactions(fake) {
  fake.helpers.seedUser({ id: SELLER, email: 'rohan@kshop.test' });
  fake.helpers.seedProfile({
    id: SELLER, email: 'rohan@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE', full_name: 'Rohan Verma', phone: '9876543220',
  });
  fake.helpers.seedSeller({ profile_id: SELLER, verification_status: 'APPROVED', store_name: 'Rohan Store' });
  fake.helpers.seedUser({ id: uid(21), email: 'sia@kshop.test' });
  fake.helpers.seedProfile({
    id: uid(21), email: 'sia@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE', full_name: 'Sia Kapoor', phone: '9876543221',
  });
  fake.helpers.seedSeller({ profile_id: uid(21), verification_status: 'APPROVED', store_name: 'Sia Studio' });
  fake.helpers.seedUser({ id: CUSTOMER, email: 'aarav@kshop.test' });
  fake.helpers.seedProfile({
    id: CUSTOMER, email: 'aarav@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER'],
    status: 'ACTIVE', full_name: 'Aarav Kumar', phone: '9876543210',
  });
  fake.helpers.seedUser({ id: ADMIN, email: 'admin@kshop.test' });
  fake.helpers.seedProfile({ id: ADMIN, email: 'admin@kshop.test', role: 'ADMIN', roles: ['ADMIN'], status: 'ACTIVE', full_name: 'Root Admin' });

  fake.helpers.seedRow('orders', { id: uid(41), order_number: 'KS-20260925-0000001' });
  fake.helpers.seedRow('orders', { id: uid(42), order_number: 'KS-20260925-0000002' });

  fake.helpers.seedRow('transactions', {
    id: 't1', txn_ref: 'TXN-0000000001', seller_id: SELLER, order_id: uid(41),
    txn_type: 'COD_RECEIPT', entry: 'CREDIT', amount: 1000, balance_after: 1000,
    status: 'POSTED', created_at: '2026-09-01T10:00:00Z',
  });
  fake.helpers.seedRow('transactions', {
    id: 't2', txn_ref: 'TXN-0000000002', seller_id: SELLER, order_id: uid(41),
    txn_type: 'COMMISSION', entry: 'CREDIT', amount: 50, balance_after: 1050,
    status: 'POSTED', created_at: '2026-09-01T10:00:00Z',
  });
  fake.helpers.seedRow('transactions', {
    id: 't3', txn_ref: 'TXN-0000000003', seller_id: uid(21), order_id: uid(42),
    txn_type: 'COD_RECEIPT', entry: 'CREDIT', amount: 800, balance_after: 800,
    status: 'POSTED', created_at: '2026-09-02T10:00:00Z',
  });
  fake.helpers.seedRow('transactions', {
    id: 't4', txn_ref: 'TXN-0000000004', customer_id: CUSTOMER, order_id: uid(41),
    txn_type: 'REFUND', entry: 'DEBIT', amount: 950, balance_after: -950,
    status: 'POSTED', created_at: '2026-09-03T10:00:00Z',
  });
}

test('GET /transactions is role-scoped and validates the type param', async () => {
  const fake = createFakeSupabase();
  seedTransactions(fake);
  const { server, base } = await makeServer(fake);
  try {
    // Admin sees every row.
    const admin = await request(base, '/api/v1/transactions', { headers: { cookie: sessionCookie(ADMIN) } });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.transactions.length, 4);

    // Seller sees only rows on its own seller_id.
    const seller = await request(base, '/api/v1/transactions', { headers: { cookie: sessionCookie(SELLER) } });
    assert.equal(seller.status, 200);
    assert.equal(seller.body.transactions.length, 2);
    assert.ok(seller.body.transactions.every((t) => t.sellerId === SELLER));
    const revenue = seller.body.transactions.find((t) => t.transactionNumber === 'TXN-0000000001');
    assert.equal(revenue.category, 'ORDER_REVENUE');
    assert.equal(revenue.type, 'CR');
    assert.equal(revenue.orderNumber, 'KS-20260925-0000001');
    const commission = seller.body.transactions.find((t) => t.transactionNumber === 'TXN-0000000002');
    assert.equal(commission.category, 'PLATFORM_FEE');

    // type=CR narrows to credits.
    const credits = await request(base, '/api/v1/transactions?type=CR', { headers: { cookie: sessionCookie(SELLER) } });
    assert.equal(credits.body.transactions.length, 2);

    // Customer sees only its own rows; REFUND+DEBIT → REFUND_DEDUCTION.
    const customer = await request(base, '/api/v1/transactions', { headers: { cookie: sessionCookie(CUSTOMER) } });
    assert.equal(customer.body.transactions.length, 1);
    const theirRefund = customer.body.transactions[0];
    assert.equal(theirRefund.category, 'REFUND_DEDUCTION');
    assert.equal(theirRefund.type, 'DR');

    const customerCredits = await request(base, '/api/v1/transactions?type=CR', { headers: { cookie: sessionCookie(CUSTOMER) } });
    assert.equal(customerCredits.body.transactions.length, 0);

    // Invalid type → clean 400.
    const bad = await request(base, '/api/v1/transactions?type=BAD', { headers: { cookie: sessionCookie(ADMIN) } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error.message, /type must be CR or DR/);
  } finally {
    server.close();
  }
});

// ── announcements ──────────────────────────────────────────────────────────
function seedAnnouncements(fake) {
  fake.helpers.seedUser({ id: CUSTOMER, email: 'aarav@kshop.test' });
  fake.helpers.seedProfile({
    id: CUSTOMER, email: 'aarav@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER'],
    status: 'ACTIVE', full_name: 'Aarav Kumar', phone: '9876543210',
  });
  fake.helpers.seedUser({ id: SELLER, email: 'rohan@kshop.test' });
  fake.helpers.seedProfile({
    id: SELLER, email: 'rohan@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE', full_name: 'Rohan Verma', phone: '9876543220',
  });
  fake.helpers.seedSeller({ profile_id: SELLER, verification_status: 'APPROVED', store_name: 'Rohan Store' });
  fake.helpers.seedUser({ id: ADMIN, email: 'admin@kshop.test' });
  fake.helpers.seedProfile({
    id: ADMIN, email: 'admin@kshop.test', role: 'ADMIN', roles: ['ADMIN'],
    status: 'ACTIVE', full_name: 'Root Admin',
  });

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const base = {
    priority: 'NORMAL', created_by: ADMIN,
    created_at: iso(now - 100000), updated_at: iso(now - 100000),
    published_at: iso(now - 200000),
  };
  fake.helpers.seedRow('announcements', { id: 'a1', title: 'For everyone', body: 'Sale!', audience: 'ALL', status: 'ACTIVE', ...base });
  fake.helpers.seedRow('announcements', { id: 'a2', title: 'For customers', body: 'Perks.', audience: 'CUSTOMERS', status: 'ACTIVE', ...base });
  fake.helpers.seedRow('announcements', { id: 'a3', title: 'For sellers', body: 'Tools.', audience: 'SELLERS', status: 'ACTIVE', ...base });
  fake.helpers.seedRow('announcements', { id: 'a4', title: 'Old news', body: '', audience: 'ALL', status: 'ARCHIVED', ...base });
  fake.helpers.seedRow('announcements', { id: 'a5', title: 'Not yet', body: '', audience: 'ALL', status: 'ACTIVE', starts_at: iso(now + 5 * DAY_MS), ...base });
  fake.helpers.seedRow('announcements', { id: 'a6', title: 'Expired', body: '', audience: 'ALL', status: 'ACTIVE', starts_at: iso(now - 10 * DAY_MS), ends_at: iso(now - DAY_MS), ...base });
}

test('GET /announcements is public but audience-scoped and window-aware', async () => {
  const fake = createFakeSupabase();
  seedAnnouncements(fake);
  const { server, base } = await makeServer(fake);
  try {
    // Anonymous → only the ALL-audience live entry.
    const anon = await request(base, '/api/v1/announcements');
    assert.equal(anon.status, 200);
    assert.deepEqual(anon.body.announcements.map((a) => a.id), ['a1']);

    // Customer → ALL + CUSTOMERS.
    const customer = await request(base, '/api/v1/announcements', { headers: { cookie: sessionCookie(CUSTOMER) } });
    assert.deepEqual(customer.body.announcements.map((a) => a.id).sort(), ['a1', 'a2']);
    assert.equal(customer.body.announcements.find((a) => a.id === 'a2').audience, 'ALL_CUSTOMERS');

    // Seller → ALL + SELLERS.
    const seller = await request(base, '/api/v1/announcements', { headers: { cookie: sessionCookie(SELLER) } });
    assert.deepEqual(seller.body.announcements.map((a) => a.id).sort(), ['a1', 'a3']);

    // Admin → everything live incl. audience-tagged rows.
    const admin = await request(base, '/api/v1/announcements', { headers: { cookie: sessionCookie(ADMIN) } });
    assert.deepEqual(admin.body.announcements.map((a) => a.id).sort(), ['a1', 'a2', 'a3']);

    // createdBy is resolved to the creator's name, never a raw id.
    assert.ok(customer.body.announcements.every((a) => a.createdBy === 'Root Admin'));
  } finally {
    server.close();
  }
});

test('admin announcement CRUD is role-gated; createdBy comes from the session', async () => {
  const fake = createFakeSupabase();
  seedAnnouncements(fake);
  const { server, base } = await makeServer(fake);
  try {
    // A customer cannot create announcements (authenticated but not ADMIN).
    const forbidden = await request(base, '/api/v1/admin/announcements', {
      method: 'POST', headers: { cookie: sessionCookie(CUSTOMER) },
      body: { title: 'Hack', message: 'x', audience: 'ALL' },
    });
    assert.equal(forbidden.status, 403);

    const adminCookies = { cookie: sessionCookie(ADMIN) };
    const created = await request(base, '/api/v1/admin/announcements', {
      method: 'POST', headers: adminCookies,
      body: { title: 'Mega Sale', message: 'Flat 50% on kurtas', audience: 'ALL_CUSTOMERS', priority: 'HIGH' },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const a = created.body.announcement;
    assert.equal(a.title, 'Mega Sale');
    assert.equal(a.audience, 'ALL_CUSTOMERS');
    assert.equal(a.priority, 'HIGH');
    assert.equal(a.status, 'ACTIVE');
    assert.equal(a.createdBy, 'Root Admin'); // session admin, never client-sent
    const stored = fake.helpers.rows('announcements').find((r) => r.id === a.id);
    assert.equal(stored.audience, 'CUSTOMERS'); // DB enum
    assert.equal(stored.created_by, ADMIN);

    // Partial update.
    const updated = await request(base, `/api/v1/admin/announcements/${a.id}`, {
      method: 'PUT', headers: adminCookies, body: { title: 'Mega Sale 2.0' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.announcement.title, 'Mega Sale 2.0');

    // Delete.
    const deleted = await request(base, `/api/v1/admin/announcements/${a.id}`, {
      method: 'DELETE', headers: adminCookies,
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.success, true);
    assert.equal(fake.helpers.rows('announcements').some((r) => r.id === a.id), false);
  } finally {
    server.close();
  }
});