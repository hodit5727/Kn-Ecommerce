/**
 * Server-side input validation (schema.js), file-upload validation
 * (uploads.js) and the raw-byte upload routes + seller-application document
 * attach. Fake Supabase + in-memory storage; no network.
 *
 * Proves: sanitized/whitelisted fields (mass-assignment guard), every scalar
 * type incl. phone/pincode/uuid/enum/nested arrays/objects, magic-byte MIME
 * sniffing (client-declared type is never trusted), per-kind size caps with a
 * clean 413, private-bucket signed URL for documents, seller-only image
 * uploads, and the idDocument verification on seller application.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { sign } from 'cookie-signature';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { validate } from '../src/lib/schema.js';
import {
  sniffMime,
  assertUploadAllowed,
  MAX_IMAGE_BYTES,
  MAX_ID_DOCUMENT_BYTES,
  ALLOWED_ID_DOCUMENT_MIMES,
} from '../src/lib/uploads.js';
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
  const bodyValue =
    body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: bodyValue,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: json };
};

/** Minimal valid magic bytes for each accepted type. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64, 7)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 7)]);
const JUNK = Buffer.from('this is definitely not an image or a document at all');

// ── schema.js — server-side body validation ────────────────────────────────
test('schema: required fields, trimming, length and value bounds', () => {
  const schema = {
    name: { type: 'string', required: true, min: 3, max: 10, label: 'Name' },
    price: { type: 'number', required: true, minValue: 1, maxValue: 1000, label: 'Price' },
    qty: { type: 'integer', minValue: 0, maxValue: 99, label: 'Quantity' },
  };
  assert.equal(validate({ name: '  Kurta  ' }, schema).ok, false); // missing price
  const ok = validate({ name: '  Kurta  ', price: 499, qty: 2 }, schema);
  assert.equal(ok.ok, true);
  assert.equal(ok.fields.name, 'Kurta'); // trimmed
  assert.equal(validate({ name: 'Ku', price: 499 }, schema).ok, false); // min length
  assert.equal(validate({ name: 'Way Too Long Name', price: 499 }, schema).ok, false); // max length
  assert.equal(validate({ name: 'Kurta', price: 0 }, schema).ok, false); // below minValue
  assert.equal(validate({ name: 'Kurta', price: 1001 }, schema).ok, false); // above maxValue
  assert.equal(validate({ name: 'Kurta', price: 499.5, qty: 2.5 }, schema).ok, false); // integer violated
});

test('schema: email, phone, pincode, uuid, enum and pattern types', () => {
  const schema = {
    email: { type: 'email', required: true, label: 'Email' },
    phone: { type: 'phone', required: true, label: 'Phone' },
    pin: { type: 'pincode', required: true, label: 'PIN code' },
    id: { type: 'uuid', required: true, label: 'ID' },
    status: { type: 'string', enum: ['DRAFT', 'PUBLISHED'], label: 'Status' },
    code: { type: 'string', pattern: /^[A-Z]{3}-[0-9]{4}$/, label: 'Code' },
  };
  const good = validate(
    {
      email: 'a@b.co', phone: '9876543210', pin: '600001',
      id: '00000000-0000-4000-8000-000000000001',
      status: 'PUBLISHED', code: 'ABC-1234',
    },
    schema,
  );
  assert.equal(good.ok, true);
  assert.equal(validate({ ...good.fields, email: 'not-an-email' }, schema).ok, false);
  assert.equal(validate({ ...good.fields, phone: '12345' }, schema).ok, false);
  assert.equal(validate({ ...good.fields, pin: '1234' }, schema).ok, false);
  assert.equal(validate({ ...good.fields, id: 'not-a-uuid' }, schema).ok, false);
  assert.equal(validate({ ...good.fields, status: 'APPROVED' }, schema).ok, false);
  assert.equal(validate({ ...good.fields, code: 'abc-123' }, schema).ok, false);
});

test('schema: arrays with scalar items, nested objects + maxItems cap', () => {
  const schema = {
    images: { type: 'array', maxItems: 2, arrayOf: { type: 'string', max: 20, label: 'Image' }, label: 'Images' },
    items: {
      type: 'array', maxItems: 2, label: 'Items',
      arrayOf: {
        productId: { type: 'uuid', required: true, label: 'Product' },
        quantity: { type: 'integer', required: true, minValue: 1, maxValue: 99, label: 'Quantity' },
      },
    },
    address: {
      type: 'object', label: 'Address',
      object: { city: { type: 'string', required: true, min: 2, label: 'City' } },
    },
  };
  const ok = validate(
    {
      images: ['  one.jpg  ', 'two.jpg'],
      items: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 2 }],
      address: { city: 'Chennai' },
    },
    schema,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.fields.images[0], 'one.jpg'); // trimmed inside array
  assert.equal(ok.fields.items[0].quantity, 2);
  assert.equal(ok.fields.address.city, 'Chennai');
  assert.equal(validate({ images: ['a', 'b', 'c'] }, schema).ok, false); // maxItems
  assert.equal(validate({ items: [{ productId: 'x', quantity: 1 }] }, schema).ok, false);
  assert.equal(validate({ address: { city: 'C' } }, schema).ok, false);
});

test('schema: unknown/extra keys are dropped — mass-assignment guard', () => {
  const schema = { price: { type: 'number', required: true, label: 'Price' } };
  const r = validate({ price: 499, is_admin: true, seller_id: 'attacker' }, schema);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.fields), ['price']);
  assert.equal('is_admin' in r.fields, false);
});

// ── uploads.js — magic-byte sniffing + caps ────────────────────────────────
test('sniffMime detects real types from bytes, never trusts declarations', () => {
  assert.equal(sniffMime(JPEG), 'image/jpeg');
  assert.equal(sniffMime(PNG), 'image/png');
  assert.equal(sniffMime(WEBP), 'image/webp');
  assert.equal(sniffMime(PDF), 'application/pdf');
  assert.equal(sniffMime(JUNK), null);
  assert.equal(sniffMime(Buffer.alloc(0)), null);
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8])), null); // too short
});

test('assertUploadAllowed enforces allowlist + per-kind size caps (413)', () => {
  assert.equal(assertUploadAllowed(JPEG, 'image').mime, 'image/jpeg');
  assert.equal(assertUploadAllowed(PNG, 'document').mime, 'image/png');
  assert.equal(assertUploadAllowed(PDF, 'document').mime, 'application/pdf');
  assert.throws(() => assertUploadAllowed(WEBP, 'document'), { status: 400 }); // webp not a doc
  assert.throws(() => assertUploadAllowed(JUNK, 'image'), { status: 400 });
  assert.throws(() => assertUploadAllowed(Buffer.alloc(0), 'image'), { status: 400 });
  const bigImage = Buffer.concat([JPEG, Buffer.alloc(MAX_IMAGE_BYTES + 1)]);
  assert.throws(() => assertUploadAllowed(bigImage, 'image'), { status: 413 });
  const bigDoc = Buffer.concat([PDF, Buffer.alloc(MAX_ID_DOCUMENT_BYTES + 1)]);
  assert.throws(() => assertUploadAllowed(bigDoc, 'document'), { status: 413 });
  assert.ok(ALLOWED_ID_DOCUMENT_MIMES.includes('application/pdf'));
});

// ── upload routes ──────────────────────────────────────────────────────────
test('POST /seller/documents stores bytes, sniffs MIME, returns signed URL', async () => {
  const fake = createFakeSupabase();
  fake.helpers.seedUser({ id: 'usr-1', email: 'a@b.co' });
  fake.helpers.seedProfile({ id: 'usr-1', email: 'a@b.co', role: 'CUSTOMER', status: 'ACTIVE', full_name: 'Aakash', phone: '9876543210' });

  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/seller/documents', {
      method: 'POST',
      headers: {
        cookie: `ks_access=${signedCookie('at-usr-1')}; ks_refresh=${signedCookie('rt-usr-1')}`,
        'Content-Type': 'application/octet-stream',
      },
      body: PDF,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.mimeType, 'application/pdf');
    assert.equal(res.body.byteSize, PDF.length);
    assert.match(res.body.storagePath, /^seller-docs\/\d+-[0-9a-f]{24}\.pdf$/);
    assert.match(res.body.signedUrl, /^https:\/\/storage\.test\/sign\/seller-documents\//);
    // The stored object carries the SNIFFED content type.
    const objs = fake.helpers.storageObjects();
    assert.equal(objs[0].contentType, 'application/pdf');
  } finally {
    server.close();
  }
});

test('POST /seller/documents rejects junk bytes and oversized documents', async () => {
  const fake = createFakeSupabase();
  fake.helpers.seedUser({ id: 'usr-1', email: 'a@b.co' });
  fake.helpers.seedProfile({ id: 'usr-1', email: 'a@b.co', role: 'CUSTOMER', status: 'ACTIVE', full_name: 'Aakash', phone: '9876543210' });
  const { server, base } = await makeServer(fake);
  try {
    const cookie = `ks_access=${signedCookie('at-usr-1')}; ks_refresh=${signedCookie('rt-usr-1')}`;
    const junk = await request(base, '/api/v1/seller/documents', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/octet-stream' }, body: JUNK,
    });
    assert.equal(junk.status, 400);
    assert.match(junk.body.error.message, /Unsupported identity document type/);

    // 2.2 MB PDF passes the 2.5 MB raw parser but violates the 2 MB document cap.
    const oversized = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024 + 100)]);
    const cap = await request(base, '/api/v1/seller/documents', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/octet-stream' }, body: oversized,
    });
    assert.equal(cap.status, 413);
    assert.match(cap.body.error.message, /2 MB or smaller/);
  } finally {
    server.close();
  }
});

test('POST /seller/product-images is seller-gated and stores to the public bucket', async () => {
  const fake = createFakeSupabase();
  const seller = { id: 'usr-2', email: 's@b.co' };
  fake.helpers.seedUser(seller);
  fake.helpers.seedProfile({ id: seller.id, email: seller.email, role: 'CUSTOMER', roles: ['CUSTOMER', 'SELLER'], status: 'ACTIVE', full_name: 'Sanya', phone: '9876543222' });
  fake.helpers.seedSeller({ profile_id: seller.id, verification_status: 'APPROVED' });

  const { server, base } = await makeServer(fake);
  try {
    const sellerCookie = `ks_access=${signedCookie(`at-${seller.id}`)}; ks_refresh=${signedCookie(`rt-${seller.id}`)}`;
    const res = await request(base, '/api/v1/seller/product-images', {
      method: 'POST', headers: { cookie: sellerCookie, 'Content-Type': 'image/jpeg' }, body: JPEG,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.mimeType, 'image/jpeg');
    assert.equal(res.body.byteSize, JPEG.length);
    assert.match(res.body.storagePath, /^product-images\/\d+-[0-9a-f]{24}\.jpg$/);

    // Declared type is a lie: PNG bytes with a JPEG header claim → sniffed PNG.
    const lying = await request(base, '/api/v1/seller/product-images', {
      method: 'POST', headers: { cookie: sellerCookie, 'Content-Type': 'image/jpeg' }, body: PNG,
    });
    assert.equal(lying.status, 200);
    assert.equal(lying.body.mimeType, 'image/png');

    // A plain customer is forbidden.
    fake.helpers.seedUser({ id: 'usr-3', email: 'c@b.co' });
    fake.helpers.seedProfile({ id: 'usr-3', email: 'c@b.co', role: 'CUSTOMER', status: 'ACTIVE', full_name: 'Chetan', phone: '9876543223' });
    const customerRes = await request(base, '/api/v1/seller/product-images', {
      method: 'POST',
      headers: { cookie: `ks_access=${signedCookie('at-usr-3')}; ks_refresh=${signedCookie('rt-usr-3')}`, 'Content-Type': 'application/octet-stream' },
      body: JPEG,
    });
    assert.equal(customerRes.status, 403);
  } finally {
    server.close();
  }
});

test('anonymous uploads are rejected (401)', async () => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/seller/documents', {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: PDF,
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

// ── POST /seller/applications — verified idDocument attach ─────────────────
test('seller application accepts a verified idDocument (storage cross-check)', async () => {
  const fake = createFakeSupabase();
  fake.helpers.seedUser({ id: 'usr-1', email: 'a@b.co' });
  fake.helpers.seedProfile({ id: 'usr-1', email: 'a@b.co', role: 'CUSTOMER', status: 'ACTIVE', full_name: 'Aakash', phone: '9876543210', pin_hash: 'x', gender: 'male', category: 'student', user_type: 'student' });

  // Pre-upload the identity document through the storage flow.
  await fake.service.storage.from('seller-documents').upload('seller-docs/1-aaa.jpg', JPEG, { contentType: 'image/jpeg' });

  const { server, base } = await makeServer(fake);
  try {
    const res = await request(base, '/api/v1/seller/applications', {
      method: 'POST',
      headers: { cookie: `ks_access=${signedCookie('at-usr-1')}; ks_refresh=${signedCookie('rt-usr-1')}` },
      body: {
        storeName: 'Aakash Traders',
        businessType: 'INDIVIDUAL',
        businessAddress: '12 MG Road, Chennai 600001',
        storeCategory: 'Apparel',
        agreeToTerms: true,
        idDocument: { storagePath: 'seller-docs/1-aaa.jpg', mimeType: 'image/jpeg', byteSize: JPEG.length },
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const seller = fake.helpers.getSellerProfile('usr-1');
    assert.equal(seller.id_document_path, 'seller-docs/1-aaa.jpg');
    assert.equal(seller.id_document_mime, 'image/jpeg');
    assert.equal(seller.id_ocr_status, 'PENDING');
  } finally {
    server.close();
  }
});

test('seller application rejects an idDocument that does not match storage', async () => {
  const fake = createFakeSupabase();
  fake.helpers.seedUser({ id: 'usr-1', email: 'a@b.co' });
  fake.helpers.seedProfile({ id: 'usr-1', email: 'a@b.co', role: 'CUSTOMER', status: 'ACTIVE', full_name: 'Aakash', phone: '9876543210', pin_hash: 'x', gender: 'male', category: 'student', user_type: 'student' });
  const { server, base } = await makeServer(fake);
  try {
    const cookie = `ks_access=${signedCookie('at-usr-1')}; ks_refresh=${signedCookie('rt-usr-1')}`;
    // MIME claim contradicts the (absent) stored object.
    const noObject = await request(base, '/api/v1/seller/applications', {
      method: 'POST', headers: { cookie },
      body: {
        storeName: 'Aakash Traders', businessType: 'INDIVIDUAL',
        businessAddress: '12 MG Road, Chennai 600001', storeCategory: 'Apparel',
        agreeToTerms: true,
        idDocument: { storagePath: 'seller-docs/nope.jpg', mimeType: 'image/jpeg', byteSize: 100 },
      },
    });
    assert.equal(noObject.status, 400);

    // Traversal attempt in the storage path.
    const traversal = await request(base, '/api/v1/seller/applications', {
      method: 'POST', headers: { cookie },
      body: {
        storeName: 'Aakash Traders', businessType: 'INDIVIDUAL',
        businessAddress: '12 MG Road, Chennai 600001', storeCategory: 'Apparel',
        agreeToTerms: true,
        idDocument: { storagePath: '../../etc/passwd', mimeType: 'image/jpeg', byteSize: 100 },
      },
    });
    assert.equal(traversal.status, 400);
  } finally {
    server.close();
  }
});