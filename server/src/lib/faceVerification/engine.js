/**
 * Face-verification ENGINE — real ML inference via @vladmandic/human
 * (TF.js, pure-CPU backend — no native bindings), running server-side.
 *
 * This module is deliberately internal: routes never touch it directly.
 * lib/faceVerification/index.js exposes the provider contract.
 *
 * Honesty guarantees (AGENTS.md §2.5/§2.6, spec §6/§19):
 *   - EVERY score comes from real model inference on the actual uploaded
 *     bytes: blazeface detection, 468-landmark face mesh, face-recognition
 *     embeddings, dedicated liveness + anti-spoof (PAD) neural models.
 *   - No result is ever fabricated, hardcoded or defaulted to "pass". If a
 *     model cannot run the step FAILS (provider error → honest 502/503).
 *   - Quality metrics (sharpness/darkness/size/occlusion) are computed with
 *     real tensor math on the face crop — Laplacian variance for blur,
 *     mean-luma for exposure, box geometry for size/occlusion (§8).
 *
 * Privacy (spec §11): only the final aggregate verdict + similarity score are
 * returned to the caller. Tensors and decoded frames are disposed as soon as
 * each analysis finishes; raw frames never leave this module except through
 * the comparison step (in-memory only, inside the FrameCache).
 */
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { sniffMime } from '../uploads.js';

// ── Model weights + WASM/CPU kernel sources are LOCAL (bundled) ─────────────
// The package's exports map omits the "./" prefix on its subpath keys, which
// Node's ESM resolver rejects — so we resolve the dist file by path. The
// human package is a hard dependency (server/package.json), so this path is
// stable; a helper keeps the string discoverable.
const HUMAN_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
  'node_modules', '@vladmandic', 'human', 'dist', 'human.node-wasm.js',
);
const HUMAN_MODELS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
  'node_modules', '@vladmandic', 'human', 'models',
);

// ── Inference tuning (env overrides come from lib/faceVerification/index.js) ─
export const DETECT_MAX_DIM = 640; // downscale input before detection

let fetchPatched = false;

/**
 * TF.js loads graph models / WASM kernels through `fetch`. Node's native
 * fetch (undici) cannot read `file://` URLs — install a single global
 * shim that serves file:// URLs from disk and passes everything else on,
 * untouched. Installed once per process.
 */
async function ensureFetchShim() {
  if (fetchPatched || typeof globalThis.fetch !== 'function') return;
  fetchPatched = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url && url.startsWith('file://')) {
      try {
        const buf = await fs.readFile(fileURLToPath(url));
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      } catch (e) {
        return new Response(String(e && e.message), { status: 404 });
      }
    }
    return realFetch(input, init);
  };
}

let enginePromise = null;
let engineBaseConfig = null;

/**
 * Build a per-call config from the canonical (snapshotted) engine config by
 * deep-merging only the provided groups. Human's detect() otherwise MERGES
 * its userConfig into the shared instance permanently — after one call with
 * `face.description.enabled=false`, every later detection would silently skip
 * the embedding model. Scoping the override and restoring the canonical
 * config keeps each call independent.
 */
function applyPerCallConfig(base, extra) {
  const out = { ...base };
  for (const key of Object.keys(base)) {
    if (
      extra[key] &&
      typeof extra[key] === 'object' &&
      !Array.isArray(extra[key]) &&
      base[key] &&
      typeof base[key] === 'object'
    ) {
      out[key] = { ...base[key], ...extra[key] };
    }
  }
  return out;
}

/**
 * Lazy singleton Human engine. Loading models takes a few hundred ms; the
 * first detection warms the TF graph. All subsequent calls reuse it.
 */
export async function getEngine(overrides = {}) {
  if (!enginePromise) {
    enginePromise = (async () => {
      await ensureFetchShim();
      const { Human } = await import(pathToFileURL(HUMAN_DIST).href);
      const human = new Human({
        backend: 'cpu',
        modelBasePath: pathToFileURL(HUMAN_MODELS).href,
        debug: false,
        async: false,
        cacheModels: false,
        validateModels: false,
        // Conservative defaults; per-call overrides are merged on each detect.
        face: {
          enabled: true,
          detector: { enabled: true, maxDetected: 10, minConfidence: 0.3, rotation: false },
          mesh: { enabled: true, keepInvalid: true },
          iris: { enabled: false },
          emotion: { enabled: false },
          antispoof: { enabled: true },
          liveness: { enabled: true },
          description: { enabled: true },
        },
        ...overrides,
      });
      await human.load();
      // Snapshot the NORMALIZED config so per-call overrides can be scoped to
      // a single detection (see applyPerCallConfig).
      engineBaseConfig = JSON.parse(JSON.stringify(human.config));
      return human;
    })();
    // NEVER cache a failed load: a single transient failure (memory pressure,
    // model-file read race, WASM init) must not wedge every later KYC request
    // into a permanent honest 503. On rejection the cached promise is cleared
    // and the next call retries the load (§2.6 — honest, but recoverable).
    enginePromise.catch((cause) => {
      enginePromise = null;
      // eslint-disable-next-line no-console
      console.error('[faceVerification] engine load failed — will retry on next request:', cause && cause.message ? cause.message : cause);
    });
  }
  return enginePromise;
}

/**
 * Decode JPEG/PNG bytes → a float32 [h,w,3] tensor, downscaled so detection
 * stays fast and accurate. Returns the tensor (caller must dispose).
 */
export function decodeImageTensor(bytes, mime) {
  const sniffed = sniffMime(bytes);
  const type = mime && sniffed ? sniffed : sniffed || null;
  if (type !== 'image/jpeg' && type !== 'image/png') return null;

  let data;
  let width;
  let height;
  if (type === 'image/png') {
    const png = PNG.sync.read(bytes);
    data = png.data;
    width = png.width;
    height = png.height;
  } else {
    const img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512 });
    data = img.data;
    width = img.width;
    height = img.height;
  }

  const scale = Math.min(1, DETECT_MAX_DIM / Math.max(width, height));
  let t = tf.tensor(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    [height, width, 4],
    'int32',
  );
  t = tf.cast(t, 'float32');
  if (scale < 1) {
    const h = Math.max(1, Math.round(height * scale));
    const w = Math.max(1, Math.round(width * scale));
    t = tf.image.resizeBilinear(t.expandDims(0), [h, w]).squeeze(0);
  }
  const channels = tf.slice3d(t, [0, 0, 0], [-1, -1, 3]);
  t.dispose();
  return { tensor: channels, width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Run the full Human pipeline on a decoded tensor. Returns the raw Human
 * result; the tensor is disposed here. Per-call config (e.g. mesh off for
 * fast ID scans) can be passed to skip expensive models. The override is
 * scoped to THIS invocation — the engine's canonical config is restored
 * afterwards (Human otherwise leaks per-call overrides on the singleton).
 */
export async function runDetection(tensor, extraConfig = {}) {
  const human = await getEngine();
  const canonical = engineBaseConfig ?? human.config;
  human.config = applyPerCallConfig(canonical, extraConfig);
  try {
    return await human.detect(tensor);
  } finally {
    human.config = canonical;
    tensor.dispose();
  }
}

/**
 * Laplacian-variance sharpness of a grayscale crop [h,w,ch] float32 tensor.
 * Higher = sharper. Uses a real 3×3 Laplacian convolution (spec §8 — blur
 * rejection is a measurement, not a guess).
 */
export async function laplacianVariance(tensor) {
  const gray = tf.mean(tensor, 2).expandDims(2); // [h,w,1]
  // 3×3 Laplacian kernel. tensor4d requires a flat TypedArray or a 4-level
  // nested array; a 3-level array throws "tensor4d() requires values to be
  // number[][][][] or flat/TypedArray" — which previously turned every real
  // document scan (any image with a detected face) into an honest-but-wrong
  // 503. Flat array avoids the nested-array pitfall entirely.
  const kernel = tf.tensor4d(new Float32Array([0, 1, 0, 1, -4, 1, 0, 1, 0]), [3, 3, 1, 1]);
  const lap = tf.conv2d(gray, kernel, 1, 'same');
  const out = await lap.squaredDifference(lap.mean()).mean().data();
  gray.dispose();
  kernel.dispose();
  lap.dispose();
  return out[0] ?? 0;
}

/** Mean luma (0..255) of a crop — darkness/exposure measurement (§8). */
export async function meanLuma(tensor) {
  const gray = tf.mean(tensor, 2);
  const out = await gray.mean().data();
  gray.dispose();
  return out[0] ?? 0;
}

/**
 * Crop the face box (with padding) from the decoded tensor so quality metrics
 * measure the FACE, not the background. Negative coords clamp to the image.
 */
export function cropFace(tensor, box, width, height, padPx = 8) {
  const [x, y, w, h] = box.map((v) => Math.round(v));
  const x0 = Math.max(0, x - padPx);
  const y0 = Math.max(0, y - padPx);
  const x1 = Math.min(width, x + w + padPx);
  const y1 = Math.min(height, y + h + padPx);
  if (x1 <= x0 || y1 <= y0) return null;
  return tf.slice3d(tensor, [y0, x0, 0], [y1 - y0, x1 - x0, 3]);
}

/**
 * Per-frame geometry checks from a Human face result + image dims (§7/§8):
 *   - exactly one intended face is enforced by the CALLER (multi-face → fail);
 *   - a face cut off by the frame edge counts as obstructed;
 *   - a face whose box is too small relative to the frame counts as too small;
 *   - darkness is measured from the crop; blur from Laplacian variance.
 */
export async function measureFaceQuality(face, tensor, width, height, thresholds = {}) {
  const [bx, by, bw, bh] = face.box;
  const areaFraction = (bw * bh) / (width * height);
  const checks = {
    cutOff: bx < 1 || by < 1 || bx + bw > width - 1 || by + bh > height - 1,
    tooSmall: areaFraction < (thresholds.minAreaFraction ?? 0.02),
    tooDark: false,
    blurred: false,
  };
  const crop = cropFace(tensor, face.box, width, height);
  if (crop) {
    const [dark, blur] = await Promise.all([
      meanLuma(crop),
      laplacianVariance(crop),
    ]);
    crop.dispose();
    checks.tooDark = dark < (thresholds.minLuma ?? 35); // very dark face patch
    checks.blurred = blur < (thresholds.minSharpness ?? 6); // Laplacian variance
    checks.luma = dark;
    checks.sharpness = blur;
  } else {
    checks.tooDark = true;
    checks.blurred = true;
  }
  checks.areaFraction = areaFraction;
  return checks;
}

/**
 * EAR (Eye Aspect Ratio) from face-mesh eye annotations — the classic
 * blink measurement. Human reports eye landmarks in raw pixel coords
 * (annotations are [x,y] arrays aligned with meshRaw * dims when present).
 */
export function eyeAspectRatio(annotations, keyA, keyB, keyC, keyD, keyE, keyF) {
  const pts = (k) => annotations[k];
  const pA = pts(keyA);
  const pB = pts(keyB);
  const pC = pts(keyC);
  const pD = pts(keyD);
  const pE = pts(keyE);
  const pF = pts(keyF);
  if (!pA || !pB || !pC || !pD || !pE || !pF) return null;
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const vertical = d(pB, pF) + d(pC, pE);
  const horizontal = d(pA, pD);
  if (horizontal === 0) return null;
  return vertical / (2 * horizontal);
}

/** Detect gesture tokens produced by Human for a face id (facing/blink/mouth). */
export function faceGestures(result, faceId) {
  if (!Array.isArray(result.gesture)) return [];
  return result.gesture
    .filter((g) => g.face === faceId && typeof g.gesture === 'string')
    .map((g) => g.gesture);
}