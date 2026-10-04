/**
 * Phase 6 — customer/seller profiles unit tests (fake Supabase, no network).
 *
 * Covers: onboarding POST /auth/profile (validation, IDOR-within-session,
 * onboardingComplete computation), PUT /auth/profile, and the seller
 * application POST /seller/applications (server-side truth for name/mobile,
 * duplicate rejection, status plumbing). Real HTTP round-trips through
 * createApp().
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';
import { hashPin } from '../src/lib/hash.js';

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

const cookieJar = (res) => {
  const jar = {};
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (idx > -1) jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return jar;
};

const cookieHeader = (jar) =>
  Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

/** OTP-verify a customer and return the session cookie jar (browser-like). */
async function signInCookies(fake, base, email = 'a@b.co') {
  const res = await request(base, '/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { email, otp: '123456' },
  });
  assert.equal(res.status, 200, 'OTP verify must succeed to obtain a session');
  return cookieJar(res);
}

const COMPLETE_PAYLOAD = {
  email: 'a@b.co',
  fullName: 'Alice Kumar',
  phone: '9876543210',
  gender: 'Female',
  category: 'ENGINEERING',
  userType: 'STUDENT',
  department: 'CSE',
  year: 'II',
  registrationNumber: '123456789012',
  staffCode: null,
};

// ── Customer onboarding (POST /auth/profile) ────────────────────────────────

test('onboarding requires a live session (401 when no cookie)', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/auth/profile', {
    method: 'POST',
    body: COMPLETE_PAYLOAD,
  });
  assert.equal(res.status, 401);
});

test('onboarding happy path: OTP → PIN → complete profile → { user } with onboardingComplete', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base);
  const pinRes = await request(base, '/api/v1/auth/pin/setup', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { email: 'a@b.co', pin: '1234' },
  });
  assert.equal(pinRes.status, 200);

  const res = await request(base, '/api/v1/auth/profile', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: COMPLETE_PAYLOAD,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'a@b.co');
  assert.equal(res.body.user.role, 'CUSTOMER');
  assert.equal(res.body.user.onboardingComplete, true, 'full profile + pin => complete');
  assert.equal(res.body.user.fullName, 'Alice Kumar');
  assert.equal(res.body.user.phone, '9876543210');

  const stored = fake.helpers.getProfile('usr-1');
  assert.equal(stored.full_name, 'Alice Kumar');
  assert.equal(stored.academic_year, 'II');
  assert.equal(stored.college_reg_no, '123456789012');
  assert.equal(stored.staff_code, null, 'student must not carry a staff code (DB CHECK parity)');

  const audit = fake._state.auditLogs.find((a) => a.action === 'customer.profile.completed');
  assert.ok(audit, 'onboarding must be recorded in the audit trail (§36)');
});

test('onboarding re-validates every field server-side (400 on cross-category department)', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base);
  const res = await request(base, '/api/v1/auth/profile', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { ...COMPLETE_PAYLOAD, department: 'Civil Engineering' /* polytechnic dept */ },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.message, 'Department is not valid for ENGINEERING.');
});

test('onboarding rejects a payload email that differs from the session user (403)', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base);
  const res = await request(base, '/api/v1/auth/profile', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { ...COMPLETE_PAYLOAD, email: 'other@x.co' },
  });
  assert.equal(res.status, 403);
});

// ── Profile update (PUT /auth/profile) ──────────────────────────────────────

test('profile update: valid name → { user }; invalid name → 400', async (t) => {
  const fake = createFakeSupabase();
  fake.helpers.seedProfile({
    id: 'usr-1',
    email: 'a@b.co',
    full_name: 'Alice Kumar',
    phone: '9876543210',
    gender: 'Female',
    category: 'ENGINEERING',
    user_type: 'STUDENT',
    department: 'CSE',
    academic_year: 'II',
    college_reg_no: '123456789012',
    pin_hash: hashPin('1234'),
    role: 'CUSTOMER',
    status: 'ACTIVE',
  });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base);
  const bad = await request(base, '/api/v1/auth/profile', {
    method: 'PUT',
    headers: { Cookie: cookieHeader(jar) },
    body: { fullName: 'Al1ce' },
  });
  assert.equal(bad.status, 400);

  const good = await request(base, '/api/v1/auth/profile', {
    method: 'PUT',
    headers: { Cookie: cookieHeader(jar) },
    body: { fullName: 'Alice M Kumar' },
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.user.fullName, 'Alice M Kumar');
  assert.equal(fake.helpers.getProfile('usr-1').full_name, 'Alice M Kumar');
});

// ── Seller application (POST /seller/applications) ──────────────────────────

const SELLER_PAYLOAD = {
  storeName: 'Alice Store',
  businessType: 'INDIVIDUAL',
  businessAddress: '12, College Road, Chennai',
  storeCategory: 'Fashion',
  agreeToTerms: true,
};

test('seller application: requires completed profile + auth; duplicate → 409', async (t) => {
  const fake = createFakeSupabase();
  fake.helpers.seedProfile({
    id: 'usr-1',
    email: 'a@b.co',
    full_name: 'Alice Kumar',
    phone: '9876543210',
    gender: 'Female',
    category: 'ENGINEERING',
    user_type: 'STUDENT',
    department: 'CSE',
    academic_year: 'II',
    college_reg_no: '123456789012',
    pin_hash: hashPin('1234'),
    role: 'CUSTOMER',
    status: 'ACTIVE',
  });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base);

  const res = await request(base, '/api/v1/seller/applications', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: SELLER_PAYLOAD,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.user.sellerStatus, 'PENDING', 'application flips seller status to PENDING');

  const seller = fake.helpers.getSellerProfile('usr-1');
  assert.ok(seller, 'seller_profiles row must be created');
  assert.equal(seller.store_name, 'Alice Store');
  assert.equal(seller.seller_name, 'Alice Kumar', 'seller name comes from the profile row (server truth)');
  assert.equal(seller.mobile, '9876543210', 'mobile comes from the profile row (server truth)');
  assert.equal(seller.business_type, 'INDIVIDUAL');
  assert.equal(seller.verification_status, 'PENDING');

  const audit = fake._state.auditLogs.find((a) => a.action === 'seller.application.submitted');
  assert.ok(audit, 'seller application must be audited');

  const dup = await request(base, '/api/v1/seller/applications', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: SELLER_PAYLOAD,
  });
  assert.equal(dup.status, 409);
});

test('seller application: rejected without auth / without a completed customer profile / without terms', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base); // stub profile — no full_name/phone

  const anon = await request(base, '/api/v1/seller/applications', {
    method: 'POST',
    body: SELLER_PAYLOAD,
  });
  assert.equal(anon.status, 401);

  const noName = await request(base, '/api/v1/seller/applications', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: SELLER_PAYLOAD,
  });
  assert.equal(noName.status, 400);
  assert.match(noName.body.error.message, /Complete your customer profile/);

  const noTerms = await request(base, '/api/v1/seller/applications', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { ...SELLER_PAYLOAD, agreeToTerms: false },
  });
  assert.equal(noTerms.status, 400);
  assert.match(noTerms.body.error.message, /COD Settlement Standards/);
});