/**
 * File upload endpoints (BACKEND_SPEC §9 — identity documents + product
 * images) with STRICT server-side validation:
 *
 *   POST /seller/documents        → { storagePath, mimeType, byteSize, signedUrl }
 *   POST /seller/product-images   → { storagePath, mimeType, byteSize }
 *
 * The request body is the RAW BYTES of the file (Content-Type:
 * application/octet-stream, image/* or application/pdf) — NOT multipart. The
 * route-level express.raw() parser enforces a hard size cap (6 MB) that 413s
 * fast; the uploaded bytes are then MIME-SNIFFED (magic bytes, never the
 * client's declared type), allowlist-checked, and re-checked against the
 * per-kind cap (5 MB images / 2 MB documents).
 *
 * Security:
 * - Identity documents go to a PRIVATE bucket (seller-documents) and are only
 *   ever surfaced through short-lived signed URLs (§9). Product images go to
 *   the public product-images bucket so the catalogue shaping keeps working.
 * - Storage object keys are SERVER-generated (random) — a client never picks
 *   the path (§5-38, §9).
 * - Both routes require an authenticated profile; the documents route also
 *   accepts a customer who is mid-application, so the identity-document gate
 *   is "authenticated + not suspended" (the seller application endpoint itself
 *   validates ownership of the produced storagePath).
 */
import { Router } from 'express';
import express from 'express';
import { httpError, ok } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { assertApprovedSeller } from '../middleware/seller.js';
import {
  ALLOWED_ID_DOCUMENT_MIMES,
  MAX_ID_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  PRODUCT_IMAGES_BUCKET,
  SELLER_DOCUMENTS_BUCKET,
  SELLER_DOCUMENTS_PREFIX,
  PRODUCT_IMAGES_PREFIX,
  assertUploadAllowed,
  uploadToStorage,
  createSignedUrl,
} from '../lib/uploads.js';

function assertActive(profile) {
  if (profile.status && profile.status !== 'ACTIVE') {
    throw httpError(403, 'Your account is not active.');
  }
}

export function createUploadsRouter({ env, supabase }) {
  const router = Router();
  const productBucket = env.STORAGE_BUCKET_PRODUCT_IMAGES || PRODUCT_IMAGES_BUCKET;
  const documentBucket = env.STORAGE_BUCKET_SELLER_DOCUMENTS || SELLER_DOCUMENTS_BUCKET;

  // Raw-body parsers for this router only. `entity.too.large` is mapped to a
  // clean 413 by the global errorHandler; the 6 MB cap is the hard ceiling
  // and per-kind caps (2/5 MB) are enforced again inside assertUploadAllowed.
  const rawDocumentParser = express.raw({
    type: ['application/octet-stream', 'application/pdf', 'image/jpeg', 'image/png'],
    limit: '2.5mb',
  });
  const rawImageParser = express.raw({
    type: ['application/octet-stream', 'image/jpeg', 'image/png', 'image/webp'],
    limit: '5.5mb',
  });

  // ── POST /seller/documents — ID document (private bucket + signed URL) ──
  router.post('/seller/documents', requireAuth(supabase, env), rawDocumentParser, async (req, res) => {
    const { profile } = req.auth;
    assertActive(profile);

    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const { mime, byteSize } = assertUploadAllowed(bytes, 'document'); // 400/413

    const storagePath = await uploadToStorage(supabase.service, {
      bucket: documentBucket,
      bytes,
      mime,
      prefix: SELLER_DOCUMENTS_PREFIX,
    });
    const signedUrl = await createSignedUrl(supabase.service, {
      bucket: documentBucket,
      path: storagePath,
      expiresIn: 3600,
    });

    return ok(res, { storagePath, mimeType: mime, byteSize, signedUrl });
  });

  // ── POST /seller/product-images — product image (public bucket) ─────────
  router.post(
    '/seller/product-images',
    requireAuth(supabase, env),
    rawImageParser,
    async (req, res) => {
      const { profile } = req.auth;
      // Product uploads are for sellers managing their catalogue. Same single
      // shared authority as every other seller route (SELLER role AND an
      // APPROVED verification in the database).
      assertApprovedSeller(profile);
      assertActive(profile);

      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const { mime, byteSize } = assertUploadAllowed(bytes, 'image'); // 400/413

      const storagePath = await uploadToStorage(supabase.service, {
        bucket: productBucket,
        bytes,
        mime,
        prefix: PRODUCT_IMAGES_PREFIX,
      });

      const imageBase = String(env.SUPABASE_URL ?? '').replace(/\/+$/, '');
      const publicUrl = `${imageBase}/storage/v1/object/public/${productBucket}/${storagePath}`;

      return ok(res, { storagePath, mimeType: mime, byteSize, publicUrl });
    },
  );

  return router;
}

// Re-export caps so consumers (tests, future routes) use one source of truth.
export { ALLOWED_ID_DOCUMENT_MIMES, MAX_ID_DOCUMENT_BYTES, MAX_IMAGE_BYTES };