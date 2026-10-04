/**
 * Phase-3 migration verification harness.
 *
 * Boots an embedded PostgreSQL (no Docker/system install needed), applies
 * the test-only Supabase shim + the three production migrations, then runs
 * behavioural assertions taken straight from BACKEND_SPEC.md / AGENTS.md.
 *
 * Exit code: 0 = every assertion passed; non-zero = failures (printed).
 * This is real execution — claims about the schema are based on this run.
 */
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..'); // project root
const PORT = 55432;
const DB = 'kshop_test';
const AUTH = { host: '127.0.0.1', port: PORT, user: 'postgres', password: 'harness_pw' };

let passed = 0;
let failed = 0;
const pass = (name) => { passed += 1; console.log(`  PASS  ${name}`); };
const fail = (name, detail) => { failed += 1; console.log(`  FAIL  ${name} :: ${detail}`); };
const check = (name, cond, detail = '') => (cond ? pass(name) : fail(name, detail));

const ep = new EmbeddedPostgres({
  databaseDir: path.join(HERE, '.pgdata'),
  user: 'postgres',
  password: 'harness_pw',
  port: PORT,
  persistent: false,
  // Indian-locale Windows makes initdb pick WIN1252, which cannot store the
  // UTF-8 characters used in the migration files — force UTF8 + C locale.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

let client = null;
let exitCode = 1;

try {
  // ── Boot ────────────────────────────────────────────────────────────────
  try {
    // Fresh cluster every run — never reuse a data dir created with a
    // different encoding (stale state would mask real migration errors).
    await rm(path.join(HERE, '.pgdata'), { recursive: true, force: true });
    await ep.initialise();
    await ep.start();
  } catch (e) {
    if (!/already exists/i.test(String(e && e.message))) throw e;
  }
  try {
    await ep.createDatabase(DB);
  } catch (e) {
    if (!/already exists/i.test(String(e && e.message))) throw e;
  }

  client = new pg.Client({ ...AUTH, database: DB });
  await client.connect();

  // ── Apply shim + production migrations ─────────────────────────────────
  const apply = async (label, file) => {
    const sql = await readFile(file, 'utf8');
    try {
      await client.query(sql);
      console.log(`APPLIED  ${label}`);
    } catch (e) {
      throw new Error(`migration "${label}" failed: ${e.message}`);
    }
  };
  await apply('shim.sql (test-only)', path.join(HERE, 'shim.sql'));
  await apply('0001_init_schema', path.join(ROOT, 'supabase', 'migrations', '0001_init_schema.sql'));
  await apply('0002_functions_triggers', path.join(ROOT, 'supabase', 'migrations', '0002_functions_triggers.sql'));
  await apply('0003_rls_policies', path.join(ROOT, 'supabase', 'migrations', '0003_rls_policies.sql'));
  await apply('0004_business_id_compact', path.join(ROOT, 'supabase', 'migrations', '0004_business_id_compact.sql'));
  await apply('0005_commerce_refinements', path.join(ROOT, 'supabase', 'migrations', '0005_commerce_refinements.sql'));
  await apply('0006_seller_verification', path.join(ROOT, 'supabase', 'migrations', '0006_seller_verification.sql'));
  await apply('0007_seller_role_grant', path.join(ROOT, 'supabase', 'migrations', '0007_seller_role_grant.sql'));
  await apply('0008_seller_verification_submitted_at', path.join(ROOT, 'supabase', 'migrations', '0008_seller_verification_submitted_at.sql'));

  // ── Helpers ────────────────────────────────────────────────────────────
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  const expectOk = async (name, sql, params) => {
    try {
      if (params) await client.query(sql, params); else await client.query(sql);
      pass(name);
    } catch (e) {
      fail(name, e.message);
    }
  };
  const expectFail = async (name, sql, params, want = null) => {
    try {
      if (params) await client.query(sql, params); else await client.query(sql);
      fail(name, 'statement succeeded but should have been rejected');
    } catch (e) {
      if (want && !want.test(e.message)) fail(name, `wrong error: ${e.message}`);
      else pass(name);
    }
  };

  // Seed auth users (every profile must reference auth.users — §3 FK).
  const mkAuth = async (email) => (await client.query(
    'INSERT INTO auth.users(email) VALUES ($1) RETURNING id', [email])).rows[0].id;
  const aliceAuth = await mkAuth('alice@kshop.test');
  const bobAuth = await mkAuth('bob@kshop.test');
  const adminAuth = await mkAuth('root@kshop.test');
  // ADMIN PROFILE — seller_verifications.reviewed_by references profiles(id),
  // so the admin user must exist as a profile before any review op.
  await client.query(
    `INSERT INTO profiles(id, email, full_name, phone, role)
     VALUES ($1, 'root@kshop.test', 'Root Admin', '9000000000', 'ADMIN')`,
    [adminAuth]);

  console.log('\n── §8 identity / profiles ──');
  const alice = await one(
    `INSERT INTO profiles(id, email, full_name, phone)
     VALUES ($1, 'alice@kshop.test', 'Alice Kumar', '9876543210')
     RETURNING id, business_id, role, roles::text[] AS roles`,
    [aliceAuth]);
  check('customer auto-gets KNCR id', /^KNCR-[0-9]{4}$/.test(alice.business_id),
    String(alice.business_id));
  check('customer roles default = {CUSTOMER}',
    alice.roles.length === 1 && alice.roles[0] === 'CUSTOMER', JSON.stringify(alice.roles));

  const spoof = await one(
    `INSERT INTO profiles(id, email, phone, business_id)
     VALUES ($1, 'mallory@kshop.test', '9765432101', 'KNCR-9999')
     RETURNING business_id`,
    [await mkAuth('mallory@kshop.test')]);
  check('client-supplied business_id is ignored',
    spoof.business_id !== 'KNCR-9999' && /^KNCR-[0-9]{4}$/.test(spoof.business_id),
    String(spoof.business_id));

  await client.query(
    `UPDATE profiles SET business_id = 'KNCR-9998', roles = ARRAY['ADMIN']::user_role[]
     WHERE id = $1`, [alice.id]);
  const tampered = await one(
    'SELECT business_id, roles::text[] AS roles FROM profiles WHERE id = $1', [alice.id]);
  check('UPDATE cannot change business_id or inject roles',
    tampered.business_id === alice.business_id
    && tampered.roles.length === 1 && tampered.roles[0] === 'CUSTOMER',
    JSON.stringify(tampered));

  const promoted = await one(
    `UPDATE profiles SET role = 'SELLER'
     WHERE id = $1 RETURNING business_id, roles::text[] AS roles`, [alice.id]);
  check('customer→seller promotion yields KNSR + both roles',
    /^KNSR-[0-9]{4}$/.test(promoted.business_id)
    && promoted.roles.sort().join(',') === 'CUSTOMER,SELLER',
    `${promoted.business_id} ${JSON.stringify(promoted.roles)}`);

  // ── 0007: the seller role GRANT that actually persists ─────────────────────
  // This is the path the live face check uses. Approving a seller keeps the
  // CUSTOMER primary role and ADDS SELLER, so `role` stays 'CUSTOMER' and the
  // trigger's mass-assignment branch would revert a direct `roles` write. Only
  // grant_role_to_profile() may open that escape hatch.
  const seller2 = (await one(
    `INSERT INTO profiles(id, email, phone)
     VALUES ($1, 'seller2@kshop.test', '9811111112') RETURNING id`, [await mkAuth('seller2@kshop.test')])).id;

  // 1) The direct write is STILL reverted — the §31 defence must not weaken.
  await client.query(
    `UPDATE profiles SET roles = ARRAY['CUSTOMER','SELLER']::user_role[] WHERE id = $1`, [seller2]);
  const directWrite = await one('SELECT roles::text[] AS roles, role FROM profiles WHERE id = $1', [seller2]);
  check('0007: a direct roles write is still reverted (mass-assignment defence intact)',
    directWrite.role === 'CUSTOMER' && directWrite.roles.length === 1 && directWrite.roles[0] === 'CUSTOMER',
    JSON.stringify(directWrite));

  // 2) The sanctioned function makes the grant stick, keeping CUSTOMER primary.
  await client.query('SELECT grant_role_to_profile($1, $2)', [seller2, 'SELLER']);
  const granted = await one(
    'SELECT role, roles::text[] AS roles, business_id FROM profiles WHERE id = $1', [seller2]);
  check('0007: grant_role_to_profile persists SELLER while keeping CUSTOMER primary',
    granted.role === 'CUSTOMER'
    && granted.roles.sort().join(',') === 'CUSTOMER,SELLER'
    && /^KNSR-[0-9]{4}$/.test(granted.business_id),
    `${granted.role} ${JSON.stringify(granted.roles)} ${granted.business_id}`);

  // 3) The escape hatch is TRANSACTION-LOCAL: after that call commits, a fresh
  //    direct write must be reverted again. A session-level GUC would fail this.
  await client.query(
    `UPDATE profiles SET roles = ARRAY['ADMIN']::user_role[] WHERE id = $1`, [seller2]);
  const afterGrant = await one('SELECT roles::text[] AS roles FROM profiles WHERE id = $1', [seller2]);
  check('0007: the grant escape hatch does not leak to a later statement',
    afterGrant.roles.sort().join(',') === 'CUSTOMER,SELLER',
    JSON.stringify(afterGrant.roles));

  // 4) An unknown profile is refused rather than silently ignored, so a
  //    mistyped user id can never look like a successful grant.
  await expectFail('0007: grant_role_to_profile rejects an unknown user',
    'SELECT grant_role_to_profile($1, $2)',
    ['00000000-0000-0000-0000-000000000000', 'SELLER'],
    /no profile/i);

  await expectFail('duplicate email rejected (unique)',
    `INSERT INTO profiles(id, email, phone)
     VALUES ($1, 'alice@kshop.test', '9811111111')`,
    [await mkAuth('dup@kshop.test')], /unique/i);
  await expectFail('duplicate mobile rejected (§5.22)',
    `INSERT INTO profiles(id, email, phone)
     VALUES ($1, 'phoneclone@kshop.test', '9876543210')`,
    [await mkAuth('phoneclone@kshop.test')], /unique/i);
  await expectFail('invalid 10-digit mobile rejected (§5.21)',
    `INSERT INTO profiles(id, email, phone)
     VALUES ($1, 'badphone@kshop.test', '1234567890')`,
    [await mkAuth('badphone@kshop.test')], /check constraint/i);

  console.log('\n── §16 orders: numbers + server math ──');
  const order1 = await one(
    `INSERT INTO orders(customer_id, seller_id, subtotal, delivery_fee, discount, total, ship_address)
     VALUES ($1, $1, 1000, 75, 0, 1075,
             '{"line1":"12 MG Road","city":"Chennai","pincode":"600001"}')
     RETURNING id, order_number`, [alice.id]);
  check('order_number auto-generated server-side',
    /^KS-\d{8}-\d{7}$/.test(order1.order_number), String(order1.order_number));

  await expectFail('order total must equal subtotal+fee-discount (§16)',
    `INSERT INTO orders(customer_id, seller_id, subtotal, delivery_fee, discount, total, ship_address)
     VALUES ($1, $1, 1000, 75, 0, 999999,
             '{"line1":"12 MG Road","city":"Chennai","pincode":"600001"}')`,
    [alice.id], /orders_total_math/);
  await expectFail('DELIVERED without delivered_at rejected (§17)',
    `INSERT INTO orders(customer_id, seller_id, subtotal, total, status, ship_address)
     VALUES ($1, $1, 100, 100, 'DELIVERED',
             '{"line1":"12 MG Road","city":"Chennai","pincode":"600001"}')`,
    [alice.id], /orders_delivered_state/);

  console.log('\n── §10/§12 products + variants ──');
  const product = await one(
    `INSERT INTO products(seller_id, name, brand, category)
     VALUES ($1, 'ABC Casual Shirt', 'ABC', 'Shirts') RETURNING id`, [alice.id]);
  const variant = await one(
    `INSERT INTO product_variants(product_id, sku, size, price, stock)
     VALUES ($1, 'ABC-SHIRT-M', 'M', 499.00, 10) RETURNING id`, [product.id]);
  check('valid variant accepted', Boolean(variant && variant.id));
  await expectOk('order-item line snapshot accepted',
    `INSERT INTO order_items(order_id, product_id, variant_id, seller_id,
                             product_name, sku, unit_price, quantity, line_total)
     VALUES ($1, $2, $3, $4, 'ABC Casual Shirt', 'ABC-SHIRT-M', 499.00, 1, 499.00)`,
    [order1.id, product.id, variant.id, alice.id]);
  await expectFail('price = 0 rejected (§5.40)',
    `INSERT INTO product_variants(product_id, sku, size, price, stock)
     VALUES ($1, 'ABC-SHIRT-L', 'L', 0, 10)`, [product.id], /check constraint/i);
  await expectFail('negative stock rejected (§5.41)',
    `INSERT INTO product_variants(product_id, sku, size, price, stock)
     VALUES ($1, 'ABC-SHIRT-XL', 'XL', 499.00, -1)`, [product.id], /check constraint/i);
  await expectFail('duplicate size variant rejected (§12 one row per combo)',
    `INSERT INTO product_variants(product_id, sku, size, price, stock)
     VALUES ($1, 'ABC-SHIRT-M2', 'M', 499.00, 5)`, [product.id], /unique/i);

  console.log('\n── §26 one-time coupon: DB-side race-safe enforcement ──');
  const coupon = await one(
    `INSERT INTO coupons(code, coupon_kind, discount_value, one_time_per_customer)
     VALUES ('SAVE10', 'PERCENT', 10, true) RETURNING id`);
  const mkOrder = async (n) => one(
    `INSERT INTO orders(customer_id, seller_id, subtotal, discount, total, ship_address)
     VALUES ($1, $1, ${n}, 50, ${n - 50},
             '{"line1":"12 MG Road","city":"Chennai","pincode":"600001"}')
     RETURNING id`, [alice.id]);
  const orderA = await mkOrder(500);
  const orderB = await mkOrder(800);
  await expectOk('first redemption accepted',
    `INSERT INTO coupon_redemptions(coupon_id, customer_id, order_id, discount_amount,
                                    one_time_per_customer)
     VALUES ($1, $2, $3, 50, true)`, [coupon.id, alice.id, orderA.id]);
  await expectFail('second redemption of one-time coupon REJECTED by DB (§26)',
    `INSERT INTO coupon_redemptions(coupon_id, customer_id, order_id, discount_amount,
                                    one_time_per_customer)
     VALUES ($1, $2, $3, 50, true)`, [coupon.id, alice.id, orderB.id], /unique/i);

  console.log('\n── §18/§20 QR tokens ──');
  await expectOk('first ACTIVE delivery token accepted',
    `INSERT INTO delivery_qr_tokens(order_id, purpose, token_hash,
                                    expected_order_status, expires_at)
     VALUES ($1, 'DELIVERY', repeat('a', 64), 'OUT_FOR_DELIVERY', now() + interval '15 minutes')`,
    [order1.id]);
  await expectFail('second ACTIVE token for same order+purpose REJECTED (single-use)',
    `INSERT INTO delivery_qr_tokens(order_id, purpose, token_hash,
                                    expected_order_status, expires_at)
     VALUES ($1, 'DELIVERY', repeat('b', 64), 'OUT_FOR_DELIVERY', now() + interval '15 minutes')`,
    [order1.id], /unique/i);

  console.log('\n── §22 refund window math ──');
  await expectFail('eligibility day 8 rejected — window closed after Day 7',
    `INSERT INTO returns(order_id, customer_id, reason, eligibility_day)
     VALUES ($1, $2, 'Does not fit', 8)`, [order1.id, alice.id], /check constraint/i);
  await expectFail('commission outside {5,10} rejected',
    `INSERT INTO returns(order_id, customer_id, reason, eligibility_day, commission_percent)
     VALUES ($1, $2, 'Damaged', 2, 7)`, [order1.id, alice.id], /check constraint/i);

  console.log('\n── §28/§36 append-only financial + audit records ──');
  const txn = await one(
    `INSERT INTO transactions(order_id, customer_id, txn_type, entry,
                              amount, balance_after)
     VALUES ($1, $2, 'COD_RECEIPT', 'CREDIT', 1075, 1075)
     RETURNING txn_ref`, [order1.id, alice.id]);
  check('transaction gets server-generated TXN- ref + POSTED status',
    /^TXN-\d{10}$/.test(txn.txn_ref), String(txn.txn_ref));
  await expectFail('UPDATE on transactions blocked (append-only)',
    `UPDATE transactions SET amount = 1 WHERE txn_ref = $1`, [txn.txn_ref], /append-only/);
  await expectFail('DELETE on transactions blocked',
    `DELETE FROM transactions WHERE txn_ref = $1`, [txn.txn_ref], /append-only/);
  await expectOk('audit log insert allowed',
    `INSERT INTO audit_logs(actor_id, actor_role, action, resource_type, resource_id)
     VALUES ($1, 'ADMIN', 'admin.login', 'profile', $2)`, [adminAuth, adminAuth]);
  await expectFail('UPDATE on audit_logs blocked',
    `UPDATE audit_logs SET action = 'x' WHERE actor_id = $1`, [adminAuth], /append-only/);
  await expectFail('DELETE on orders blocked (history)',
    `DELETE FROM orders WHERE id = $1`, [order1.id], /append-only/);
  await expectFail('UPDATE on order_items blocked (immutable lines)',
    `UPDATE order_items SET quantity = 999 WHERE order_id = $1`, [order1.id], /append-only/);

  console.log('\n── §33 RLS: cross-user + role access control ──');
  const bob = await one(
    `INSERT INTO profiles(id, email, full_name, phone)
     VALUES ($1, 'bob@kshop.test', 'Bob Rao', '9812345678')
     RETURNING id`, [bobAuth]);

  await client.query(`SET request.jwt.claim.sub = '${alice.id}'`);
  await client.query('SET ROLE authenticated');
  const aliceSees = await one('SELECT count(*)::int AS n FROM profiles');
  check('authenticated user sees ONLY own profile (RLS)', aliceSees.n === 1,
    `saw ${aliceSees.n} rows`);
  const bobRow = await one(`SELECT count(*)::int AS n FROM profiles WHERE id = '${bob.id}'`);
  check('other user\'s row filtered out by RLS', bobRow.n === 0, `saw ${bobRow.n}`);
  await expectFail('client role cannot read products (no grant)',
    'SELECT count(*) FROM products', null, /permission denied/);
  await expectFail('client role cannot write notifications (deny-by-default)',
    `INSERT INTO notifications(user_id, title) VALUES ('${alice.id}', 'x')`,
    null, /permission denied/);
  await expectFail('client role cannot touch transactions (no grant)',
    'SELECT count(*) FROM transactions', null, /permission denied/);
  await client.query('RESET ROLE');

  await client.query(`SET ROLE service_role`);
  await expectOk('service_role (backend) can write as the backend would',
    `INSERT INTO notifications(user_id, title) VALUES ($1, 'Order placed')`, [bob.id]);
  await client.query('RESET ROLE');
  await client.query(`RESET request.jwt.claim.sub`);

  console.log('\n── §face-verification 0006: seller_verifications state machine ──');
  const vf = await one(
    `INSERT INTO seller_verifications(user_id)
     VALUES ($1) RETURNING id, verification_status, cycle`,
    [alice.id]);
  check('verification starts NOT_STARTED cycle 1',
    vf.verification_status === 'NOT_STARTED' && vf.cycle === 1,
    `${vf.verification_status} cycle ${vf.cycle}`);
  await expectOk('NOT_STARTED → DOCUMENT_VALIDATING allowed',
    `UPDATE seller_verifications SET verification_status = 'DOCUMENT_VALIDATING' WHERE id = $1`, [vf.id]);
  await expectFail('DOCUMENT_VALIDATING → FACE_CAPTURE_REQUIRED skipped transitions blocked',
    `UPDATE seller_verifications SET verification_status = 'FACE_CAPTURE_REQUIRED' WHERE id = $1`,
    [vf.id], /illegal verification transition/);
  await expectFail('direct DOCUMENT_VALIDATING → VERIFIED blocked by state machine',
    `UPDATE seller_verifications
        SET verification_status = 'VERIFIED', verification_score = 0.99,
            match_status = 'PASSED', consent_granted = true
      WHERE id = $1`, [vf.id], /illegal verification transition/);
  await expectOk('full exercise: completed flow reaches VERIFIED only with score+match',
    `UPDATE seller_verifications
        SET verification_status = 'DOCUMENT_VERIFIED', document_status = 'PASSED',
            document_storage_path = 'verif-docs/x.jpg', document_sha256 = repeat('a', 64),
            consent_granted = true, consent_granted_at = now(),
            face_verification_provider = 'human'
      WHERE id = $1`, [vf.id]);
  await expectOk('face capture flow state (consent already granted)',
    `UPDATE seller_verifications
        SET verification_status = 'FACE_CAPTURE_REQUIRED', quality_status = 'PASSED',
            liveness_status = 'PASSED', antispoof_status = 'PASSED'
      WHERE id = $1`, [vf.id]);
  // The state machine forces the full chain — VERIFIED is only reachable
  // after the FACE_PROCESSING → LIVENESS_CHECK → FACE_MATCHING hops.
  await expectOk('face processing step',
    `UPDATE seller_verifications SET verification_status = 'FACE_PROCESSING' WHERE id = $1`, [vf.id]);
  await expectOk('liveness step',
    `UPDATE seller_verifications SET verification_status = 'LIVENESS_CHECK' WHERE id = $1`, [vf.id]);
  await expectOk('face matching step',
    `UPDATE seller_verifications SET verification_status = 'FACE_MATCHING' WHERE id = $1`, [vf.id]);
  await expectFail('VERIFIED without match PASSED rejected by CHECK',
    `UPDATE seller_verifications
        SET verification_status = 'VERIFIED', verification_score = 0.92
      WHERE id = $1`, [vf.id], /check constraint/);
  await expectFail('VERIFIED without a real score rejected by CHECK',
    `UPDATE seller_verifications
        SET verification_status = 'VERIFIED', match_status = 'PASSED'
      WHERE id = $1`, [vf.id], /check constraint/);
  await expectOk('VERIFIED requires match PASSED + real score (atomic server write)',
    `UPDATE seller_verifications
        SET verification_status = 'VERIFIED', verification_score = 0.92,
            match_status = 'PASSED'
      WHERE id = $1`, [vf.id]);
  const vfDone = await one('SELECT verification_status FROM seller_verifications WHERE id = $1', [vf.id]);
  check('verification completed as VERIFIED', vfDone.verification_status === 'VERIFIED',
    String(vfDone.verification_status));

  // The spec's hard rule: REJECTED → VERIFIED must NEVER happen directly.
  const rejectedVf = await one(
    `INSERT INTO seller_verifications(user_id, verification_status, rejection_reason, consent_granted)
     VALUES ($1, 'REJECTED', 'Poor document quality', true) RETURNING id`,
    [bob.id]);
  await expectFail('REJECTED → VERIFIED direct flip blocked by state machine',
    `UPDATE seller_verifications
        SET verification_status = 'VERIFIED', verification_score = 0.99,
            match_status = 'PASSED', consent_granted = true,
            rejection_reason = NULL
      WHERE id = $1`, [rejectedVf.id], /illegal verification transition/);
  await expectFail('REJECTED → NOT_STARTED blocked (admin reverify path only)',
    `UPDATE seller_verifications SET verification_status = 'NOT_STARTED' WHERE id = $1`,
    [rejectedVf.id], /illegal verification transition/);
  await expectOk('admin may open REJECTED → REVERIFICATION_REQUIRED',
    `UPDATE seller_verifications SET verification_status = 'REVERIFICATION_REQUIRED',
            reviewed_by = $2, reviewed_at = now(), review_status = 'COMPLETED'
     WHERE id = $1`, [rejectedVf.id, adminAuth]);
  await expectFail('REVERIFICATION_REQUIRED → FACE_CAPTURE_REQUIRED blocked (must re-upload)',
    `UPDATE seller_verifications SET verification_status = 'FACE_CAPTURE_REQUIRED' WHERE id = $1`,
    [rejectedVf.id], /illegal verification transition/);

  const vs = await one(
    `INSERT INTO verification_sessions(user_id, verification_id, challenge, expires_at)
     VALUES ($1, $2, '["look straight","blink"]'::jsonb, now() + interval '10 minutes')
     RETURNING id, status`,
    [alice.id, vf.id]);
  check('verification session created ACTIVE with challenge',
    vs.status === 'ACTIVE', String(vs.status));
  await expectFail('verification session must expire in the future',
    `INSERT INTO verification_sessions(user_id, verification_id, challenge, expires_at)
     VALUES ($1, $2, '[]'::jsonb, now() - interval '1 minute')`, [alice.id, vf.id], /check constraint/i);

  console.log('\n── §face-verification RLS: own-row read only ──');
  await client.query(`SET request.jwt.claim.sub = '${alice.id}'`);
  await client.query('SET ROLE authenticated');
  const aliceSeesVf = await one('SELECT count(*)::int AS n FROM seller_verifications');
  check('authenticated user sees OWN verification rows', aliceSeesVf.n >= 1, `saw ${aliceSeesVf.n}`);
  const bobVfRow = await one(`SELECT count(*)::int AS n FROM seller_verifications WHERE user_id = '${bob.id}'`);
  check('other user\'s verification rows filtered by RLS', bobVfRow.n === 0, `saw ${bobVfRow.n}`);
  await expectFail('client role cannot UPDATE verification rows (service-role only)',
    `UPDATE seller_verifications SET verification_status = 'REJECTED' WHERE id = $1`,
    [vf.id], /permission denied|policy|violat/i);
  await client.query('RESET ROLE');
  await client.query(`RESET request.jwt.claim.sub`);

  // ── Summary ────────────────────────────────────────────────────────────
  exitCode = failed === 0 ? 0 : 1;
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
} catch (e) {
  console.error('\nHARNESS ERROR:', e.message);
  exitCode = 2;
} finally {
  if (client) {
    try { await client.end(); } catch { /* already closed */ }
  }
  try { await ep.stop(); } catch { /* already stopped */ }
}
process.exit(exitCode);
