/**
 * Phase 8 (read side) — public product catalog unit tests.
 *
 * These prove the backend's OWN behaviour with the fake Supabase client (no
 * network): the public gate (APPROVED product + APPROVED seller + ACTIVE
 * profile), parameter validation, shaping, categories and filters. The live
 * empty-catalog behaviour is verified separately by tests/live-smoke.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';
import { productToPublic, minVariantPrice } from '../src/lib/productShape.js';

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
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

const request = async (base, path) => {
  const res = await fetch(`${base}${path}`, { method: 'GET' });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
};

const SELLER = 'seller-1';

const approvedProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  seller_id: SELLER,
  name: 'Blue Cotton Kurta',
  brand: 'VibeCraft',
  category: 'Indian Wear',
  description: 'Handloom cotton kurta. True to size.',
  status: 'APPROVED',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-02T10:00:00Z',
  seller: { status: 'ACTIVE', full_name: 'Arun Selvaraj' },
  variants: [
    { id: 'v1', sku: 'KUR-01-S', price: 499, stock: 10, is_active: true },
    { id: 'v2', sku: 'KUR-01-M', price: 549, stock: 5, is_active: false },
    { id: 'v3', sku: 'KUR-01-L', price: 599, stock: 3, is_active: true },
  ],
  images: [
    { storage_bucket: 'product-images', storage_path: 'kurta/large.jpg', position: 1, is_primary: false },
    { storage_bucket: 'product-images', storage_path: 'kurta/primary.jpg', position: 0, is_primary: true },
  ],
};

function seedCatalog(fake) {
  fake.helpers.seedSeller({ profile_id: SELLER, verification_status: 'APPROVED' });
  fake.helpers.seedProduct({ ...approvedProduct });
}

// ── pure shaping ────────────────────────────────────────────────────────────
test('productToPublic shapes an APPROVED row into the frontend Product contract', () => {
  const p = productToPublic(approvedProduct, 'https://abc.supabase.co');
  assert.equal(p.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(p.name, 'Blue Cotton Kurta');
  assert.equal(p.slug, 'blue-cotton-kurta');
  assert.equal(p.status, 'PUBLISHED'); // DB APPROVED → frontend PUBLISHED
  assert.equal(p.price, 499); // min of ACTIVE variants only (549 inactive excluded)
  assert.equal(p.stock, 13); // 10 + 3 active
  assert.equal(p.sku, 'KUR-01-S');
  assert.equal(p.sellerId, SELLER);
  assert.equal(p.sellerName, 'Arun Selvaraj');
  assert.equal(p.rating, 0); // honest — no review system in the schema yet
  assert.equal(p.reviewCount, 0);
  assert.equal(p.images[0], 'https://abc.supabase.co/storage/v1/object/public/product-images/kurta/primary.jpg');
  assert.equal(p.images[1], 'https://abc.supabase.co/storage/v1/object/public/product-images/kurta/large.jpg');
  assert.equal(p.createdAt, '2026-09-01T10:00:00Z');
});

test('minVariantPrice ignores inactive variants and empty variant lists', () => {
  assert.equal(minVariantPrice(approvedProduct), 499);
  assert.equal(minVariantPrice({ ...approvedProduct, variants: [] }), 0);
  assert.equal(minVariantPrice({ ...approvedProduct, variants: [{ price: 100, is_active: false }] }), 0);
});

test('DB DRAFT/VERIFICATION statuses never map to PUBLISHED', () => {
  for (const status of ['DRAFT', 'SUBMITTED', 'VERIFICATION', 'REJECTED']) {
    const p = productToPublic({ ...approvedProduct, status }, 'https://abc.supabase.co');
    assert.equal(p.status, 'DRAFT', `${status} must map to DRAFT`);
  }
});

// ── routes: public gate ─────────────────────────────────────────────────────
test('GET /products returns only APPROVED products of APPROVED sellers with ACTIVE profiles', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  seedCatalog(fake);
  fake.helpers.seedSeller({ profile_id: 'seller-2', verification_status: 'REJECTED' });
  fake.helpers.seedProduct({
    ...approvedProduct, id: '22222222-2222-4222-8222-222222222222', seller_id: 'seller-2', name: 'Hidden Kurta',
  });
  fake.helpers.seedProduct({
    ...approvedProduct, id: '33333333-3333-4333-8333-333333333333', seller_id: SELLER, status: 'DRAFT', name: 'Draft Kurta',
  });
  fake.helpers.seedProduct({
    ...approvedProduct, id: '44444444-4444-4444-8444-444444444444', seller_id: SELLER,
    seller: { status: 'SUSPENDED', full_name: 'Arun Selvaraj' }, name: 'Suspended Kurta',
  });

  const res = await request(base, '/api/v1/products');
  assert.equal(res.status, 200);
  assert.equal(res.body.products.length, 1);
  assert.equal(res.body.products[0].id, '11111111-1111-4111-8111-111111111111');
});

test('GET /products with an empty catalog → 200 with an empty array (honest, never mock)', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const res = await request(base, '/api/v1/products');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { products: [] });
});

test('GET /products filters: price, minRating, category, search, inStock', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  seedCatalog(fake);
  fake.helpers.seedProduct({
    ...approvedProduct, id: '22222222-2222-4222-8222-222222222222', name: 'Silver Watch', brand: 'Titan',
    category: 'Watches', description: 'Quartz watch with leather strap.',
    variants: [{ id: 'w1', sku: 'W-01', price: 1200, stock: 0, is_active: true }],
  });

  const priceFiltered = await request(base, '/api/v1/products?minPrice=1000');
  assert.deepEqual(priceFiltered.body.products.map((p) => p.id), ['22222222-2222-4222-8222-222222222222']);

  const categoryFiltered = await request(base, '/api/v1/products?category=Watches');
  assert.deepEqual(categoryFiltered.body.products.map((p) => p.id), ['22222222-2222-4222-8222-222222222222']);

  const search = await request(base, '/api/v1/products?search=kurta');
  assert.deepEqual(search.body.products.map((p) => p.id), ['11111111-1111-4111-8111-111111111111']);

  const inStock = await request(base, '/api/v1/products?inStock=true');
  assert.deepEqual(inStock.body.products.map((p) => p.id), ['11111111-1111-4111-8111-111111111111']);

  // Honest: rating is 0 for every public product, so a non-zero floor is empty.
  const rated = await request(base, '/api/v1/products?minRating=4');
  assert.deepEqual(rated.body.products, []);

  const sorted = await request(base, '/api/v1/products?sort=price_asc');
  assert.deepEqual(sorted.body.products.map((p) => p.id), ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
});

test('GET /products validation errors → 400', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  const badPrice = await request(base, '/api/v1/products?minPrice=-5');
  assert.equal(badPrice.status, 400);
  assert.equal(badPrice.body.error.message, 'minPrice must be a non-negative number.');

  const badRating = await request(base, '/api/v1/products?minRating=9');
  assert.equal(badRating.status, 400);
});

test('GET /products/categories → distinct public categories only, sorted', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  seedCatalog(fake);
  fake.helpers.seedProduct({
    ...approvedProduct, id: '22222222-2222-4222-8222-222222222222', name: 'Silver Watch', category: 'Watches',
  });
  fake.helpers.seedProduct({
    ...approvedProduct, id: '33333333-3333-4333-8333-333333333333', category: 'DraftCat', status: 'DRAFT',
  });

  const res = await request(base, '/api/v1/products/categories');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.categories, ['Indian Wear', 'Watches']);
});

test('GET /products/:id → 200 for a public product, 404 otherwise', async (t) => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake);
  t.after(() => server.close());

  seedCatalog(fake);
  fake.helpers.seedSeller({ profile_id: 'seller-2', verification_status: 'PENDING' });
  fake.helpers.seedProduct({
    ...approvedProduct, id: '99999999-9999-4999-8999-999999999999', seller_id: 'seller-2', name: 'Not Approved Seller',
  });

  const found = await request(base, '/api/v1/products/11111111-1111-4111-8111-111111111111');
  assert.equal(found.status, 200);
  assert.equal(found.body.product.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(found.body.product.status, 'PUBLISHED');

  const hidden = await request(base, '/api/v1/products/99999999-9999-4999-8999-999999999999');
  assert.equal(hidden.status, 404);

  const unknown = await request(base, '/api/v1/products/00000000-0000-0000-0000-000000000000');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.message, 'Product not found.');

  const malformed = await request(base, '/api/v1/products/not-a-uuid');
  assert.equal(malformed.status, 404);
});