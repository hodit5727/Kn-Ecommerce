/**
 * LIVE SMOKE TEST — runs the REAL backend against the REAL Supabase project.
 *
 * Requires a populated `.env` (project root). Executes, for real:
 *   1. boot + fail-fast env validation
 *   2. ADMIN provisioning (creates the admin Auth user + ADMIN profile)
 *   3. POST /admin/auth/login  → real signInWithPassword against Supabase Auth
 *   4. GET  /auth/session      → cookie round-trip returns the ADMIN user
 *   5. POST /auth/otp/send     → real OTP email dispatched via the project SMTP
 *
 * The OTP EMAIL lands in the ADMIN_BOOTSTRAP_EMAIL inbox; its 6-digit code
 * cannot be read programmatically here — complete the verify leg manually
 * (or in the next phase's tests) once the code is known.
 *
 * Exit: 0 = every smoke assertion passed, 1 = assertion failed, 2 = setup error.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config/env.js';
import { createSupabaseClients } from '../src/lib/supabase.js';
import { ensureAdmin } from '../src/lib/admin.js';
import { createApp } from '../src/app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(HERE, '..', '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

let passed = 0;
let failed = 0;
const pass = (name) => { passed += 1; console.log(`  PASS  ${name}`); };
const fail = (name, detail) => { failed += 1; console.log(`  FAIL  ${name} :: ${detail}`); };
const check = (name, cond, detail = '') => (cond ? pass(name) : fail(name, detail));

let server;

async function request(base, p, { method = 'GET', body, cookie = '' } = {}) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: json, headers: res.headers };
}

function cookieJar(res) {
  const jar = {};
  for (const c of (res.headers.getSetCookie?.() ?? [])) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return jar;
}
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

try {
  const env = loadEnv(process.env);
  const supabase = createSupabaseClients(env);
  const app = createApp({ env, supabase });

  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log('LIVE SMOKE against', env.SUPABASE_URL, '\n');

  // 1–2) Admin provisioning (may CREATE the admin on first run).
  console.log('── admin provisioning ──');
  let admin;
  const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL;
  try {
    admin = await ensureAdmin(supabase.service, env);
    check('admin ensured (auth user + ADMIN profile)', Boolean(admin && admin.email === adminEmail), JSON.stringify(admin));
  } catch (e) {
    fail('admin ensured', e.message);
    if (/relation "[\w.]+" does not exist|type "user_role" does not exist/i.test(e.message)) {
      console.error('\n>>> SCHEMA NOT APPLIED: paste supabase/apply-production.sql into the');
      console.error('    Supabase SQL Editor, Run it, then re-run this smoke test.');
    }
    throw e;
  }

  // 3) Real admin login with the REAL password.
  console.log('\n── POST /admin/auth/login ──');
  const loginPw = admin.password ?? env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!loginPw) {
    console.error('\n>>> No admin password available: set ADMIN_BOOTSTRAP_PASSWORD in .env,');
    console.error('    then re-run (ensureAdmin will reset the admin password to it).');
    process.exit(2);
  }
  const login = await request(base, '/api/v1/admin/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: loginPw },
  });
  check('real password login returns 200', login.status === 200, `status ${login.status} body=${JSON.stringify(login.body)}`);
  check('user role is ADMIN (server-verified)', login.body?.user?.role === 'ADMIN', JSON.stringify(login.body?.user?.role));
  const loginJson = JSON.stringify(login.body);
  check('login response leaks neither the password nor tokens',
    !loginJson.includes(loginPw) && !loginJson.includes('access_token') && !loginJson.includes('refresh_token'),
    'response leaked sensitive fields');

  // 4) Session cookie round-trip.
  console.log('\n── GET /auth/session (cookie round-trip) ──');
  const jar = cookieJar(login);
  check('HttpOnly session cookie issued', cookieHeader(jar).includes('ks_access='), cookieHeader(jar));
  const session = await request(base, '/api/v1/auth/session', { cookie: cookieHeader(jar) });
  check('session resolves to the ADMIN user', session.status === 200 && session.body?.user?.role === 'ADMIN',
    `status ${session.status} role=${session.body?.user?.role}`);

  const signedOut = await request(base, '/api/v1/auth/session');
  check('no cookie → 200 { user: null } (contract)', signedOut.status === 200 && signedOut.body?.user === null,
    `status ${signedOut.status} body=${JSON.stringify(signedOut.body)}`);

  // 4b) Public catalog (Phase 8 read side): honest empty result — never mock.
  console.log('\n── GET /products (public catalog) ──');
  const catalog = await request(base, '/api/v1/products');
  check('GET /products → 200 with a products array', catalog.status === 200 && Array.isArray(catalog.body?.products),
    `status ${catalog.status}`);
  const categories = await request(base, '/api/v1/products/categories');
  check('GET /products/categories → 200 with a categories array', categories.status === 200 && Array.isArray(categories.body?.categories),
    `status ${categories.status}`);
  const missingProduct = await request(base, '/api/v1/products/00000000-0000-0000-0000-000000000000');
  check('GET /products/:id (unknown) → 404', missingProduct.status === 404, `status ${missingProduct.status}`);
  const badPrice = await request(base, '/api/v1/products?minPrice=-5');
  check('GET /products invalid minPrice → 400', badPrice.status === 400, `status ${badPrice.status}`);

  // 5) Real OTP dispatch to the admin inbox.
  console.log('\n── POST /auth/otp/send ──');
  const otp = await request(base, '/api/v1/auth/otp/send', {
    method: 'POST',
    body: { email: adminEmail },
  });
  check('OTP email dispatched via Supabase SMTP', otp.status === 200 && otp.body?.success === true,
    `status ${otp.status} body=${JSON.stringify(otp.body)}`);

  console.log(`\nRESULT (live): ${passed} passed, ${failed} failed`);
} catch (e) {
  console.error('\nSMOKE ERROR:', e && e.message ? e.message : e, '\n');
  process.exit(failed > 0 ? 1 : 2);
} finally {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
}
process.exit(failed === 0 ? 0 : 1);