/**
 * Upstream (Supabase/PostgREST/network) failure handling — unit + route tests.
 *
 * WHY THIS FILE EXISTS: the real supabase-js builder is a THENABLE that
 * RESOLVES with `{ data, error }` — it does not throw. A first attempt at this
 * work converted every error into an HttpError before the retry layer could
 * see it, which silently disabled the retry and was invisible to a test whose
 * fake threw instead. These tests pin the resolve-with-error shape so that
 * regression cannot come back.
 *
 * Guarantees under test:
 *   1. The real OS cause (ECONNRESET, ENOTFOUND, …) is visible in the SERVER
 *      log instead of a bare `TypeError: fetch failed` (AGENTS.md §2.7).
 *   2. A token-shaped secret can never reach the log (AGENTS.md §2.9).
 *   3. A transport blip is retried ONCE and the real result is returned.
 *   4. A real outage still FAILS with an honest 502 — never mock/empty data
 *      (AGENTS.md §2.5, §2.6, §2.13).
 *   5. A PostgREST/SQL/RLS failure is NEVER retried — a real bug must not be
 *      masked by a retry (AGENTS.md §2.7).
 *   6. The client response never contains an internal detail (AGENTS.md §5-80).
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';
import {
  HttpError,
  describeUpstreamError,
  httpError,
  isTransientUpstreamError,
  withReadRetry,
} from '../src/lib/errors.js';

const ENV = () => ({
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
  const env = loadEnv(ENV());
  const app = createApp({ env, supabase });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const get = async (base, path) => {
  const res = await fetch(`${base}${path}`, { method: 'GET' });
  // Read the body ONCE, then parse from the text: calling res.json() and
  // res.text() on the same response would throw "body used already".
  const text = await res.text();
  let body = null;
  let parseFailed = false;
  try {
    body = JSON.parse(text);
  } catch (err) {
    parseFailed = true;
    assert.fail(`response body was not JSON (${err.name}): ${text.slice(0, 120)}`);
  }
  return { status: res.status, body, text, parseFailed };
};

/** The exact error shape Node's fetch produces for a dead pooled socket. */
function transportError(code = 'ECONNRESET', message = 'read ECONNRESET') {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error(message), { code });
  return err;
}

/**
 * A fake whose `products` read resolves with the given error (never throws),
 * counting attempts so the retry policy is observable.
 */
function fakeWithProductsError(errorFor) {
  const fake = createFakeSupabase();
  const realFrom = fake.service.from;
  const state = { attempts: 0 };
  fake.service.from = (table) => {
    if (table !== 'products') return realFrom(table);
    state.attempts += 1;
    const error = errorFor(state.attempts);
    if (!error) return realFrom(table);
    const q = {
      select() { return q; },
      eq() { return q; },
      in() { return q; },
      then(resolve) { resolve({ data: null, error }); },
    };
    return q;
  };
  return { fake, state };
}

// ── diagnosis ───────────────────────────────────────────────────────────────
test('describeUpstreamError surfaces the real OS cause, not just "fetch failed"', () => {
  const d = describeUpstreamError(transportError());
  assert.match(d, /ECONNRESET/, 'the OS code is the actionable detail and must appear');
  assert.notEqual(d, 'TypeError: fetch failed');
});

test('describeUpstreamError never lets a service-role key reach the log', () => {
  // Real Supabase service-role keys are JWTs (three base64url segments).
  const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.kZ7xQ0mB9vT4nL2pR8sW1yH3jK6dF0gA5';
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error(`connect ECONNRESET using ${key}`), { code: 'ECONNRESET' });
  const d = describeUpstreamError(err);
  assert.ok(!d.includes('kZ7xQ0mB9vT4nL2pR8sW1yH3jK6dF0gA5'), 'the signature must be gone');
  assert.ok(!d.includes('eyJ'), 'no part of the key may survive');
  assert.match(d, /\[redacted-token\]/);
  assert.match(d, /ECONNRESET/, 'redaction must not destroy the diagnosis');
});

test('describeUpstreamError is length-bounded', () => {
  assert.ok(describeUpstreamError(new Error('x'.repeat(5000))).length <= 700);
});

// ── classification ──────────────────────────────────────────────────────────
test('isTransientUpstreamError: transport failures are transient', () => {
  for (const code of ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_SOCKET']) {
    assert.equal(isTransientUpstreamError(transportError(code, `connect ${code}`)), true, code);
  }
  assert.equal(isTransientUpstreamError(new TypeError('fetch failed')), true, 'no cause chain');
  assert.equal(isTransientUpstreamError(new Error('socket hang up')), true);
});

test('isTransientUpstreamError: real failures are NOT transient', () => {
  // A retry cannot fix any of these, and retrying would only delay the
  // honest error or hide a genuine bug.
  assert.equal(isTransientUpstreamError({ message: 'relation "products" does not exist' }), false, 'SQL');
  assert.equal(isTransientUpstreamError({ message: 'new row violates row-level security policy' }), false, 'RLS');
  assert.equal(isTransientUpstreamError(httpError(502, 'upstream')), false, 'our own HttpError');
  assert.equal(isTransientUpstreamError(new HttpError(400, 'bad')), false);
  assert.equal(isTransientUpstreamError(transportError('CERT_HAS_EXPIRED', 'certificate has expired')), false, 'TLS trust');
  assert.equal(isTransientUpstreamError(null), false);
});

// ── the retry itself ────────────────────────────────────────────────────────
test('withReadRetry: absorbs one transport blip and returns the REAL result', async () => {
  let calls = 0;
  const out = await withReadRetry(async () => {
    calls += 1;
    if (calls === 1) throw transportError();
    return ['real-row'];
  }, { label: 'test', delayMs: 1 });
  assert.deepEqual(out, ['real-row'], 'real data, never invented data');
  assert.equal(calls, 2);
});

test('withReadRetry: a sustained outage still fails — no fake success', async () => {
  let calls = 0;
  await assert.rejects(
    withReadRetry(async () => { calls += 1; throw transportError(); }, { label: 'test', delayMs: 1 }),
    /fetch failed/,
  );
  assert.equal(calls, 2, 'bounded: exactly one retry, then stop');
});

test('withReadRetry: a non-transient error is attempted exactly once', async () => {
  let calls = 0;
  await assert.rejects(
    withReadRetry(async () => { calls += 1; throw httpError(502, 'nope'); }, { label: 'test', delayMs: 1 }),
    /nope/,
  );
  assert.equal(calls, 1, 'a real bug must never be masked by a retry');
});

test('withReadRetry: a healthy read is never retried', async () => {
  let calls = 0;
  await withReadRetry(async () => { calls += 1; return []; }, { label: 'test', delayMs: 1 });
  assert.equal(calls, 1);
});

// ── the real route, over HTTP ───────────────────────────────────────────────
test('GET /products: a single transport blip is absorbed (supabase resolves, never throws)', async (t) => {
  const { fake, state } = fakeWithProductsError((n) => (n === 1 ? transportError() : null));
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await fetch(`${base}/api/v1/products?limit=5`);
  assert.equal(res.status, 200, 'the shopper must not see an error for a blip');
  assert.equal(state.attempts, 2, 'the query is genuinely re-issued');
});

test('GET /products: a sustained outage is an honest 502, not an empty catalog', async (t) => {
  const { fake, state } = fakeWithProductsError(() => transportError());
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await get(base, '/api/v1/products?limit=5');
  assert.equal(res.status, 502);
  assert.equal(state.attempts, 2, 'bounded, and no endless retry storm');
  assert.equal(res.body.error.message, 'Unable to load the catalog. Please try again later.');
  // No mock/empty fallback masquerading as a working shop.
  assert.ok(!('products' in (res.body ?? {})), 'a failure must not look like an empty catalog');
  assert.ok(!/ECONNRESET|fetch failed|abc\.supabase\.co|at Object|node:internal/.test(res.text), 'no internals to the client');
});

test('GET /products: a PostgREST/RLS failure is never retried', async (t) => {
  const { fake, state } = fakeWithProductsError(() => ({ message: 'new row violates row-level security policy' }));
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await get(base, '/api/v1/products?limit=5');
  assert.equal(res.status, 502);
  assert.equal(state.attempts, 1, 'a real bug is surfaced immediately, not retried');
  assert.ok(!/row-level|relation/i.test(res.text), 'no SQL/RLS detail to the client');
});
