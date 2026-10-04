/**
 * Server-side file upload validation + Supabase Storage helpers (BACKEND_SPEC
 * §9 — "do not trust the client-provided MIME type alone").
 *
 * The client's declared Content-Type is NEVER trusted. The first bytes of the
 * file are sniffed here (magic numbers) to derive the REAL MIME type; only
 * allowlisted types pass (§9: reject unsupported files, no executables).
 * Sizes are capped per document kind; oversized uploads are rejected with a
 * clean 413 (the raw-body parser limit in routes/uploads.js also enforces the
 * cap at the HTTP layer).
 *
 * Storage objects get random, server-chosen keys — a client never picks the
 * path (§9, §5-38) — and ID documents live in a PRIVATE bucket accessed only
 * through short-lived signed URLs (§9). Product images use the public
 * `product-images` bucket so existing public catalogue shaping keeps working.
 */
import crypto from 'node:crypto';
import { httpError } from './errors.js';

export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_ID_DOCUMENT_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];

/** Per-kind size caps (bytes). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB product images
export const MAX_ID_DOCUMENT_BYTES = 2 * 1024 * 1024; // 2 MB ID documents
/** Hard cap for the raw-body parser so a single oversized request fails fast. */
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export const PRODUCT_IMAGES_BUCKET = 'product-images';
export const SELLER_DOCUMENTS_BUCKET = 'seller-documents';
export const SELLER_DOCUMENTS_PREFIX = 'seller-docs';
export const PRODUCT_IMAGES_PREFIX = 'product-images';
/** Private bucket holding verification identity documents (0006 workflow). */
export const VERIFICATION_DOCS_BUCKET = 'seller-verification-docs';
export const VERIFICATION_DOCS_PREFIX = 'verif-docs';

const TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Magic-byte MIME detection — authoritative (never trusts the declared type).
 * Returns null when the bytes match nothing we accept.
 */
export function sniffMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = (i) => buffer[i];
  // JPEG: FF D8 FF
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 &&
    b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a
  ) return 'image/png';
  // WebP: "RIFF" .... "WEBP"
  if (
    b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
    b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50
  ) return 'image/webp';
  // PDF: "%PDF-"
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46 && b(4) === 0x2d) {
    return 'application/pdf';
  }
  return null;
}

/** Deterministic extension for a validated MIME type (or '' when unknown). */
export function extensionForMime(mime) {
  return TO_EXT[mime] ?? '';
}

/** Server-chosen random storage key — the client never picks a path. */
export function randomStorageKey(prefix, mime) {
  const ext = extensionForMime(mime) || 'bin';
  return `${prefix}/${Date.now()}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
}

const KIND = {
  image: { allow: ALLOWED_IMAGE_MIMES, max: MAX_IMAGE_BYTES, label: 'product image' },
  document: { allow: ALLOWED_ID_DOCUMENT_MIMES, max: MAX_ID_DOCUMENT_BYTES, label: 'identity document' },
};

/**
 * Validates a raw upload buffer. Throws HttpError with a clean message when
 * the sniffed type is unsupported or the size is over the kind's cap.
 * @returns {{ mime: string, byteSize: number }}
 */
export function assertUploadAllowed(bytes, kind) {
  const config = KIND[kind];
  if (!config) throw new Error(`assertUploadAllowed: unknown kind "${kind}"`);
  if (!bytes || bytes.byteLength === 0) {
    throw httpError(400, 'The uploaded file is empty.');
  }
  const mime = sniffMime(bytes);
  if (!mime || !config.allow.includes(mime)) {
    throw httpError(400, `Unsupported ${config.label} type. Allowed: ${config.allow.join(', ')}.`);
  }
  if (bytes.byteLength > config.max) {
    const mb = config.max / (1024 * 1024);
    throw httpError(413, `${config.label} must be ${mb} MB or smaller.`);
  }
  return { mime, byteSize: bytes.byteLength };
}

/**
 * Uploads validated bytes to Supabase Storage under a random key in `bucket`.
 * @returns {Promise<string>} the storage path
 */
export async function uploadToStorage(service, { bucket, bytes, mime, prefix }) {
  const path = randomStorageKey(prefix, mime);
  const { error } = await service.storage.from(bucket).upload(path, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[uploads] storage upload failed:', error.message);
    throw httpError(502, 'Unable to store the uploaded file. Please try again.');
  }
  return path;
}

/**
 * Generates a short-lived signed URL for a private object (ID documents).
 */
export async function createSignedUrl(service, { bucket, path, expiresIn = 3600 }) {
  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    // eslint-disable-next-line no-console
    console.error('[uploads] signed-url generation failed:', error?.message ?? 'no url returned');
    throw httpError(502, 'Unable to prepare the document for viewing. Please try again.');
  }
  return data.signedUrl;
}

/**
 * Normalizes Supabase Storage `.download()` results to a Buffer.
 *
 * Supabase-js returns a **Blob** on real projects (fetch-style API), a Buffer
 * when the fakes/tests return one, or an ArrayBuffer in some runtimes —
 * never assume a single shape. Blob → Buffer via arrayBuffer().
 */
export async function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  if (data && typeof data.arrayBuffer === 'function') {
    return Buffer.from(await data.arrayBuffer());
  }
  throw new Error('Unsupported storage download payload.');
}

/**
 * Verifies an object the client references actually exists in storage AND
 * re-derives its REAL MIME type + byte size from the stored bytes.
 *
 * Why not storage.info()? On S3-backed Supabase projects, `info()` no longer
 * returns `metadata.mimetype`/`metadata.size` reliably (they can be
 * `undefined`), which made the old metadata-based cross-check reject honest
 * uploads with a false 400. Downloading + magic-byte sniffing works on every
 * storage backend and is a STRONGER check: the referenced object must exist
 * and its real bytes must be a supported type within the size cap.
 *
 * @returns {Promise<{ mime: string, byteSize: number }>}
 * @throws httpError(400, message) when the object is missing, unreadable,
 *         unsupported, or oversized — the client can never attach a path it
 *         did not honestly upload through the server (§9).
 */
export async function verifyStoredObject(service, { bucket, path, allowedMimes, maxBytes, kindLabel }) {
  const { data: info, error: infoError } = await service.storage.from(bucket).info(path);
  if (infoError || !info) {
    throw httpError(400, `The uploaded ${kindLabel} could not be verified. Please upload it again.`);
  }
  const { data, error } = await service.storage.from(bucket).download(path);
  if (error || !data) {
    throw httpError(400, `The uploaded ${kindLabel} could not be verified. Please upload it again.`);
  }
  const bytes = await toBuffer(data);
  const mime = sniffMime(bytes);
  if (!mime || !allowedMimes.includes(mime)) {
    throw httpError(400, `The uploaded ${kindLabel} is not a supported type.`);
  }
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    throw httpError(400, `The uploaded ${kindLabel} is not within the allowed size.`);
  }
  return { mime, byteSize: bytes.byteLength };
}

/**
 * Downloads private object bytes (used by the verification face-match step to
 * re-read the stored identity document server-side — never via a public URL).
 */
export async function downloadFromStorage(service, { bucket, path }) {
  const { data, error } = await service.storage.from(bucket).download(path);
  if (error || !data) {
    // eslint-disable-next-line no-console
    console.error('[uploads] storage download failed:', error?.message ?? 'no object returned');
    throw httpError(502, 'Unable to read the stored document. Please try again.');
  }
  return toBuffer(data);
}