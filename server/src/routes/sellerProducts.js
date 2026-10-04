/**
 * Seller product management (BACKEND_SPEC §10/§12/§13/§14 + Phase 9 write side).
 *
 * Contract (src/services/productService.ts / sellerService.ts + the seller
 * product pages):
 *   GET    /seller/products                        → { products }
 *   POST   /seller/products                        → { product }
 *   PUT    /seller/products/:id                    → { product }
 *   DELETE /seller/products/:id                    → { success }
 *
 * Security:
 * - Every seller route re-checks the session profile is an APPROVED seller
 *   (or a promoted SELLER role); the client never declares its own role (§5-10).
 * - POST/PUT/DELETE are ownership-scoped: a seller may only touch products it
 *   owns (product.seller_id === session profile id, §5-34) — IDOR-proof.
 * - The DB maps frontend statuses honestly: the schema's product_status enum is
 *   DRAFT/SUBMITTED/VERIFICATION/APPROVED/REJECTED. A seller can never self-set
 *   APPROVED (that is the admin verification pipeline's decision). The UI's
 *   "PUBLISHED" toggle maps to SUBMITTED (sent for review); everything else
 *   surfaces as DRAFT until an admin approves.
 * - PRODUCT images are never accepted as free-form URLs: they must reference an
 *   object ALREADY uploaded through the store upload flow (POST /seller/
 *   product-images) and are verified with a storage .info() call so the REAL
 *   mime_type/byte_size are recorded — no fabricated metadata (§5-38, §9).
 * - `tagline`, `originalPrice`, `threeDConfig`, `specifications`,
 *   `deliveryEstimateDays`, `returnPolicyDays` are part of the frontend Product
 *   contract but have NO column in the 0001 products schema yet (their build
 *   phases own them). They surface as the honest defaults productToPublic
 *   already returns and are deliberately not persisted here.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { httpError, ok } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { assertApprovedSeller as assertSeller } from '../middleware/seller.js';
import { writeAudit } from '../lib/audit.js';
import { validate } from '../lib/schema.js';
import { productToPublic, formatProductCode } from '../lib/productShape.js';
import { ALLOWED_IMAGE_MIMES, MAX_IMAGE_BYTES, PRODUCT_IMAGES_BUCKET, verifyStoredObject } from '../lib/uploads.js';
import { analyzeProductImageWithGemini } from '../lib/geminiProductAnalyzer.js';
import { sendProductSubmittedAdminAlertEmail } from '../lib/mail.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Seller gate — mirrors orders.js isSeller(): promoted sellers keep their
 *  primary role (CUSTOMER) so requireRole('SELLER') would wrongly fail them. */
/** True when a DB unique-index violation names the given index. */
function isUniqueViolation(error, indexName) {
  const msg = String(error?.message ?? '');
  return /duplicate key value/i.test(msg) && msg.includes(indexName);
}

/** Parses a public object URL of THIS project's storage into { bucket, path }.
 *  Anything else (external CDN URL, relative path, junk) → null. */
function parsePublicImageUrl(raw, imageBase) {
  if (typeof raw !== 'string') return null;
  const base = String(imageBase ?? '').replace(/\/+$/, '');
  if (!base) return null;
  const prefix = `${base}/storage/v1/object/public/`;
  if (!raw.startsWith(prefix)) return null;
  const rest = raw.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash >= rest.length - 1) return null;
  const bucket = decodeURIComponent(rest.slice(0, slash));
  const path = rest
    .slice(slash + 1)
    .split('/')
    .map(decodeURIComponent)
    .join('/');
  if (!bucket || !path) return null;
  return { bucket, path };
}

/** Loads a product row with its variants/images/seller merged in — the select
 *  string with embedded relations is a REAL-Postgres feature the test fake
 *  cannot honour, so we assemble the bundle from separate queries instead
 *  (works identically against both). */
async function loadProductBundle(supabase, id) {
  const { data: productRows, error: productError } = await supabase.service
    .from('products')
    .select('*')
    .eq('id', id);
  if (productError) throw productError;
  const row = (productRows ?? [])[0] ?? null;
  if (!row) return null;

  const [{ data: variantRows = [], error: variantError }, { data: imageRows = [], error: imageError }] =
    await Promise.all([
      supabase.service.from('product_variants').select('*').eq('product_id', id),
      supabase.service.from('product_images').select('*').eq('product_id', id),
    ]);
  if (variantError) throw variantError;
  if (imageError) throw imageError;

  row.variants = variantRows;
  row.images = imageRows;

  const { data: sellerRows = [] } = await supabase.service
    .from('profiles')
    .select('id, full_name, status')
    .eq('id', row.seller_id);
  row.seller = sellerRows[0] ?? null;
  return row;
}

const FIELD_RULES = {
  name: { type: 'string', min: 3, max: 160, label: 'Product name' },
  brand: { type: 'string', min: 1, max: 100, label: 'Brand' },
  category: { type: 'string', min: 2, max: 80, label: 'Category' },
  description: { type: 'string', max: 5000, label: 'Description' },
  price: { type: 'number', label: 'Price', minValue: 0.01, maxValue: 10000000 },
  stock: { type: 'integer', label: 'Stock', minValue: 0, maxValue: 100000 },
  sku: { type: 'string', min: 4, max: 64, label: 'SKU' },
  colors: {
    type: 'array',
    label: 'Colours',
    maxItems: 20,
    arrayOf: { type: 'string', max: 40, label: 'Colour' },
  },
  material: { type: 'string', max: 500, label: 'Material' },
  keywords: {
    type: 'array',
    label: 'Search keywords',
    maxItems: 30,
    arrayOf: { type: 'string', max: 80, label: 'Keyword' },
  },
  images: {
    type: 'array',
    label: 'Product images',
    maxItems: 6,
    arrayOf: { type: 'string', max: 500, label: 'Image URL' },
  },
  status: { type: 'string', enum: ['DRAFT', 'PUBLISHED'], label: 'Status' },
};

const CREATE_SCHEMA = {
  name: { ...FIELD_RULES.name, required: true },
  brand: { ...FIELD_RULES.brand, required: true },
  category: { ...FIELD_RULES.category, required: true },
  description: FIELD_RULES.description,
  price: { ...FIELD_RULES.price, required: true },
  stock: { ...FIELD_RULES.stock, required: true },
  sku: { ...FIELD_RULES.sku, required: true },
  colors: FIELD_RULES.colors,
  material: FIELD_RULES.material,
  keywords: FIELD_RULES.keywords,
  images: FIELD_RULES.images,
  status: FIELD_RULES.status,
};

/** Frontend PUBLISHED ⇄ DB SUBMITTED; DRAFT stays DRAFT. Self-approval is
 *  impossible: APPROVED is only ever written by the admin verification flow. */
function dbStatusFromFrontend(status) {
  if (status === 'PUBLISHED') return 'SUBMITTED';
  return 'DRAFT';
}

export function createSellerProductsRouter({ env, supabase }) {
  const router = Router();
  const imageBase = String(env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const productBucket = env.STORAGE_BUCKET_PRODUCT_IMAGES || PRODUCT_IMAGES_BUCKET;

  // ── GET /seller/products — own catalogue (includes drafts) ───────────────
  router.get('/seller/products', requireAuth(supabase, env), async (req, res) => {
    const { profile } = req.auth;
    assertSeller(profile);

    const [productsRes, orderItemsRes] = await Promise.all([
      supabase.service.from('products').select('*').eq('seller_id', profile.id),
      supabase.service.from('order_items').select('product_id, quantity').eq('seller_id', profile.id),
    ]);
    if (productsRes.error) {
      // eslint-disable-next-line no-console
      console.error('[seller/products] catalogue query failed:', productsRes.error.message);
      throw httpError(502, 'Unable to load your products. Please try again later.');
    }

    const soldByProduct = new Map();
    for (const it of orderItemsRes.data ?? []) {
      soldByProduct.set(it.product_id, (soldByProduct.get(it.product_id) || 0) + (Number(it.quantity) || 0));
    }

    const products = [];
    for (const row of productsRes.data ?? []) {
      const bundle = await loadProductBundle(supabase, row.id);
      if (!bundle) continue;
      const pub = productToPublic(bundle, imageBase);
      const totalStock = (bundle.variants ?? []).reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
      const soldCount = soldByProduct.get(row.id) || 0;
      const balanceStock = Math.max(0, totalStock - soldCount);
      const sku = bundle.variants?.[0]?.sku ?? '';
      const productCode = formatProductCode(sku, row.id);

      products.push({
        ...pub,
        productCode,
        sku,
        approvalStatus: row.status ?? 'SUBMITTED',
        totalStock,
        soldCount,
        balanceStock,
        variants: bundle.variants ?? [],
      });
    }
    return ok(res, { products });
  });

  // ── POST /seller/products/analyze-image — AI auto-fill product details ───
  router.post('/seller/products/analyze-image', requireAuth(supabase, env), async (req, res) => {
    const { profile } = req.auth;
    assertSeller(profile);

    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : null;
    const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.trim() : null;
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    const productNameHint = typeof req.body?.productNameHint === 'string' ? req.body.productNameHint.trim() : '';

    if (!imageUrl && !imageBase64 && images.length === 0 && !productNameHint) {
      throw httpError(400, 'An image or product name is required for analysis.');
    }

    let buffer = null;
    let mimeType = 'image/jpeg';
    if (imageBase64) {
      const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        buffer = Buffer.from(match[2], 'base64');
      } else {
        buffer = Buffer.from(imageBase64, 'base64');
      }
    }

    const analysis = await analyzeProductImageWithGemini(env, {
      imageBuffer: buffer,
      mimeType,
      imageUrl,
      images,
      productNameHint,
    });

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: 'SELLER',
      action: 'seller.product.ai_analyzed',
      resourceType: 'product',
      resourceId: profile.id,
      ip: req.ip ?? null,
      metadata: { category: analysis.category, productType: analysis.product_type },
    }).catch(() => {});

    return ok(res, { analysis });
  });

  // ── POST /seller/products — create (product + primary variant + images) ──
  router.post('/seller/products', requireAuth(supabase, env), async (req, res) => {
    const { profile } = req.auth;
    assertSeller(profile);

    const result = validate(req.body ?? {}, CREATE_SCHEMA);
    if (!result.ok) {
      const first = Object.values(result.errors)[0];
      throw httpError(400, typeof first === 'string' ? first : 'Please review the entered details.');
    }
    const f = result.fields;
    const now = new Date().toISOString();
    const productId = crypto.randomUUID();

    // Verify every image against storage BEFORE writing the product so a bad
    // image never leaves a half-created record (§5-36/37).
    const imageRows = [];
    const rawImages = Array.isArray(f.images) ? f.images : [];
    for (let i = 0; i < rawImages.length; i += 1) {
      const parsed = parsePublicImageUrl(rawImages[i], imageBase);
      if (!parsed || parsed.bucket !== productBucket) {
        throw httpError(
          400,
          'Product images must be uploaded through the store upload flow first.',
        );
      }
      const { mime, byteSize } = await verifyStoredObject(supabase.service, {
        bucket: parsed.bucket,
        path: parsed.path,
        allowedMimes: ALLOWED_IMAGE_MIMES,
        maxBytes: MAX_IMAGE_BYTES,
        kindLabel: 'product image',
      });
      imageRows.push({
        id: crypto.randomUUID(),
        product_id: productId,
        storage_bucket: parsed.bucket,
        storage_path: parsed.path,
        position: i,
        is_primary: i === 0,
        mime_type: mime,
        byte_size: byteSize,
        created_at: now,
      });
    }

    const specifications = Array.isArray(req.body.specifications)
      ? req.body.specifications.filter((s) => s && typeof s === 'object')
      : [];
    const threeDConfig = req.body.threeDConfig && typeof req.body.threeDConfig === 'object'
      ? req.body.threeDConfig
      : null;

    const { error: productError } = await supabase.service.from('products').insert({
      id: productId,
      seller_id: profile.id,
      name: f.name,
      brand: f.brand,
      category: f.category,
      description: f.description || null,
      colors: Array.isArray(f.colors) ? f.colors : [],
      material: f.material ?? null,
      keywords: Array.isArray(f.keywords) ? f.keywords : [],
      status: dbStatusFromFrontend(f.status),
      verification_meta: {
        specifications,
        threeDConfig,
      },
      created_at: now,
      updated_at: now,
    });
    if (productError) {
      // eslint-disable-next-line no-console
      console.error('[seller/products] create failed:', productError.message);
      throw httpError(502, 'Unable to create the product. Please try again.');
    }

    const rawVariants = Array.isArray(req.body.variants) && req.body.variants.length > 0
      ? req.body.variants
      : null;

    const variantRows = rawVariants
      ? rawVariants.map((v, idx) => ({
          id: crypto.randomUUID(),
          product_id: productId,
          sku: String(v.sku || `${f.sku}-${idx + 1}`).trim(),
          size: v.size ? String(v.size).trim() : null,
          color: v.color ? String(v.color).trim() : null,
          price: Number(v.price) > 0 ? Number(v.price) : f.price,
          stock: Number(v.stock) >= 0 ? Number(v.stock) : f.stock,
          is_active: true,
          created_at: now,
          updated_at: now,
        }))
      : [{
          id: crypto.randomUUID(),
          product_id: productId,
          sku: f.sku,
          size: null,
          color: null,
          price: f.price,
          stock: f.stock,
          is_active: true,
          created_at: now,
          updated_at: now,
        }];

    const { error: variantError } = await supabase.service.from('product_variants').insert(variantRows);
    if (variantError) {
      if (isUniqueViolation(variantError, 'product_variants_sku_uniq')) {
        // Clean up the orphan product row — never leave a half-created record.
        try {
          await supabase.service.from('products').delete().eq('id', productId);
        } catch (cleanupError) {
          // eslint-disable-next-line no-console
          console.error('[seller/products] create cleanup failed:', cleanupError?.message);
        }
        throw httpError(409, 'This SKU is already in use.');
      }
      // eslint-disable-next-line no-console
      console.error('[seller/products] variant insert failed:', variantError.message);
      throw httpError(502, 'Unable to create the product. Please try again.');
    }

    if (imageRows.length) {
      const { error: imagesError } = await supabase.service.from('product_images').insert(imageRows);
      if (imagesError) {
        // Roll back the product + variant so nothing half-created remains.
        try {
          await supabase.service.from('product_variants').delete().eq('product_id', productId);
          await supabase.service.from('products').delete().eq('id', productId);
        } catch (cleanupError) {
          // eslint-disable-next-line no-console
          console.error('[seller/products] images rollback failed:', cleanupError?.message);
        }
        // eslint-disable-next-line no-console
        console.error('[seller/products] images insert failed:', imagesError.message);
        throw httpError(502, 'Unable to save the product images. Please try again.');
      }
    }

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'product.created',
      resourceType: 'product',
      resourceId: productId,
      ip: req.ip ?? null,
      metadata: { sku: f.sku, price: f.price },
    });

    const bundle = await loadProductBundle(supabase, productId);

    // Trigger admin alert for catalog verification (non-blocking)
    (async () => {
      try {
        const { data: sProfile } = await supabase.service
          .from('seller_profiles')
          .select('store_name')
          .eq('profile_id', profile.id)
          .maybeSingle();
        await sendProductSubmittedAdminAlertEmail(env, {
          productName: f.name,
          storeName: sProfile?.store_name || 'Campus Merchant',
          price: f.price,
          category: f.category,
        });
      } catch (mailErr) {
        // eslint-disable-next-line no-console
        console.warn('[seller/products] admin product alert failed:', mailErr?.message || mailErr);
      }
    })();

    return ok(res, { product: productToPublic(bundle, imageBase) });
  });

  // ── PUT /seller/products/:id — update OWN product (partial) ─────────────
  const UPDATE_SCHEMA = FIELD_RULES; // every field optional on update

  router.put('/seller/products/:id', requireAuth(supabase, env), async (req, res) => {
    const { profile } = req.auth;
    assertSeller(profile);
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Product not found.');

    const bundle = await loadProductBundle(supabase, id);
    if (!bundle || bundle.seller_id !== profile.id) throw httpError(404, 'Product not found.');

    const result = validate(req.body ?? {}, UPDATE_SCHEMA);
    if (!result.ok) {
      const first = Object.values(result.errors)[0];
      throw httpError(400, typeof first === 'string' ? first : 'Please review the entered details.');
    }
    const now = new Date().toISOString();
    const patch = { updated_at: now };
    const allowedStatus = result.fields.status;
    if (allowedStatus !== undefined) {
      if (allowedStatus === 'PUBLISHED' || allowedStatus === 'DRAFT') {
        patch.status = dbStatusFromFrontend(allowedStatus);
      } else {
        throw httpError(400, 'Only DRAFT or PUBLISHED status can be set by the store.');
      }
    }
    for (const key of ['name', 'brand', 'category', 'description', 'material']) {
      if (result.fields[key] !== undefined) patch[key] = result.fields[key] || null;
    }
    if (result.fields.colors !== undefined) patch.colors = result.fields.colors;
    if (result.fields.keywords !== undefined) patch.keywords = result.fields.keywords;

    if (Array.isArray(req.body.specifications) || req.body.threeDConfig) {
      const existingMeta = bundle.verification_meta && typeof bundle.verification_meta === 'object' ? bundle.verification_meta : {};
      patch.verification_meta = {
        ...existingMeta,
        ...(Array.isArray(req.body.specifications) ? { specifications: req.body.specifications.filter((s) => s && typeof s === 'object') } : {}),
        ...(req.body.threeDConfig && typeof req.body.threeDConfig === 'object' ? { threeDConfig: req.body.threeDConfig } : {}),
      };
    }

    if (Object.keys(patch).length > 1) {
      const { error: productError } = await supabase.service
        .from('products')
        .update(patch)
        .eq('id', id);
      if (productError) {
        // eslint-disable-next-line no-console
        console.error('[seller/products] update failed:', productError.message);
        throw httpError(502, 'Unable to update the product. Please try again.');
      }
    }

    // Price/stock/SKU live on the variant — update the product's FIRST ACTIVE
    // variant (the schema is one-parent-many-variants; multi-variant editing
    // lands with its own phase in §12 — never silently pick the wrong one).
    const activeVariant = (bundle.variants ?? []).find((v) => v.is_active !== false);
    const variantPatch = { updated_at: now };
    if (result.fields.price !== undefined) variantPatch.price = result.fields.price;
    if (result.fields.stock !== undefined) variantPatch.stock = result.fields.stock;
    if (result.fields.sku !== undefined) variantPatch.sku = result.fields.sku;
    if (Object.keys(variantPatch).length > 1) {
      if (!activeVariant) throw httpError(400, 'This product has no active variant to update.');
      const { error: variantError } = await supabase.service
        .from('product_variants')
        .update(variantPatch)
        .eq('id', activeVariant.id);
      if (variantError) {
        if (isUniqueViolation(variantError, 'product_variants_sku_uniq')) {
          throw httpError(409, 'This SKU is already in use.');
        }
        // eslint-disable-next-line no-console
        console.error('[seller/products] variant update failed:', variantError.message);
        throw httpError(502, 'Unable to update the product. Please try again.');
      }
    }

    // Images replace the full set — verified against storage first.
    if (result.fields.images !== undefined) {
      const rawImages = result.fields.images;
      const newImages = [];
      for (let i = 0; i < rawImages.length; i += 1) {
        const parsed = parsePublicImageUrl(rawImages[i], imageBase);
        if (!parsed || parsed.bucket !== productBucket) {
          throw httpError(400, 'Product images must be uploaded through the store upload flow first.');
        }
        const { mime, byteSize } = await verifyStoredObject(supabase.service, {
          bucket: parsed.bucket,
          path: parsed.path,
          allowedMimes: ALLOWED_IMAGE_MIMES,
          maxBytes: MAX_IMAGE_BYTES,
          kindLabel: 'product image',
        });
        newImages.push({
          id: crypto.randomUUID(),
          product_id: id,
          storage_bucket: parsed.bucket,
          storage_path: parsed.path,
          position: i,
          is_primary: i === 0,
          mime_type: mime,
          byte_size: byteSize,
          created_at: now,
        });
      }
      const { error: deleteError } = await supabase.service
        .from('product_images')
        .delete()
        .eq('product_id', id);
      if (deleteError) {
        // eslint-disable-next-line no-console
        console.error('[seller/products] images replace (delete) failed:', deleteError.message);
        throw httpError(502, 'Unable to replace the product images. Please try again.');
      }
      if (newImages.length) {
        const { error: imagesError } = await supabase.service
          .from('product_images')
          .insert(newImages);
        if (imagesError) {
          // eslint-disable-next-line no-console
          console.error('[seller/products] images replace (insert) failed:', imagesError.message);
          throw httpError(502, 'Unable to replace the product images. Please try again.');
        }
      }
    }

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'product.updated',
      resourceType: 'product',
      resourceId: id,
      ip: req.ip ?? null,
      metadata: { fields: Object.keys(patch) },
    });

    const updated = await loadProductBundle(supabase, id);
    return ok(res, { product: productToPublic(updated, imageBase) });
  });

  // ── DELETE /seller/products/:id — soft delete (hides from public) ───────
  router.delete('/seller/products/:id', requireAuth(supabase, env), async (req, res) => {
    const { profile } = req.auth;
    assertSeller(profile);
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) throw httpError(404, 'Product not found.');

    const bundle = await loadProductBundle(supabase, id);
    if (!bundle || bundle.seller_id !== profile.id) throw httpError(404, 'Product not found.');

    const now = new Date().toISOString();
    const { error: productError } = await supabase.service
      .from('products')
      .update({ status: 'DRAFT', updated_at: now })
      .eq('id', id);
    if (productError) {
      // eslint-disable-next-line no-console
      console.error('[seller/products] delete update failed:', productError.message);
      throw httpError(502, 'Unable to remove the product. Please try again.');
    }
    const { error: variantError } = await supabase.service
      .from('product_variants')
      .update({ is_active: false, updated_at: now })
      .eq('product_id', id);
    if (variantError) {
      // eslint-disable-next-line no-console
      console.error('[seller/products] delete variants failed:', variantError.message);
      throw httpError(502, 'Unable to remove the product. Please try again.');
    }

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'product.removed',
      resourceType: 'product',
      resourceId: id,
      ip: req.ip ?? null,
      metadata: {},
    });

    return ok(res, { success: true });
  });

  return router;
}