/**
 * Real-time capture-quality heuristics for the KYC camera flows.
 *
 * PURPOSE & BOUNDARY (AGENTS.md §2 / §3):
 *  - These are USER-EXPERIENCE-ONLY guides — they draw the green/red frame and
 *    pick hint copy while the user captures their ID document or face pose.
 *  - The backend remains the ONLY authority: verdicts, scores and matches are
 *    computed server-side from the uploaded frames. Nothing here bypasses,
 *    mimics or "pre-confirms" a backend decision.
 *  - No client-side persistence, no AI mocks: every metric is computed from
 *    the real pixels of the live camera frame.
 *
 * Metrics (standard computer-vision, all cheap enough for ~6-7 fps):
 *  - sharpness  → variance of the 3×3 Laplacian (focus + motion blur).
 *  - edgeDensity→ fraction of pixels with a strong Sobel gradient (text/photo
 *                edges of an ID card vs. an empty background).
 *  - luma       → mean Y (0..255) for exposure detection.
 *  - skinRatio  → YCrCb skin-tone fraction of the face window (face presence).
 *
 * BLINK MEASUREMENT IS NOT IN THIS FILE
 * -------------------------------------
 * There used to be a `BlinkDetector` here that read the mean luminance of a
 * horizontal band across the upper face and called a rise-then-return a blink.
 * That was a proxy for eye state: a shadow crossing the light, a hand passing in
 * front of it, or a head tilt changing how much skin sits in the band could all
 * produce the same signal, so "Blink detected ✓" was a claim the system had not
 * actually observed.
 *
 * The blink is now measured from real eye landmarks — the MediaPipe
 * FaceLandmarker mesh reduced to a per-eye Eye Aspect Ratio, in
 * `eyeAspectRatio.ts` and `faceLandmarker.ts`. Those modules were left out of
 * this file on purpose: this one is about frame QUALITY (is this capture
 * usable?), while EAR is a GEOMETRIC measurement of the eyelids, and conflating
 * them is what let a brightness heuristic stand in for a liveness check in the
 * first place.
 *
 * Thresholds below were chosen conservatively (fail toward RED = "keep trying")
 * so a user only captures when the frame looks genuinely usable.
 */

export interface FramePixels {
  /** RGBA bytes (length = width * height * 4). */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// ── document capture ─────────────────────────────────────────────────────────

export type DocVerdict = 'dark' | 'bright' | 'blurry' | 'empty' | 'partial' | 'ready';

export interface DocQuality {
  verdict: DocVerdict;
  sharpness: number;
  edgeDensity: number;
  luma: number;
  good: boolean;
  hint: string;
}

export const DOC_LUMA_DARK_MAX = 50;
export const DOC_LUMA_BRIGHT_MIN = 235;
export const DOC_SHARPNESS_MIN = 350; // in-focus cards score 5k+; blur ~170-900
export const DOC_EDGE_MIN = 0.02; // nothing reliably above this on a blank wall
export const DOC_EDGE_PARTIAL = 0.04; // below = card too small / off-centre
export const DOC_EDGE_NOISY = 0.5; // cluttered background → only frame the card

export const IDLE_DOC_QUALITY: DocQuality = {
  verdict: 'empty',
  sharpness: 0,
  edgeDensity: 0,
  luma: 0,
  good: false,
  hint: 'Position your ID inside the frame…',
};

/** Mean luma of the window (grayscale approximation). */
export function meanLuma(frame: FramePixels): number {
  const { data } = frame;
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / (data.length / 4);
}

/** Variance of the 3×3 Laplacian — a standard focus/sharpness measure. */
export function laplacianVariance(frame: FramePixels): number {
  const { data, width, height } = frame;
  const w = width;
  const h = height;
  if (w < 3 || h < 3) return 0;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      gray[y * w + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
  }
  const lap = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      lap[i] =
        gray[i - w] +
        gray[i + w] +
        gray[i - 1] +
        gray[i + 1] -
        4 * gray[i];
    }
  }
  let sum = 0;
  let n = 0;
  for (let i = 0; i < lap.length; i += 1) {
    sum += lap[i] * lap[i];
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

/** Fraction of pixels with a strong Sobel gradient (edges/texture). */
export function edgeDensity(frame: FramePixels): number {
  const { data, width, height } = frame;
  const w = width;
  const h = height;
  if (w < 3 || h < 3) return 0;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      gray[y * w + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
  }
  let edges = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const gx =
        -gray[(y - 1) * w + x - 1] + gray[(y - 1) * w + x + 1] -
        2 * gray[y * w + x - 1] + 2 * gray[y * w + x + 1] -
        gray[(y + 1) * w + x - 1] + gray[(y + 1) * w + x + 1];
      const gy =
        -gray[(y - 1) * w + x - 1] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + x + 1] +
        gray[(y + 1) * w + x - 1] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + x + 1];
      if (Math.sqrt(gx * gx + gy * gy) > 38) edges += 1; // ≈ 15% of full range
    }
  }
  return edges / ((w - 2) * (h - 2));
}

/**
 * Full document-window verdict + human hint (UX only).
 *
 * @param faceGuard When TRUE (auto-capture armed), a window that is mostly
 *   skin tones is never judged "ready" — a face can fill the frame but an ID
 *   card never does, so this stops auto-capture from snapping a selfie. For
 *   MANUAL capture pass FALSE: the user decides when to press Capture, and the
 *   backend still validates the photo, so a face in the frame is their choice.
 */
export function analyzeDocument(frame: FramePixels, faceGuard = true): DocQuality {
  const luma = meanLuma(frame);
  const sharpness = laplacianVariance(frame);
  const density = edgeDensity(frame);
  const base = { sharpness, edgeDensity: density, luma };

  let verdict: DocVerdict = 'ready';
  let good = true;
  let hint = 'Ready — hold steady…';

  if (luma < DOC_LUMA_DARK_MAX) {
    verdict = 'dark';
    good = false;
    hint = 'Too dark — find better lighting';
  } else if (luma > DOC_LUMA_BRIGHT_MIN) {
    verdict = 'bright';
    good = false;
    hint = 'Too bright — avoid glare on the card';
  } else if (sharpness < DOC_SHARPNESS_MIN) {
    verdict = 'blurry';
    good = false;
    hint = 'Blurry — hold the camera completely still';
  } else if (density < DOC_EDGE_MIN) {
    verdict = 'empty';
    good = false;
    hint = 'No ID detected — move the card into the frame';
  } else if (density < DOC_EDGE_PARTIAL) {
    verdict = 'partial';
    good = false;
    hint = 'Move closer so the ID fills the frame';
  } else if (density > DOC_EDGE_NOISY) {
    verdict = 'partial';
    good = false;
    hint = 'Too much background — frame only the ID card';
  }
  // Auto-capture safety only (see docstring above).
  if (faceGuard && verdict === 'ready' && skinRatio(frame) > 0.25) {
    verdict = 'partial';
    good = false;
    hint = 'This looks like a face — hold only the ID card inside the frame';
  }

  return { verdict, ...base, good, hint };
}

// ── face capture ─────────────────────────────────────────────────────────────

export type FaceVerdict = 'dark' | 'bright' | 'blurry' | 'empty' | 'face';

export interface FaceQuality {
  verdict: FaceVerdict;
  sharpness: number;
  luma: number;
  skinRatio: number;
  good: boolean;
  hint: string;
}

export const FACE_LUMA_DARK_MAX = 45;
export const FACE_LUMA_BRIGHT_MIN = 235;
export const FACE_SHARPNESS_MIN = 150; // faces are smooth → lower than documents
export const FACE_SKIN_MIN = 0.09; // a centred face fills far more than this

export const IDLE_FACE_QUALITY: FaceQuality = {
  verdict: 'empty',
  sharpness: 0,
  luma: 0,
  skinRatio: 0,
  good: false,
  hint: 'Keep your face inside the oval',
};

/** Fraction of pixels inside the standard YCrCb skin-tone range. */
export function skinRatio(frame: FramePixels): number {
  const { data } = frame;
  const n = data.length / 4;
  if (n === 0) return 0;
  let skin = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (y > 80 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 179) skin += 1;
  }
  return skin / n;
}

/** Face-window verdict + hint (UX only). */
export function analyzeFace(frame: FramePixels): FaceQuality {
  const luma = meanLuma(frame);
  const sharpness = laplacianVariance(frame);
  const ratio = skinRatio(frame);
  const base = { sharpness, luma, skinRatio: ratio };

  let verdict: FaceVerdict = 'face';
  let good = true;
  let hint = 'Face in frame ✓';

  if (luma < FACE_LUMA_DARK_MAX) {
    verdict = 'dark';
    good = false;
    hint = 'Too dark — face the light';
  } else if (luma > FACE_LUMA_BRIGHT_MIN) {
    verdict = 'bright';
    good = false;
    hint = 'Too bright — avoid glare';
  } else if (sharpness < FACE_SHARPNESS_MIN) {
    verdict = 'blurry';
    good = false;
    hint = 'Blurry — hold still';
  } else if (ratio < FACE_SKIN_MIN) {
    verdict = 'empty';
    good = false;
    hint = 'Keep your face inside the oval';
  }

  return { verdict, ...base, good, hint };
}
