/**
 * Public product catalog — Phase 8 READ side only. The seller-side CRUD,
 * verification workflow, image storage and pricing stay in the full Phase 8
 * build; this surface makes the shop pages work against the REAL schema with
 * NO mock data (AGENTS.md §2.5/§2.6).
 *
 * Contract (src/services/productService.ts + src/types/product.ts):
 *   GET /products            ?search&category&minPrice&maxPrice&minRating&inStock&sort&sellerId
 *                            → { products: Product[] }
 *   GET /products/categories → { categories: string[] }
 *   GET /products/:id        → { product: Product } | 404
 *
 * Public gate (server-enforced, never client-driven):
 *   products.status = 'APPROVED'                             AND
 *   seller_profiles.verification_status = 'APPROVED'         AND
 *   profiles.status = 'ACTIVE'
 *
 * Empty results are HONEST — the catalog stays empty until sellers publish
 * real products through Phase 8. Search/category/price/sort are server-side;
 * frontend validation is only UX (§5-42/43).
 */
import { Router } from 'express';
import {
  HttpError,
  describeUpstreamError,
  httpError,
  isTransientUpstreamError,
  ok,
  withReadRetry,
} from '../lib/errors.js';
import {
  PUBLIC_PRODUCT_STATUS,
  PUBLIC_SELLER_STATUS,
  PUBLIC_PROFILE_STATUS,
  productToPublic,
} from '../lib/productShape.js';

const SORT_KEYS = new Set(['featured', 'price_asc', 'price_desc', 'rating', 'newest']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public fields ONLY — never expose seller_id/seller internals beyond what
// the frontend Product contract needs.
const PRODUCT_SELECT = `
  id, name, brand, category, description, material, colors, verification_meta,
  status, created_at, updated_at, seller_id,
  seller:profiles!products_seller_id_fkey(status, full_name),
  variants:product_variants(id, sku, price, stock, is_active),
  images:product_images(storage_bucket, storage_path, position, is_primary, mime_type)
`;

function parseNonNegative(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) throw httpError(400, `${label} must be a non-negative number.`);
  return num;
}

async function fetchApprovedProducts(supabase) {
  // READ-ONLY, so a single bounded retry is safe (see withReadRetry). A
  // transport blip — the usual cause of `TypeError: fetch failed`, e.g. a stale
  // pooled socket after an idle period — is absorbed here instead of surfacing
  // an error page to the shopper. A genuine PostgREST/RLS failure is NOT
  // retried and still produces the honest 502 below.
  try {
    return await withReadRetry(
      async () => {
        const { data, error } = await supabase.service
          .from('products')
          .select(PRODUCT_SELECT)
          .eq('status', PUBLIC_PRODUCT_STATUS);
        if (error) {
          // supabase-js RESOLVES with { error } instead of throwing, so a
          // transport failure has to be re-thrown AS-IS for the retry layer to
          // see and classify it. Converting it to an HttpError here would make
          // every blip look like a deliberate 502 and silently disable the
          // retry. Anything that is not a transport failure (bad select, RLS,
          // SQL error) is a real bug: it is logged with its full cause and
          // fails immediately, once.
          if (isTransientUpstreamError(error)) throw error;
          // The real cause goes to the server log only; the client gets a
          // generic 502 and never an internal detail (§5-80).
          // eslint-disable-next-line no-console
          console.error('[products] catalog query failed:', describeUpstreamError(error));
          throw httpError(502, 'Unable to load the catalog. Please try again later.');
        }
        return data ?? [];
      },
      { label: 'products' },
    );
  } catch (err) {
    // withReadRetry already logged every attempt and the give-up decision, so
    // this only translates the final transport failure into the public 502.
    // It must NOT be logged twice, and it must never be turned into a success.
    if (err instanceof HttpError) throw err;
    throw httpError(502, 'Unable to load the catalog. Please try again later.');
  }
}

async function approvedSellerIds(supabase, sellerIds) {
  const approved = new Set();
  if (!sellerIds.length) return approved;
  const { data, error } = await supabase.service
    .from('seller_profiles')
    .select('profile_id, verification_status')
    .in('profile_id', sellerIds);
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[products] seller gate query failed:', error.message);
    throw httpError(502, 'Unable to load the catalog. Please try again later.');
  }
  for (const row of data ?? []) {
    if (row.verification_status === PUBLIC_SELLER_STATUS) approved.add(row.profile_id);
  }
  return approved;
}

function isPubliclyVisible(row, approvedSellers) {
  return approvedSellers.has(row.seller_id) && (row.seller?.status ?? '') === PUBLIC_PROFILE_STATUS;
}

export function createProductsRouter({ env, supabase }) {
  const router = Router();
  const imageBase = String(env.SUPABASE_URL).replace(/\/+$/, '');

  // GET /products/categories MUST be registered before /products/:id.
  router.get('/products/categories', async (req, res) => {
    const rows = await fetchApprovedProducts(supabase);
    const approved = await approvedSellerIds(
      supabase,
      [...new Set(rows.map((r) => r.seller_id).filter(Boolean))],
    );
    const categories = [
      ...new Set(
        rows
          .filter((r) => isPubliclyVisible(r, approved))
          .map((r) => r.category ?? '')
          .filter(Boolean),
      ),
    ].sort();
    return ok(res, { categories });
  });

  router.get('/products', async (req, res) => {
    const { search, category, minPrice, maxPrice, minRating, inStock, sort, sellerId } = req.query;

    const min = parseNonNegative(minPrice, 'minPrice');
    const max = parseNonNegative(maxPrice, 'maxPrice');
    const rating = minRating === undefined || minRating === null || minRating === '' ? null : Number(minRating);
    if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) {
      throw httpError(400, 'minRating must be between 0 and 5.');
    }
    const stockOnly = inStock === 'true';
    const sortKey = SORT_KEYS.has(sort) ? sort : 'featured';
    const sellerHint = sellerId ? String(sellerId).trim() : '';

    const rows = await fetchApprovedProducts(supabase);
    const approved = await approvedSellerIds(
      supabase,
      [...new Set(rows.map((r) => r.seller_id).filter(Boolean))],
    );

    // Shape once, then filter/sort on the PUBLIC contract fields.
    let result = rows
      .filter((r) => isPubliclyVisible(r, approved))
      .map((r) => productToPublic(r, imageBase));

    if (search && String(search).trim()) {
      const q = String(search).trim().toLowerCase();
      result = result.filter((p) =>
        [p.name, p.brand, p.description].some((f) => String(f ?? '').toLowerCase().includes(q)),
      );
    }
    if (category && category !== 'All') result = result.filter((p) => p.category === category);
    if (sellerHint) result = result.filter((p) => p.sellerId === sellerHint);
    if (min !== null) result = result.filter((p) => p.price >= min);
    if (max !== null) result = result.filter((p) => p.price <= max);
    if (rating !== null) result = result.filter((p) => p.rating >= rating);
    if (stockOnly) result = result.filter((p) => p.stock > 0);

    switch (sortKey) {
      case 'price_asc':
        result.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        result.sort((a, b) => b.price - a.price);
        break;
      case 'rating':
        result.sort((a, b) => b.rating - a.rating);
        break;
      case 'newest':
      default:
        // "featured" = newest-approved until a campaign flag exists.
        result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
    }

    return ok(res, { products: result });
  });

  router.get('/products/:id', async (req, res) => {
    const id = String(req.params.id ?? '').trim();
    // Generic 404 for malformed ids too — no format information leaked.
    if (!UUID_RE.test(id)) throw httpError(404, 'Product not found.');

    const { data, error } = await supabase.service
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('id', id)
      .eq('status', PUBLIC_PRODUCT_STATUS);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[products] product query failed:', error.message);
      throw httpError(502, 'Unable to load the product. Please try again later.');
    }
    const row = (data ?? [])[0];
    if (!row) throw httpError(404, 'Product not found.');

    const approved = await approvedSellerIds(supabase, [row.seller_id]);
    if (!isPubliclyVisible(row, approved)) throw httpError(404, 'Product not found.');

    return ok(res, { product: productToPublic(row, imageBase) });
  });

  return router;
}