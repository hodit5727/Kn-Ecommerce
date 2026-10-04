/**
 * Phase 4 — auth/session/admin-auth unit tests (fake Supabase, no network).
 *
 * These prove the backend's OWN behaviour: error shapes, cookies, rate
 * limits, CSRF, role gates, header checks — with real HTTP round-trips
 * through createApp(). Live Supabase behaviour is verified separately by
 * tests/live-smoke.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';
import { hashPin, verifyPin, hashResetCode } from '../src/lib/hash.js';

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

/** Read the cookies a response set, so we can replay them (browser-like). */
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
const hasCookieFlag = (res, name, flag) => {
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const entry = setCookies.find((c) => c.startsWith(`${name}=`));
  if (!entry) return false;
  return entry.toLowerCase().includes(flag.toLowerCase());
};

// ────────────────────────────────────────────────────────────────────────────
test('health endpoint responds and sets security headers', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('unknown routes return structured 404', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: { message: 'Not found.' } });
});

test('GET /auth/session without cookies → 200 { user: null } (contract)', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/auth/session');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { user: null });
});

test('POST /auth/otp/send rejects an invalid email with 400', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/auth/otp/send', {
    method: 'POST',
    body: { email: 'not-an-email' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.message, 'Enter a valid email address.');
});

test('POST /auth/otp/send succeeds and never leaks upstream details on 502', async (t) => {
  const fake = createFakeSupabase({ otpSendError: 'SENTINEL_INTERNAL_SMTP_FAILURE' });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const bad = await request(base, '/api/v1/auth/otp/send', {
    method: 'POST',
    body: { email: 'a@b.co' },
  });
  assert.equal(bad.status, 502);
  assert.equal(bad.body.error.message, 'Unable to send the verification code. Please try again later.');
  assert.ok(!JSON.stringify(bad.body).includes('SENTINEL'));

  const good = createFakeSupabase();
  const { server: s2, base: b2 } = await makeServer(good);
  t.after(() => s2.close());
  const okRes = await request(b2, '/api/v1/auth/otp/send', {
    method: 'POST',
    body: { email: 'a@b.co' },
  });
  assert.equal(okRes.status, 200);
  assert.equal(okRes.body.success, true);
});

test('OTP verify happy path sets HttpOnly SameSite=Lax cookies + requiresProfile', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { email: 'a@b.co', otp: '123456' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.requiresProfile, true); // stub row has no profile fields yet

  assert.ok(hasCookieFlag(res, 'ks_access', 'HttpOnly'));
  assert.ok(hasCookieFlag(res, 'ks_access', 'SameSite=Lax'));
  assert.ok(hasCookieFlag(res, 'ks_refresh', 'HttpOnly'));

  // Profile stub was upserted server-side.
  const stored = fake.helpers.getProfile('usr-1');
  assert.ok(stored, 'profile stub must exist');
  assert.equal(stored.email, 'a@b.co');

  // Session round-trip: replay cookies → server resolves the user.
  const jar = cookieJar(res);
  const sessionRes = await request(base, '/api/v1/auth/session', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(sessionRes.status, 200);
  assert.equal(sessionRes.body.user.email, 'a@b.co');
  assert.equal(sessionRes.body.user.onboardingComplete, false);
});

test('OTP verify → requiresProfile=false when the profile is already complete', async (t) => {
  const fake = createFakeSupabase();
  fake.helpers.seedProfile({
    id: 'usr-1',
    email: 'a@b.co',
    full_name: 'Alice Kumar',
    phone: '9876543210',
    gender: 'Female',
    category: 'ENGINEERING',
    user_type: 'STUDENT',
    pin_hash: 'scrypt$16384$8$1$ab$cd',
    department: 'CSE',
    academic_year: 'II',
    college_reg_no: '123456789012',
    role: 'CUSTOMER',
    status: 'ACTIVE',
  });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { email: 'a@b.co', otp: '123456' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.requiresProfile, false);

  const jar = cookieJar(res);
  const session = await request(base, '/api/v1/auth/session', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(session.status, 200);
  assert.equal(session.body.user.onboardingComplete, true);
  assert.equal(session.body.user.fullName, 'Alice Kumar');
  assert.equal(session.body.user.category, 'ENGINEERING');
  assert.equal(session.body.user.sellerStatus, 'NONE');
});

test('OTP verify with an arbitrary session error → generic 400 (no detail leaked)', async (t) => {
  const fake = createFakeSupabase({ otpVerifyError: 'SENTINEL_TOKEN_REVOKED' });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { email: 'a@b.co', otp: '000000' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.message, 'Invalid or expired verification code.');
  assert.ok(!JSON.stringify(res.body).includes('SENTINEL'));
});

// ── Admin email gate: administrator accounts never enter the customer OTP /
//    PIN flow (the fix for the step-3 flip between "set PIN" and "verify PIN"
//    when the bootstrap admin email was used for customer onboarding) ────────
const ADMIN_GATE_MESSAGE = 'This email belongs to an administrator account. Use the admin sign-in instead.';

test('OTP verify with an ADMIN profile → 403 admin gate, no session cookie', async (t) => {
  const fake = createFakeSupabase({ verifyUserId: 'adm-g1' });
  fake.helpers.seedUser({ id: 'adm-g1', email: 'root@kshop.test' });
  fake.helpers.seedProfile({ id: 'adm-g1', email: 'root@kshop.test', role: 'ADMIN', status: 'ACTIVE' });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { email: 'root@kshop.test', otp: '123456' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.message, ADMIN_GATE_MESSAGE);
  assert.ok(!hasCookieFlag(res, 'ks_access', 'HttpOnly'), 'no session cookie may be issued');
  assert.ok(!hasCookieFlag(res, 'ks_refresh', 'HttpOnly'));
});

test('PIN setup with an ADMIN session → 403 admin gate, no PIN stored', async (t) => {
  const fake = createFakeSupabase({
    passwordUsers: { 'root@kshop.test': { id: 'adm-g2', password: 'AdminPass#123' } },
  });
  fake.helpers.seedUser({ id: 'adm-g2', email: 'root@kshop.test' });
  fake.helpers.seedProfile({ id: 'adm-g2', email: 'root@kshop.test', role: 'ADMIN', status: 'ACTIVE' });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const login = await request(base, '/api/v1/admin/auth/login', {
    method: 'POST',
    body: { email: 'root@kshop.test', password: 'AdminPass#123' },
  });
  assert.equal(login.status, 200);
  const jar = cookieJar(login);

  const res = await request(base, '/api/v1/auth/pin/setup', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { email: 'root@kshop.test', pin: '1234' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.message, ADMIN_GATE_MESSAGE);
  assert.equal(fake.helpers.getProfile('adm-g2').pin_hash, undefined, 'no PIN may be stored on an admin');
});

test('PIN verify with an ADMIN session → 403 admin gate (no PIN brute-force surface)', async (t) => {
  const fake = createFakeSupabase({
    passwordUsers: { 'root@kshop.test': { id: 'adm-g3', password: 'AdminPass#123' } },
  });
  fake.helpers.seedUser({ id: 'adm-g3', email: 'root@kshop.test' });
  fake.helpers.seedProfile({ id: 'adm-g3', email: 'root@kshop.test', role: 'ADMIN', status: 'ACTIVE', pin_hash: 'x' });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const login = await request(base, '/api/v1/admin/auth/login', {
    method: 'POST',
    body: { email: 'root@kshop.test', password: 'AdminPass#123' },
  });
  const jar = cookieJar(login);

  const res = await request(base, '/api/v1/auth/pin/verify', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { email: 'root@kshop.test', pin: '1234' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.message, ADMIN_GATE_MESSAGE);
});

// ── Admin auth ─────────────────────────────────────────────────────────────
const adminEnv = (status = 'ACTIVE', role = 'ADMIN') => {
  const fake = createFakeSupabase({
    passwordUsers: { 'root@kshop.test': { id: 'adm-1', password: 'AdminPass#123' } },
  });
  fake.helpers.seedProfile({
    id: 'adm-1',
    email: 'root@kshop.test',
    role,
    status,
  });
  return fake;
};

test('admin login: wrong password → 401 generic (no enumeration)', async (t) => {
  const fake = adminEnv();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/admin/auth/login', {
    method: 'POST',
    body: { email: 'root@kshop.test', password: 'WrongPass' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.message, 'Invalid email or password.');
});

test('admin login: correct password but CUSTOMER role → 403 Admin access denied', async (t) => {
  const fake = adminEnv('ACTIVE', 'CUSTOMER');
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/admin/auth/login', {
    method: 'POST',
    body: { email: 'root@kshop.test', password: 'AdminPass#123' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.message, 'Admin access denied.');
});

test('admin login: suspended admin → 403', async (t) => {
  const fake = adminEnv('SUSPENDED', 'ADMIN');
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/admin/auth/login', {
    method: 'POST',
    body: { email: 'root@kshop.test', password: 'AdminPass#123' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.message, 'Account suspended. Please contact support.');
});

test('admin login: success → { user } with ADMIN role, session cookie, audit record', async (t) => {
  const fake = adminEnv();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/admin/auth/login', {
    method: 'POST',
    body: { email: 'root@kshop.test', password: 'AdminPass#123' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'ADMIN');
  assert.equal(res.body.user.onboardingComplete, true);
  assert.ok(hasCookieFlag(res, 'ks_access', 'HttpOnly'));
  assert.equal(fake.helpers.auditCount(), 1, 'admin.login must be audited');

  const jar = cookieJar(res);
  const session = await request(base, '/api/v1/auth/session', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(session.status, 200);
  assert.equal(session.body.user.role, 'ADMIN');
});

// ── CSRF / CORS / rate limits ──────────────────────────────────────────────
test('cross-origin state-changing request from a non-allowlisted origin → 403', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const evil = await request(base, '/api/v1/auth/otp/send', {
    method: 'POST',
    body: { email: 'a@b.co' },
    headers: { Origin: 'http://evil.example' },
  });
  assert.equal(evil.status, 403);
  assert.equal(evil.body.error.message, 'Request origin not allowed.');

  const trusted = await request(base, '/api/v1/auth/otp/send', {
    method: 'POST',
    body: { email: 'a@b.co' },
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(trusted.status, 200);
});

test('OTP send is rate limited per account+IP (3 / 10 min) → 429 JSON', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  for (let i = 0; i < 3; i += 1) {
    const res = await request(base, '/api/v1/auth/otp/send', {
      method: 'POST',
      body: { email: 'rate@test.co' },
    });
    assert.equal(res.status, 200, `request ${i + 1} should succeed`);
  }
  const fourth = await request(base, '/api/v1/auth/otp/send', {
    method: 'POST',
    body: { email: 'rate@test.co' },
  });
  assert.equal(fourth.status, 429);
  assert.equal(typeof fourth.body.error.message, 'string');
});

// ── Suspension + logout lifecycle ──────────────────────────────────────────
test('suspended user session → 403; logout revokes the server-side session', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const verify = await request(base, '/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { email: 'a@b.co', otp: '123456' },
  });
  const jar = cookieJar(verify);

  // Admin suspends the account → sessions stop working immediately (§5-20).
  fake.helpers.setProfile('usr-1', { status: 'SUSPENDED' });
  const suspended = await request(base, '/api/v1/auth/session', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(suspended.status, 403);
  assert.equal(suspended.body.error.message, 'Account suspended. Please contact support.');

  // Re-activate → logout clears cookies AND revokes the session.
  fake.helpers.setProfile('usr-1', { status: 'ACTIVE' });
  const logout = await request(base, '/api/v1/auth/logout', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: {},
  });
  assert.equal(logout.status, 200);
  assert.equal(logout.body.success, true);
  const clearedCookies = logout.headers.getSetCookie?.() ?? [];
  const clearedAccess = clearedCookies.find((c) => c.startsWith('ks_access='));
  assert.ok(clearedAccess, 'ks_access cookie must be cleared');
  assert.ok(
    /^ks_access=;/.test(clearedAccess) || /Expires=Thu, 01 Jan 1970/i.test(clearedAccess),
    `expected a cleared ks_access cookie, got: ${clearedAccess}`,
  );

  // Replaying the stale cookie now resolves to signed-out (session revoked).
  const stale = await request(base, '/api/v1/auth/session', {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(stale.status, 200);
  assert.deepEqual(stale.body, { user: null });
});

// ── Phase 5: customer PIN system (spec §5/§6) ───────────────────────────────
/** OTP-verify a customer and return the session cookie jar (browser-like). */
async function signInCookies(fake, base, email = 'a@b.co') {
  const res = await request(base, '/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { email, otp: '123456' },
  });
  assert.equal(res.status, 200, 'OTP verify must succeed to obtain a session');
  return cookieJar(res);
}

test('PIN setup stores only a hash, reports requiresProfile, and audits', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base);
  const res = await request(base, '/api/v1/auth/pin/setup', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { email: 'a@b.co', pin: '1234' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.requiresProfile, true); // stub is not onboarded yet

  const stored = fake.helpers.getProfile('usr-1');
  assert.ok(stored.pin_hash && stored.pin_hash !== '1234', 'PIN must never be stored in plaintext (§5)');
  assert.ok(verifyPin('1234', stored.pin_hash), 'stored hash must verify the PIN');
  assert.equal(stored.pin_failed_attempts, 0);
  const audit = fake._state.auditLogs.find((a) => a.action === 'customer.pin.setup');
  assert.ok(audit, 'PIN setup must be recorded in the audit trail (§36)');
});

test('PIN setup requires a session (401) and body email must match the session (403)', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const anon = await request(base, '/api/v1/auth/pin/setup', {
    method: 'POST',
    body: { email: 'a@b.co', pin: '1234' },
  });
  assert.equal(anon.status, 401);

  const jar = await signInCookies(fake, base);
  const mismatch = await request(base, '/api/v1/auth/pin/setup', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { email: 'other@x.co', pin: '1234' },
  });
  assert.equal(mismatch.status, 403);
});

test('PIN verify happy path returns the user and clears failed-attempt state', async (t) => {
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
    pin_failed_attempts: 2,
    pin_locked_until: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
  });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base);
  const res = await request(base, '/api/v1/auth/pin/verify', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { email: 'a@b.co', pin: '1234' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'a@b.co');
  assert.equal(res.body.user.fullName, 'Alice Kumar');
  assert.equal(res.body.user.onboardingComplete, true);
  assert.equal(fake.helpers.getProfile('usr-1').pin_failed_attempts, 0, 'success clears attempts');
});

test('PIN verify: wrong PIN counts attempts, 5th failure locks, locked → 429', async (t) => {
  const fake = createFakeSupabase();
  fake.helpers.seedProfile({
    id: 'usr-1',
    email: 'a@b.co',
    pin_hash: hashPin('1234'),
    pin_failed_attempts: 4,
    pin_locked_until: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
  });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base);
  const wrong = await request(base, '/api/v1/auth/pin/verify', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { email: 'a@b.co', pin: '9999' },
  });
  assert.equal(wrong.status, 400);
  assert.ok(fake.helpers.getProfile('usr-1').pin_locked_until, '5th failure must lock the PIN');

  const locked = await request(base, '/api/v1/auth/pin/verify', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { email: 'a@b.co', pin: '1234' },
  });
  assert.equal(locked.status, 429);
  assert.match(locked.body.error.message, /Try again in about/);
});

test('PIN verify rejects when no PIN is set yet', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base);
  const res = await request(base, '/api/v1/auth/pin/verify', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { email: 'a@b.co', pin: '1234' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /No PIN has been set/);
});

test('PIN change requires the current PIN, then rotates the stored hash', async (t) => {
  const fake = createFakeSupabase();
  fake.helpers.seedProfile({
    id: 'usr-1',
    email: 'a@b.co',
    pin_hash: hashPin('1111'),
    pin_failed_attempts: 0,
    pin_locked_until: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
  });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const jar = await signInCookies(fake, base);
  const bad = await request(base, '/api/v1/auth/pin/change', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { currentPin: '0000', newPin: '2222' },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.message, 'Current PIN is incorrect.');

  const good = await request(base, '/api/v1/auth/pin/change', {
    method: 'POST',
    headers: { Cookie: cookieHeader(jar) },
    body: { currentPin: '1111', newPin: '2222' },
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.success, true);
  const stored = fake.helpers.getProfile('usr-1');
  assert.ok(verifyPin('2222', stored.pin_hash), 'new PIN must verify');
  assert.ok(!verifyPin('1111', stored.pin_hash), 'old PIN must not verify anymore');
});

test('forgot PIN: identical generic response for unknown email and known account', async (t) => {
  const fake1 = createFakeSupabase();
  const { server: s1, base: b1 } = await makeServer(fake1);
  t.after(() => s1.close());
  const unknown = await request(b1, '/api/v1/auth/pin/forgot', {
    method: 'POST',
    body: { email: 'ghost@x.co' },
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.message, 'If an account exists for this email, a reset code has been sent.');

  // Known account, but the TEST env has no SMTP → the mail send fails loudly
  // server-side while the client still gets the same generic answer.
  const fake2 = createFakeSupabase();
  fake2.helpers.seedUser({ id: 'usr-1', email: 'a@b.co' });
  fake2.helpers.seedProfile({ id: 'usr-1', email: 'a@b.co', role: 'CUSTOMER', status: 'ACTIVE' });
  const { server: s2, base: b2 } = await makeServer(fake2);
  t.after(() => s2.close());
  const known = await request(b2, '/api/v1/auth/pin/forgot', {
    method: 'POST',
    body: { email: 'a@b.co' },
  });
  assert.equal(known.status, 200);
  assert.equal(known.body.message, unknown.body.message, 'response must be byte-identical');

  const { data: authData } = await fake2.service.auth.admin.getUserById('usr-1');
  const meta = authData.user.app_metadata ?? {};
  assert.ok(meta.pin_reset_code_hash, 'reset code must be stored hashed server-side');
  assert.ok(meta.pin_reset_expires_at, 'reset expiry must be stored server-side');
});

test('PIN reset: wrong/unknown → generic 400; correct code rotates PIN and voids the code', async (t) => {
  const fake = createFakeSupabase();
  fake.helpers.seedUser({ id: 'usr-1', email: 'a@b.co' });
  fake.helpers.seedProfile({ id: 'usr-1', email: 'a@b.co', role: 'CUSTOMER', status: 'ACTIVE' });

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await fake.service.auth.admin.updateUserById('usr-1', {
    app_metadata: {
      pin_reset_code_hash: hashResetCode('654321', 'usr-1', expiresAt),
      pin_reset_expires_at: expiresAt,
      pin_reset_attempts: 0,
    },
  });
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  // Unknown email → the SAME generic failure (no enumeration, §5-14).
  const ghost = await request(base, '/api/v1/auth/pin/reset', {
    method: 'POST',
    body: { email: 'ghost@x.co', token: '654321', pin: '2468' },
  });
  assert.equal(ghost.status, 400);
  assert.equal(ghost.body.error.message, 'Invalid or expired reset code.');

  // Wrong code → generic 400.
  const wrong = await request(base, '/api/v1/auth/pin/reset', {
    method: 'POST',
    body: { email: 'a@b.co', token: '111111', pin: '2468' },
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.message, 'Invalid or expired reset code.');

  // Correct code → PIN rotated + code voided + cookies cleared.
  const good = await request(base, '/api/v1/auth/pin/reset', {
    method: 'POST',
    body: { email: 'a@b.co', token: '654321', pin: '2468' },
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.message, 'PIN updated. Please sign in with your new PIN.');
  const stored = fake.helpers.getProfile('usr-1');
  assert.ok(verifyPin('2468', stored.pin_hash), 'new PIN must be stored hashed');

  const { data: authData } = await fake.service.auth.admin.getUserById('usr-1');
  assert.equal(authData.user.app_metadata.pin_reset_code_hash, null, 'reset code must be voided');
  assert.equal(authData.user.app_metadata.pin_reset_attempts, 0, 'reset attempts reset');

  // Reuse of the same code → rejected.
  const reuse = await request(base, '/api/v1/auth/pin/reset', {
    method: 'POST',
    body: { email: 'a@b.co', token: '654321', pin: '1357' },
  });
  assert.equal(reuse.status, 400);
});

test('forgot PIN is rate limited (3 / 15 min) per account+IP → 429', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  for (let i = 0; i < 3; i += 1) {
    const res = await request(base, '/api/v1/auth/pin/forgot', {
      method: 'POST',
      body: { email: 'rate@test.co' },
    });
    assert.equal(res.status, 200, `request ${i + 1} should succeed`);
  }
  const fourth = await request(base, '/api/v1/auth/pin/forgot', {
    method: 'POST',
    body: { email: 'rate@test.co' },
  });
  assert.equal(fourth.status, 429);
  assert.equal(typeof fourth.body.error.message, 'string');
});