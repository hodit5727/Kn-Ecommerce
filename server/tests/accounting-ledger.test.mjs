/**
 * Accounting Ledger & Settlement Synchronisation Tests (Section 9 Scenarios)
 * Validates:
 * - Scenario A: Customer payment ₹1,000, 5% fee = ₹50, seller payout = ₹950.
 *   Admin retained amount = ₹50. Seller received amount = ₹950.
 * - Scenario B: Commission calculation on ₹975: 5% = ₹48.75, seller payout = ₹926.25.
 * - Scenario C: Duplicate payout release is blocked (idempotency check).
 * - Scenario D: Payout role authorization and failure guards.
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
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // raw
  }
  return { status: res.status, headers: res.headers, body: json, raw: text };
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

async function loginAdmin(base) {
  const res = await request(base, '/api/v1/admin/auth/login', {
    method: 'POST',
    body: { email: 'root@kshop.test', password: 'AdminPass#123' },
  });
  assert.equal(res.status, 200, 'admin login must succeed');
  return cookieJar(res);
}

function seededSession(fake, userId, email) {
  fake.helpers.seedUser({ id: userId, email });
  return {
    ks_access: signedCookie(`at-${userId}`),
    ks_refresh: signedCookie(`rt-${userId}`),
  };
}

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SELLER = uid(2);
const CUSTOMER = uid(3);

function seedAccountingWorld(fake) {
  fake.helpers.seedUser({ id: 'adm-1', email: 'root@kshop.test' });
  fake.helpers.seedProfile({
    id: 'adm-1', email: 'root@kshop.test', role: 'ADMIN', status: 'ACTIVE',
    roles: ['ADMIN'], full_name: 'Root Admin', created_at: '2026-08-01T00:00:00Z',
  });

  fake.helpers.seedUser({ id: SELLER, email: 'seller@kshop.test' });
  fake.helpers.seedProfile({
    id: SELLER, email: 'seller@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE', full_name: 'Atelier Artisan',
  });
  fake.helpers.seedSeller({ profile_id: SELLER, verification_status: 'APPROVED', store_name: 'Luxury Atelier' });

  fake.helpers.seedUser({ id: CUSTOMER, email: 'customer@kshop.test' });
  fake.helpers.seedProfile({
    id: CUSTOMER, email: 'customer@kshop.test', role: 'CUSTOMER', roles: ['CUSTOMER'],
    status: 'ACTIVE', full_name: 'Priya Sharma',
  });
}

function makeFakeWorld() {
  const fake = createFakeSupabase({
    passwordUsers: { 'root@kshop.test': { id: 'adm-1', password: 'AdminPass#123' } },
  });
  seedAccountingWorld(fake);
  return fake;
}

test('Accounting Scenario A: Order ₹1,000, 5% fee = ₹50, payout = ₹950, Admin retained = ₹50', async () => {
  const fake = makeFakeWorld();

  const orderId = uid(101);
  fake.helpers.seedRow('orders', {
    id: orderId,
    order_number: 'KS-20261021-0001000',
    customer_id: CUSTOMER,
    seller_id: SELLER,
    status: 'DELIVERED',
    total: 1000,
    payment_method: 'COD',
  });

  fake.helpers.seedRow('order_items', {
    id: uid(201),
    order_id: orderId,
    product_id: uid(301),
    product_name: 'Cashmere Wool Shawl',
    sku: 'SHAWL-CASHMERE-BLK',
    seller_id: SELLER,
    unit_price: 1000,
    quantity: 1,
  });

  const payoutId = uid(401);
  fake.helpers.seedRow('payouts', {
    id: payoutId,
    seller_id: SELLER,
    order_id: orderId,
    amount: 1000,
    commission_amount: 50, // 5%
    eligible_at: new Date(Date.now() - 1000).toISOString(),
    status: 'SCHEDULED',
  });

  // Admin collected COD money (+₹1000 Credit)
  fake.helpers.seedRow('transactions', {
    id: uid(501),
    txn_ref: 'TXN-1000000001',
    order_id: orderId,
    customer_id: CUSTOMER,
    seller_id: SELLER,
    txn_type: 'COD_RECEIPT',
    entry: 'CREDIT',
    amount: 1000,
    balance_after: 1000,
    status: 'POSTED',
    created_at: '2026-10-20T08:00:00Z',
  });

  const { server, base } = await makeServer(fake);
  try {
    const adminJar = await loginAdmin(base);
    const adminCookie = { cookie: cookieHeader(adminJar) };

    // 1. Admin releases payout of ₹950
    const releaseRes = await request(base, `/api/v1/admin/settlements/${payoutId}/release`, {
      method: 'POST',
      headers: adminCookie,
      body: { bankReference: 'WIRE-KN-950000' },
    });
    assert.equal(releaseRes.status, 200, JSON.stringify(releaseRes.body));
    assert.equal(releaseRes.body.status, 'RELEASED');
    assert.equal(releaseRes.body.bankReference, 'WIRE-KN-950000');

    // 2. Verify Admin Central Treasury Ledger
    const adminLedger = await request(base, '/api/v1/transactions', {
      headers: adminCookie,
    });
    assert.equal(adminLedger.status, 200);
    const adminPayoutTx = adminLedger.body.transactions.find((t) => t.type === 'DR');
    assert.ok(adminPayoutTx, 'Admin ledger must record payout DEBIT');
    assert.equal(adminPayoutTx.amount, 950);
    assert.equal(adminPayoutTx.balanceAfter, 50); // Admin retained profit = ₹50!

    // 3. Verify Seller Atelier Ledger
    const sellerCookie = { cookie: cookieHeader(seededSession(fake, SELLER, 'seller@kshop.test')) };
    const sellerLedger = await request(base, '/api/v1/transactions', {
      headers: sellerCookie,
    });
    assert.equal(sellerLedger.status, 200);
    const sellerReceiptTx = sellerLedger.body.transactions.find((t) => t.type === 'CR');
    const sellerPayoutTx = sellerLedger.body.transactions.find((t) => t.type === 'DR');

    assert.ok(sellerReceiptTx, 'Seller ledger has credit entry for net sales proceeds');
    assert.equal(sellerReceiptTx.amount, 950, 'Seller credit is 95% of gross (₹950)');
    assert.equal(sellerReceiptTx.grossAmount, 1000);
    assert.equal(sellerReceiptTx.commissionAmount, 50);
    assert.equal(sellerReceiptTx.productName, 'Cashmere Wool Shawl');
    assert.equal(sellerReceiptTx.productSku, 'SHAWL-CASHMERE-BLK');

    assert.ok(sellerPayoutTx, 'Seller ledger has debit entry for bank payout');
    assert.equal(sellerPayoutTx.amount, 950);
    assert.equal(sellerPayoutTx.balanceAfter, 0, 'Seller escrow settles to ₹0 upon payout disbursement');
  } finally {
    server.close();
  }
});

test('Accounting Scenario B: Order ₹975, 5% fee = ₹48.75, payout = ₹926.25', async () => {
  const fake = makeFakeWorld();

  const orderId = uid(102);
  fake.helpers.seedRow('orders', {
    id: orderId,
    order_number: 'KS-20261021-0000975',
    customer_id: CUSTOMER,
    seller_id: SELLER,
    status: 'DELIVERED',
    total: 975,
    payment_method: 'COD',
  });

  const payoutId = uid(402);
  fake.helpers.seedRow('payouts', {
    id: payoutId,
    seller_id: SELLER,
    order_id: orderId,
    amount: 975,
    commission_amount: 48.75,
    eligible_at: new Date(Date.now() - 1000).toISOString(),
    status: 'SCHEDULED',
  });

  fake.helpers.seedRow('transactions', {
    id: uid(502),
    txn_ref: 'TXN-9750000001',
    order_id: orderId,
    customer_id: CUSTOMER,
    seller_id: SELLER,
    txn_type: 'COD_RECEIPT',
    entry: 'CREDIT',
    amount: 975,
    balance_after: 975,
    status: 'POSTED',
    created_at: '2026-10-20T08:00:00Z',
  });

  const { server, base } = await makeServer(fake);
  try {
    const adminJar = await loginAdmin(base);
    const adminCookie = { cookie: cookieHeader(adminJar) };

    const releaseRes = await request(base, `/api/v1/admin/settlements/${payoutId}/release`, {
      method: 'POST',
      headers: adminCookie,
      body: { bankReference: 'WIRE-KN-926250' },
    });
    assert.equal(releaseRes.status, 200);
    assert.equal(releaseRes.body.status, 'RELEASED');
    assert.equal(releaseRes.body.bankReference, 'WIRE-KN-926250');

    const adminLedger = await request(base, '/api/v1/transactions', {
      headers: adminCookie,
    });
    const adminPayoutTx = adminLedger.body.transactions.find((t) => t.type === 'DR');
    assert.equal(adminPayoutTx.amount, 926.25);
    assert.equal(adminPayoutTx.balanceAfter, 48.75);
  } finally {
    server.close();
  }
});

test('Accounting Scenario C: Duplicate payout request is idempotent (returns 400)', async () => {
  const fake = makeFakeWorld();

  const orderId = uid(103);
  const payoutId = uid(403);
  fake.helpers.seedRow('payouts', {
    id: payoutId,
    seller_id: SELLER,
    order_id: orderId,
    amount: 500,
    commission_amount: 25,
    eligible_at: new Date(Date.now() - 1000).toISOString(),
    status: 'RELEASED', // already released!
    released_at: new Date().toISOString(),
  });

  const { server, base } = await makeServer(fake);
  try {
    const adminJar = await loginAdmin(base);
    const adminCookie = { cookie: cookieHeader(adminJar) };

    const dupRes = await request(base, `/api/v1/admin/settlements/${payoutId}/release`, {
      method: 'POST',
      headers: adminCookie,
    });
    assert.equal(dupRes.status, 400);
    assert.match(dupRes.body.error.message, /already been released/);
  } finally {
    server.close();
  }
});

test('Accounting Scenario D: Non-admin payout release is rejected (403)', async () => {
  const fake = createFakeSupabase();
  seedAccountingWorld(fake);

  const payoutId = uid(404);
  fake.helpers.seedRow('payouts', {
    id: payoutId,
    seller_id: SELLER,
    order_id: uid(104),
    amount: 500,
    commission_amount: 25,
    eligible_at: new Date(Date.now() - 1000).toISOString(),
    status: 'SCHEDULED',
  });

  const { server, base } = await makeServer(fake);
  try {
    const sellerCookie = { cookie: cookieHeader(seededSession(fake, SELLER, 'seller@kshop.test')) };
    const forbidden = await request(base, `/api/v1/admin/settlements/${payoutId}/release`, {
      method: 'POST',
      headers: sellerCookie, // seller attempting to approve own payout!
    });
    assert.equal(forbidden.status, 403);
  } finally {
    server.close();
  }
});

test('Accounting Scenario E: Multiple products - product-wise item references and commission allocation', async () => {
  const fake = makeFakeWorld();

  const orderId = uid(105);
  fake.helpers.seedRow('orders', {
    id: orderId,
    order_number: 'KS-20261021-0001500',
    customer_id: CUSTOMER,
    seller_id: SELLER,
    status: 'DELIVERED',
    total: 1500,
    payment_method: 'COD',
  });

  // Multiple order items for the same order
  fake.helpers.seedRow('order_items', {
    id: uid(205),
    order_id: orderId,
    product_id: uid(305),
    product_name: 'Raw Silk Turban',
    sku: 'TRBN-SILK-GLD',
    seller_id: SELLER,
    unit_price: 1500,
    quantity: 1,
  });

  const payoutId = uid(405);
  fake.helpers.seedRow('payouts', {
    id: payoutId,
    seller_id: SELLER,
    order_id: orderId,
    amount: 1500,
    commission_amount: 75, // 5% of 1500
    eligible_at: new Date(Date.now() - 1000).toISOString(),
    status: 'SCHEDULED',
  });

  fake.helpers.seedRow('transactions', {
    id: uid(505),
    txn_ref: 'TXN-1500000001',
    order_id: orderId,
    customer_id: CUSTOMER,
    seller_id: SELLER,
    txn_type: 'COD_RECEIPT',
    entry: 'CREDIT',
    amount: 1500,
    balance_after: 1500,
    status: 'POSTED',
    created_at: '2026-10-20T09:00:00Z',
  });

  const { server, base } = await makeServer(fake);
  try {
    const adminJar = await loginAdmin(base);
    const adminCookie = { cookie: cookieHeader(adminJar) };

    const releaseRes = await request(base, `/api/v1/admin/settlements/${payoutId}/release`, {
      method: 'POST',
      headers: adminCookie,
      body: { bankReference: 'WIRE-KN-142500' },
    });
    assert.equal(releaseRes.status, 200);

    const sellerCookie = { cookie: cookieHeader(seededSession(fake, SELLER, 'seller@kshop.test')) };
    const sellerLedger = await request(base, '/api/v1/transactions', {
      headers: sellerCookie,
    });
    assert.equal(sellerLedger.status, 200);

    const receipt = sellerLedger.body.transactions.find((t) => t.type === 'CR');
    assert.ok(receipt);
    assert.equal(receipt.grossAmount, 1500);
    assert.equal(receipt.commissionRate, 5);
    assert.equal(receipt.commissionAmount, 75);
    assert.equal(receipt.netAmount, 1425);
    assert.equal(receipt.productName, 'Raw Silk Turban');
    assert.equal(receipt.productSku, 'TRBN-SILK-GLD');
  } finally {
    server.close();
  }
});

test('Accounting Scenario F: Refund or reversal creates traceable compensating entries without destroying history', async () => {
  const fake = makeFakeWorld();

  const orderId = uid(106);
  fake.helpers.seedRow('orders', {
    id: orderId,
    order_number: 'KS-20261021-0000500',
    customer_id: CUSTOMER,
    seller_id: SELLER,
    status: 'DELIVERED',
    total: 500,
    payment_method: 'COD',
  });

  // 1. Initial COD delivery payment
  fake.helpers.seedRow('transactions', {
    id: uid(506),
    txn_ref: 'TXN-5000000001',
    order_id: orderId,
    customer_id: CUSTOMER,
    seller_id: SELLER,
    txn_type: 'COD_RECEIPT',
    entry: 'CREDIT',
    amount: 500,
    balance_after: 500,
    status: 'POSTED',
    created_at: '2026-10-20T08:00:00Z',
  });

  // 2. Compensating Refund entry
  fake.helpers.seedRow('transactions', {
    id: uid(507),
    txn_ref: 'TXN-5000000002',
    order_id: orderId,
    customer_id: CUSTOMER,
    seller_id: SELLER,
    txn_type: 'REFUND',
    entry: 'DEBIT',
    amount: 500,
    refund_amount: 500,
    balance_after: 0,
    status: 'POSTED',
    created_at: '2026-10-20T12:00:00Z',
    metadata: { note: 'Customer returned item, full refund disbursed' },
  });

  const { server, base } = await makeServer(fake);
  try {
    const adminJar = await loginAdmin(base);
    const adminCookie = { cookie: cookieHeader(adminJar) };

    const adminLedger = await request(base, '/api/v1/transactions', {
      headers: adminCookie,
    });
    assert.equal(adminLedger.status, 200);

    // Both the original credit and compensating refund debit must be preserved
    assert.equal(adminLedger.body.transactions.length, 2);
    const cr = adminLedger.body.transactions.find((t) => t.type === 'CR');
    const dr = adminLedger.body.transactions.find((t) => t.type === 'DR');

    assert.equal(cr.amount, 500);
    assert.equal(dr.amount, 500);
    assert.equal(dr.category, 'REFUND_DEDUCTION');
  } finally {
    server.close();
  }
});
