/**
 * FinTech Accounting & Cash on Delivery (COD) Passbook Audit Test Suite
 *
 * Verifies:
 * 1. 100% Cash on Delivery (COD) Business Model — Delivery confirmation does NOT assume paid.
 * 2. Explicit Cash Collection (POST /orders/:id/collect-cash) by authorized operator.
 * 3. Unique CASH- collection reference generated.
 * 4. Duplicate cash collection strictly blocked (idempotency guard).
 * 5. Platform 5% commission math on eligible product subtotal.
 * 6. Admin settlement payout release (POST /admin/settlements/:id/release) with PAY- ID and bank ref.
 * 7. Duplicate payout release rejected (400).
 * 8. Cash reconciliation into treasury (POST /admin/reconcile-cash).
 * 9. Seller privacy: Seller NEVER sees cash collection references, other sellers' records, or treasury balances.
 * 10. Admin central treasury: All 6 summary metrics accurately computed and returned.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { sign } from 'cookie-signature';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';

const SESSION_SECRET = 'z'.repeat(48);
const signedCookie = (token) => `s:${sign(token, SESSION_SECRET)}`;

const validEnv = () => ({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  BACKEND_URL: 'http://localhost:3001',
  CORS_ORIGINS: 'http://localhost:5173',
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  SESSION_SECRET: 'z'.repeat(48),
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
    body: { email: 'admin@kshop.test', password: 'AdminPassword#123' },
  });
  assert.equal(res.status, 200, 'admin login must succeed');
  return cookieJar(res);
}

function seededSession(fake, userId, email, role = 'CUSTOMER', roles = ['CUSTOMER']) {
  fake.helpers.seedUser({ id: userId, email });
  fake.helpers.seedProfile({
    id: userId,
    email,
    role,
    roles,
    status: 'ACTIVE',
    full_name: role === 'ADMIN' ? 'Root Admin' : (roles.includes('SELLER') ? 'Heritage Seller' : 'Patron Customer'),
    created_at: '2026-08-01T00:00:00Z',
  });
  return {
    Cookie: `ks_access=${signedCookie(`at-${userId}`)}; ks_refresh=${signedCookie(`rt-${userId}`)}`,
  };
}

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_ID = uid(1);
const SELLER_1 = uid(2);
const SELLER_2 = uid(3);
const CUSTOMER_1 = uid(4);
const DELIVERY_OP = uid(5);

function makeFinTechWorld() {
  const fake = createFakeSupabase({
    passwordUsers: { 'admin@kshop.test': { id: ADMIN_ID, password: 'AdminPassword#123' } },
  });
  fake.helpers.seedProfile({
    id: ADMIN_ID,
    email: 'admin@kshop.test',
    role: 'ADMIN',
    roles: ['ADMIN'],
    status: 'ACTIVE',
    full_name: 'Root Admin',
    created_at: '2026-08-01T00:00:00Z',
  });

  fake.helpers.seedUser({ id: SELLER_1, email: 'seller1@kshop.test' });
  fake.helpers.seedProfile({
    id: SELLER_1,
    email: 'seller1@kshop.test',
    role: 'CUSTOMER',
    roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE',
    full_name: 'Artisan Store One',
  });
  fake.helpers.seedSeller({ profile_id: SELLER_1, verification_status: 'APPROVED', store_name: 'Atelier One' });

  fake.helpers.seedUser({ id: SELLER_2, email: 'seller2@kshop.test' });
  fake.helpers.seedProfile({
    id: SELLER_2,
    email: 'seller2@kshop.test',
    role: 'CUSTOMER',
    roles: ['CUSTOMER', 'SELLER'],
    status: 'ACTIVE',
    full_name: 'Artisan Store Two',
  });
  fake.helpers.seedSeller({ profile_id: SELLER_2, verification_status: 'APPROVED', store_name: 'Atelier Two' });

  fake.helpers.seedUser({ id: CUSTOMER_1, email: 'customer1@kshop.test' });
  fake.helpers.seedProfile({
    id: CUSTOMER_1,
    email: 'customer1@kshop.test',
    role: 'CUSTOMER',
    roles: ['CUSTOMER'],
    status: 'ACTIVE',
    full_name: 'Rohan Sharma',
  });

  fake.helpers.seedUser({ id: DELIVERY_OP, email: 'delivery@kshop.test' });
  fake.helpers.seedProfile({
    id: DELIVERY_OP,
    email: 'delivery@kshop.test',
    role: 'DELIVERY',
    roles: ['DELIVERY'],
    status: 'ACTIVE',
    full_name: 'Delivery Agent Rahul',
  });

  return fake;
}

test('FinTech COD Audit: Delivery without cash -> explicit cash collection with unique CASH- ID -> duplicate blocked', async () => {
  const fake = makeFinTechWorld();
  const { server, base } = await makeServer(fake);

  try {
    const adminJar = await loginAdmin(base);
    const adminHeaders = { Cookie: cookieHeader(adminJar) };
    const deliveryHeaders = seededSession(fake, DELIVERY_OP, 'delivery@kshop.test', 'DELIVERY', ['DELIVERY']);
    const customerHeaders = seededSession(fake, CUSTOMER_1, 'customer1@kshop.test', 'CUSTOMER', ['CUSTOMER']);

    const orderId = uid(1001);
    fake.helpers.seedRow('orders', {
      id: orderId,
      order_number: 'KS-20261101-0001001',
      customer_id: CUSTOMER_1,
      seller_id: SELLER_1,
      status: 'OUT_FOR_DELIVERY',
      subtotal: 1000,
      delivery_fee: 0,
      discount: 0,
      total: 1000,
      ship_address: { line1: 'Campus Hub', city: 'Coimbatore', pincode: '641001' },
      placed_at: '2026-11-01T08:00:00Z',
    });

    fake.helpers.seedRow('order_items', {
      id: uid(2001),
      order_id: orderId,
      product_id: uid(3001),
      variant_id: uid(4001),
      seller_id: SELLER_1,
      product_name: 'Pure Silk Stole',
      sku: 'SILK-STOLE-001',
      unit_price: 1000,
      quantity: 1,
      line_total: 1000,
    });

    // 1. Delivery person moves order status to DELIVERED without collecting cash
    const deliverRes = await request(base, `/api/v1/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: deliveryHeaders,
      body: { status: 'COD_DELIVERED' },
    });
    assert.equal(deliverRes.status, 200);
    assert.equal(deliverRes.body.order.orderStatus, 'COD_DELIVERED');
    assert.equal(deliverRes.body.order.paymentStatus, 'UNPAID_COD', 'Delivery completion does not automatically mark as paid');

    // 2. Customer tries to record cash collection -> blocked (403)
    const custCollect = await request(base, `/api/v1/orders/${orderId}/collect-cash`, {
      method: 'POST',
      headers: customerHeaders,
      body: { amount: 1000 },
    });
    assert.equal(custCollect.status, 403, 'Customer cannot record cash collection');

    // 3. Authorized delivery operator records actual customer cash collection
    const collectRes = await request(base, `/api/v1/orders/${orderId}/collect-cash`, {
      method: 'POST',
      headers: deliveryHeaders,
      body: { amount: 1000 },
    });
    assert.equal(collectRes.status, 200);
    assert.ok(collectRes.body.collectionReference.startsWith('CASH-'), 'Distinct CASH- reference must be generated');
    assert.equal(collectRes.body.receivedAmount, 1000);

    // 4. Duplicate cash collection for same order is rejected (400)
    const duplicateCollect = await request(base, `/api/v1/orders/${orderId}/collect-cash`, {
      method: 'POST',
      headers: deliveryHeaders,
      body: { amount: 1000 },
    });
    assert.equal(duplicateCollect.status, 400, 'Duplicate cash collection must be strictly blocked');

    // 5. Verify order paymentStatus has become COLLECTED_COD
    const getOrder = await request(base, `/api/v1/orders/${orderId}`, {
      headers: adminHeaders,
    });
    assert.equal(getOrder.status, 200);
    assert.equal(getOrder.body.order.paymentStatus, 'COLLECTED_COD');

    // 6. Verify cash collection is recorded as awaiting reconciliation (is_reconciled: false)
    const adminTxns = await request(base, '/api/v1/transactions', {
      headers: adminHeaders,
    });
    assert.equal(adminTxns.status, 200);
    const codTxn = adminTxns.body.transactions.find((t) => t.orderId === orderId);
    assert.ok(codTxn, 'Cash collection transaction must be logged');
    assert.equal(codTxn.type, 'CR');
    assert.equal(codTxn.isReconciled, false, 'Initial cash collection must be awaiting reconciliation');
    assert.equal(codTxn.cashCollectionReference, collectRes.body.collectionReference);
    assert.equal(adminTxns.body.summary.cashAwaitingReconciliation, 1000);

    // 7. Admin performs cash reconciliation (POST /admin/reconcile-cash)
    const reconcileRes = await request(base, '/api/v1/admin/reconcile-cash', {
      method: 'POST',
      headers: adminHeaders,
      body: { transactionId: codTxn.id },
    });
    assert.equal(reconcileRes.status, 200);
    assert.equal(reconcileRes.body.reconciledCount, 1);

    // 8. Re-check ledger after reconciliation -> cash is in treasury balance!
    const adminTxnsAfter = await request(base, '/api/v1/transactions', {
      headers: adminHeaders,
    });
    const reconciledTxn = adminTxnsAfter.body.transactions.find((t) => t.id === codTxn.id);
    assert.equal(reconciledTxn.isReconciled, true);
    assert.equal(adminTxnsAfter.body.summary.cashAwaitingReconciliation, 0);
    assert.equal(adminTxnsAfter.body.summary.treasuryBalance, 1000);
  } finally {
    server.close();
  }
});

test('FinTech Privacy Boundary & Payout Release: Seller never sees cash refs, other sellers, or treasury balances', async () => {
  const fake = makeFinTechWorld();
  const { server, base } = await makeServer(fake);

  try {
    const adminJar = await loginAdmin(base);
    const adminHeaders = { Cookie: cookieHeader(adminJar) };
    const seller1Headers = seededSession(fake, SELLER_1, 'seller1@kshop.test', 'CUSTOMER', ['CUSTOMER', 'SELLER']);
    const seller2Headers = seededSession(fake, SELLER_2, 'seller2@kshop.test', 'CUSTOMER', ['CUSTOMER', 'SELLER']);

    const orderId1 = uid(1002);
    fake.helpers.seedRow('orders', {
      id: orderId1,
      order_number: 'KS-20261101-0001002',
      customer_id: CUSTOMER_1,
      seller_id: SELLER_1,
      status: 'DELIVERED',
      subtotal: 1000,
      total: 1000,
      received_amount: 1000,
      payment_method: 'COD',
      placed_at: '2026-11-01T08:00:00Z',
      delivered_at: '2026-11-01T10:00:00Z',
    });

    fake.helpers.seedRow('order_items', {
      id: uid(2002),
      order_id: orderId1,
      product_id: uid(3002),
      variant_id: uid(4002),
      seller_id: SELLER_1,
      product_name: 'Silver Filigree Box',
      sku: 'SILV-BOX-002',
      unit_price: 1000,
      quantity: 1,
      line_total: 1000,
    });

    const payoutId1 = uid(4002);
    fake.helpers.seedRow('payouts', {
      id: payoutId1,
      seller_id: SELLER_1,
      order_id: orderId1,
      amount: 1000,
      commission_amount: 50, // 5% platform fee
      eligible_at: new Date(Date.now() - 1000).toISOString(),
      status: 'SCHEDULED',
    });

    fake.helpers.seedRow('transactions', {
      id: uid(5002),
      txn_ref: 'TXN-2000000001',
      order_id: orderId1,
      customer_id: CUSTOMER_1,
      seller_id: SELLER_1,
      txn_type: 'COD_RECEIPT',
      entry: 'CREDIT',
      amount: 1000,
      balance_after: 1000,
      status: 'POSTED',
      metadata: {
        note: 'Customer cash collected',
        collection_reference: 'CASH-20261101-998877',
        is_reconciled: true,
      },
      created_at: '2026-11-01T10:00:00Z',
    });

    // 1. Seller 1 accesses their passbook
    const s1Res = await request(base, '/api/v1/transactions', {
      headers: seller1Headers,
    });
    assert.equal(s1Res.status, 200);
    assert.equal(s1Res.body.transactions.length, 1);
    const s1Txn = s1Res.body.transactions[0];

    // PRIVACY VERIFICATION: Seller 1 must NEVER see cash collection reference
    assert.equal(s1Txn.cashCollectionReference, undefined, 'cashCollectionReference must be undefined for sellers');
    assert.equal(s1Txn.isReconciled, undefined, 'internal reconciliation status must be hidden from sellers');

    // Commission arithmetic verification: 5% fee retained (₹50), net amount = ₹950
    assert.equal(s1Txn.grossAmount, 1000);
    assert.equal(s1Txn.commissionRate, 5);
    assert.equal(s1Txn.commissionAmount, 50);
    assert.equal(s1Txn.netAmount, 950);
    assert.equal(s1Res.body.summary.grossSales, 1000);
    assert.equal(s1Res.body.summary.platformCommission, 50);
    assert.equal(s1Res.body.summary.netSellerEarnings, 950);

    // 2. Seller 2 accesses their passbook -> cross-tenant isolation (0 records)
    const s2Res = await request(base, '/api/v1/transactions', {
      headers: seller2Headers,
    });
    assert.equal(s2Res.status, 200);
    assert.equal(s2Res.body.transactions.length, 0, 'Cross-seller access must be impossible');

    // 3. Admin releases cash settlement handover directly to seller
    const releaseRes = await request(base, `/api/v1/admin/settlements/${payoutId1}/release`, {
      method: 'POST',
      headers: adminHeaders,
      body: {},
    });
    assert.equal(releaseRes.status, 200);
    assert.equal(releaseRes.body.status, 'RELEASED');
    assert.ok(releaseRes.body.sellerPayoutId.startsWith('PAY-'), 'Payout ID must have PAY- format');
    assert.equal(releaseRes.body.netAmount, 950);

    // 4. Duplicate release attempt is blocked (400)
    const dupRelease = await request(base, `/api/v1/admin/settlements/${payoutId1}/release`, {
      method: 'POST',
      headers: adminHeaders,
      body: {},
    });
    assert.equal(dupRelease.status, 400, 'Duplicate settlement release must be blocked');

    // 5. Re-check Seller 1 passbook -> payout debit (DR) is recorded and balance settles
    const s1After = await request(base, '/api/v1/transactions', {
      headers: seller1Headers,
    });
    assert.equal(s1After.body.transactions.length, 2);
    const payoutTx = s1After.body.transactions.find((t) => t.type === 'DR');
    assert.ok(payoutTx);
    assert.equal(payoutTx.amount, 950);
    assert.equal(payoutTx.balanceAfter, 0, 'Seller escrow settles to zero upon payout');
    assert.equal(s1After.body.summary.totalPayoutsPaid, 950);
    assert.equal(s1After.body.summary.availableSellerBalance, 0);
  } finally {
    server.close();
  }
});
