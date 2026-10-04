/**
 * EYE ASPECT RATIO (EAR) — real blink measurement from real eye landmarks.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The live face check previously decided "the user blinked" from the mean
 * luminance of a horizontal band of pixels across the upper part of the face box.
 * That signal cannot tell a blink apart from a shadow, a hand passing in front
 * of the light, a head tilt changing how much skin is in the band, or the user
 * simply leaning into a brighter part of the room. It is a *proxy* for eye state,
 * and the product requirement for this flow is explicit: a real eye-state
 * transition must be observed, and real eye landmarks / eye aspect ratio must be
 * used if the detector supports them. It does — `@mediapipe/tasks-vision`
 * `FaceLandmarker` returns a 478-point face mesh whose eye contours give the
 * vertical aperture of each eye directly.
 *
 * The measurement is the classic Soukupova & Cech Eye Aspect Ratio:
 *
 *     EAR = (|pB-pF| + |pC-pE|) / (2 * |pA-pD|)
 *
 * with pA/pD the two eye CORNERS (the denominator) and pB/pF, pC/pE the four lid
 * points (the numerator). EAR is ~0.25-0.35 for an open eye and collapses toward
 * ~0.02-0.08 when the lids meet. The denominator is the eye's own width, so the
 * number is scale-invariant: it is the same whether the camera is 640x480 or
 * 1280x720, and the same at 40 cm as at 2 m.
 *
 * It is DELIBERATELY the same formula and the same six-point convention the
 * backend already uses (`eyeAspectRatio()` in
 * `server/src/lib/faceVerification/engine.js`). The client prompt and the server
 * authority therefore measure one quantity the same way, rather than the client
 * guessing with a different heuristic from the one that will actually be judged.
 *
 * SECURITY BOUNDARY (AGENTS.md §2)
 * --------------------------------
 * This produces a client-side UX PROMPT only. It decides when the Submit button
 * becomes available; it never approves, rejects, or grants anything. The
 * authoritative liveness verdict is computed on the server from the uploaded
 * frames, and nothing written here reaches the database.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 1. LANDMARK INDICES — the MediaPipe FaceMesh eye contours
 * ------------------------------------------------------------------------ */

/**
 * The six points each eye is measured from, in the CORNER-FIRST order the EAR
 * formula expects: [cornerA, upperB, upperC, cornerD, lowerE, lowerF].
 *
 * Indices are from the 478-point MediaPipe face mesh. The four iris points
 * (468-477) are deliberately NOT used: they describe the pupil, not the lid
 * aperture, so including them would measure gaze direction rather than whether
 * the eye is shut.
 */
export const RIGHT_EYE_LANDMARKS: readonly [number, number, number, number, number, number] = [
  33, 160, 158, 133, 153, 144,
];
export const LEFT_EYE_LANDMARKS: readonly [number, number, number, number, number, number] = [
  362, 385, 387, 263, 373, 380,
];

/**
 * A landmark point: an `[x, y]` pair, or a MediaPipe `{ x, y }` object.
 *
 * BOTH shapes are real and both occur in this project, which is exactly why the
 * accessor below exists. MediaPipe's `NormalizedLandmark` is an OBJECT
 * (`{ x, y, z, visibility }`) — reading `point[0]` off one yields `undefined`.
 * The server's own provider (Human) returns ARRAYS. Accepting only one of the
 * two means the measurement silently reads `undefined` for every landmark of a
 * real face and returns "cannot measure" on every single frame.
 */
export type Point2D =
  | readonly [number, number]
  | readonly number[]
  | { readonly x: number; readonly y: number };

/**
 * Read a coordinate pair out of one landmark, or return `null`.
 *
 * ONE definition of "how do I get x and y off a point", shared by the EAR below
 * and the face-box geometry in `faceLandmarker.ts`, so the guide and the blink
 * cannot disagree about how a landmark is read.
 *
 * `null` means the point is not a usable finite coordinate pair — never 0, which
 * would be a fabricated position at the top-left of the frame.
 */
export function landmarkCoords(point: unknown): readonly [number, number] | null {
  if (Array.isArray(point)) {
    if (point.length < 2) return null;
    const [x, y] = point;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [x, y];
  }
  if (typeof point === 'object' && point !== null) {
    const candidate = point as { x?: unknown; y?: unknown };
    const { x, y } = candidate;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [x, y];
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. THE MEASUREMENT
 * ------------------------------------------------------------------------ */

/**
 * Compute the Eye Aspect Ratio of one eye from the mesh landmarks.
 *
 * @param landmarks the mesh point array, indexed by landmark index
 * @param indices   one of the six-point tuples above
 * @returns the EAR, or `null` when it cannot be measured honestly
 *
 * `null` is returned — never a guess, never 0, never 1 — when:
 *  - the mesh is missing or too short to contain the required indices,
 *  - any required landmark is absent or not a finite coordinate pair,
 *  - the eye corners coincide (`horizontal === 0`), which happens when the face
 *    is turned far enough that the mesh collapses.
 *
 * Returning `null` is load-bearing: a caller that substituted 0 here would
 * report a fully-closed eye, and a caller that substituted 1 would report a
 * fully-open one. Both fabrications would let the flow claim a state it cannot
 * see, so neither is available — the caller must handle "cannot measure".
 *
 * Landmarks are read through `landmarkCoords`, so both MediaPipe's
 * `{ x, y, z }` objects and plain `[x, y]` pairs work. That is not a
 * convenience: reading `point[0]` off a MediaPipe object yields `undefined`,
 * which made this function return `null` for a real face on every frame and left
 * the blink permanently unmeasurable.
 */
export function eyeAspectRatio(
  landmarks: readonly Point2D[] | null | undefined,
  indices: readonly [number, number, number, number, number, number],
): number | null {
  if (!Array.isArray(landmarks) || landmarks.length === 0) return null;
  const p = (k: number): readonly [number, number] | null => landmarkCoords(landmarks[k]);
  const pA = p(indices[0]);
  const pB = p(indices[1]);
  const pC = p(indices[2]);
  const pD = p(indices[3]);
  const pE = p(indices[4]);
  const pF = p(indices[5]);
  if (!pA || !pB || !pC || !pD || !pE || !pF) return null;

  const d = (q: readonly [number, number], r: readonly [number, number]): number =>
    Math.hypot(q[0] - r[0], q[1] - r[1]);
  const horizontal = d(pA, pD);
  // Degenerate geometry: both corners landed on the same pixel.
  if (!(horizontal > 0)) return null;
  const vertical = d(pB, pF) + d(pC, pE);
  const ear = vertical / (2 * horizontal);
  return Number.isFinite(ear) ? ear : null;
}

/**
 * Both eyes from one mesh, in one pass.
 *
 * Returns `null` when EITHER eye cannot be measured. A single-eye EAR is not
 * used on its own: a blink closes both eyes, so evidence from only one is not
 * evidence of a blink, and accepting it would let a mesh that only ever solved
 * one eye drive the liveness step.
 */
export function bothEyeAspectRatios(
  landmarks: readonly Point2D[] | null | undefined,
): { left: number; right: number } | null {
  const left = eyeAspectRatio(landmarks, LEFT_EYE_LANDMARKS);
  const right = eyeAspectRatio(landmarks, RIGHT_EYE_LANDMARKS);
  if (left === null || right === null) return null;
  return { left, right };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. ABSOLUTE EAR -> NORMALISED OPENNESS (0..1)
 * ------------------------------------------------------------------------ */

/**
 * What fraction of a person's OWN open-eye EAR is the measured EAR?
 *
 * A raw EAR cannot be thresholded with a single global constant, because a
 * person's baseline depends on eye shape, glasses, brow position, distance and
 * camera. Wide eyes read ~0.32 open; narrow eyes read ~0.22 for the same
 * expression. A fixed "closed below 0.15" would therefore never fire for one
 * user and would fire constantly for another.
 *
 * So the measurement is normalised against a rolling baseline of THIS person's
 * open eyes, and `closedFraction` is the fraction of that baseline at which the
 * lids count as fully met. 0.5 is used because a shut eye's EAR is 10-30% of its
 * open value: 0.5 sits clear of the open-state noise floor and is still crossed
 * comfortably by a real closure.
 *
 *     openness = (ear / openEar - closedFraction) / (1 - closedFraction)
 *
 * This maps a fully open eye to 1 and a fully closed one to 0, which is exactly
 * the 0..1 contract `EyeBlinkGate` (src/lib/liveFaceCheck.ts) expects, so the
 * existing OPEN/CLOSED hysteresis and its OPEN -> CLOSED -> OPEN requirement
 * are reused unchanged.
 */
export const CLOSED_FRACTION = 0.5;

/** How many samples must be seen before a baseline is trusted. */
export const BASELINE_MIN_SAMPLES = 6;
/** Window length for the rolling baseline percentile. ~1 s at 30 fps. */
export const BASELINE_WINDOW = 30;

/** Clamp helper, local so this module has no dependencies at all. */
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Tracks one person's open-eye EAR and reports normalised openness per frame.
 *
 * Baseline rule: the 90th percentile of a short rolling window. A plain maximum
 * would be inflated by a single noisy mesh frame and would then make every real
 * blink look partial for the rest of the session; a plain mean would be dragged
 * down by the blinks themselves. The 90th percentile ignores both failure modes.
 *
 * Honesty rules, all of which matter for the liveness step:
 *  - Before enough samples exist, openness is 1 (fully open). An unmeasured eye
 *    is never reported as closed, so an unestablished baseline can never
 *    manufacture a blink.
 *  - A frame that cannot be measured returns `null` and updates nothing. The
 *    caller skips it rather than inventing a value.
 *  - `reset()` clears everything, so a new attempt must re-earn the baseline and
 *    a previous attempt's eye shape cannot carry over.
 */
export class EyeOpennessTracker {
  private window: number[] = [];
  private baselineEar: number | null = null;

  constructor(
    private readonly closedFraction: number = CLOSED_FRACTION,
    private readonly minSamples: number = BASELINE_MIN_SAMPLES,
    private readonly windowSize: number = BASELINE_WINDOW,
  ) {}

  /** The person's current open-eye EAR, or null while still unestablished. */
  get openEar(): number | null {
    return this.baselineEar;
  }

  /** True once enough real samples have been seen to trust the baseline. */
  get baselineEstablished(): boolean {
    return this.baselineEar !== null;
  }

  /**
   * Feed one frame's EAR readings.
   * @returns openness in 0..1, or `null` when the frame could not be measured
   */
  push(ears: { left: number; right: number } | null): number | null {
    if (!ears) return null;
    const { left, right } = ears;
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    // Negative EAR is geometrically impossible; treat it as a bad measurement
    // rather than letting it pin openness to 0 forever.
    if (left <= 0 || right <= 0) return null;

    // A blink closes BOTH eyes, so the narrower (lower EAR) one governs. Taking
    // the mean would let one wide-open eye mask one shut eye.
    const ear = Math.min(left, right);

    this.window.push(ear);
    if (this.window.length > this.windowSize) this.window.shift();

    if (this.window.length < this.minSamples) {
      // Not enough evidence yet. Report fully open: the safe direction, because
      // an unestablished baseline must never be able to look like a closure.
      return 1;
    }

    const sorted = [...this.window].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
    this.baselineEar = sorted[idx];

    const baseline = this.baselineEar;
    if (!(baseline > 0)) return null;

    const openness = (ear / baseline - this.closedFraction) / (1 - this.closedFraction);
    return clamp01(openness);
  }

  /** A new attempt must re-earn its baseline. */
  reset(): void {
    this.window = [];
    this.baselineEar = null;
  }
}
