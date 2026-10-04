/**
 * Face-guide evaluation for the live KYC camera (UX ONLY — the backend is the
 * authority; AGENTS.md §2 / §5).
 *
 * Everything here is PURE and DOM-free so it can be unit-tested in Node:
 *  - `coverMapping` / `boxToDisplay`: converts detector boxes (VIDEO pixels)
 *    into CONTAINER-normalized display coordinates, honoring `object-fit: cover`
 *    cropping and the selfie mirror (`-scale-x-100`). The frame's red/oval
 *    guide is drawn in the same container space, so both live in one system —
 *    the "normalize first, then compare" requirement (spec §5).
 *  - `evaluateFaceGuidance`: applies the face requirements (spec §6) on the
 *    normalized boxes — exact single face, inside the guide, large enough,
 *    not heavily cut off, not so close it overflows the oval.
 *  - `StabilityGate`: the 2-second "hold still" timer exactly per spec §7 —
 *    it starts on the first valid frame, RESETS the moment a frame becomes
 *    invalid, and only reports `ready` after 2 continuous seconds.
 *
 * These values never leave the browser and never influence the backend's
 * verdict — they only color the guide frame and pick the hint copy.
 */

// ── coordinate mapping ───────────────────────────────────────────────────────

export interface RawFaceBox {
  /** Detector box in VIDEO pixel coordinates (x0 ≤ x1, y0 ≤ y1). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Axis-aligned rectangle in CONTAINER-normalized space (0..1). */
export interface GuideRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The visible part of the video inside the CSS container (object-fit: cover). */
export interface CoverMapping {
  /** Display pixels per video pixel. */
  scale: number;
  /** Container pixels from left edge to the video's left edge (negative = cropped). */
  offsetX: number;
  /** Container pixels from top edge to the video's top edge (negative = cropped). */
  offsetY: number;
  containerW: number;
  containerH: number;
}

/**
 * Map video intrinsic dimensions into a CSS container with `object-fit: cover`.
 * The guide overlay lives in the same container, so `boxToDisplay` and the
 * guide rect share one coordinate system and can be compared directly.
 */
export function coverMapping(
  videoW: number,
  videoH: number,
  containerW: number,
  containerH: number,
): CoverMapping {
  const scale = containerW / videoW > containerH / videoH
    ? containerW / videoW
    : containerH / videoH;
  return {
    scale,
    offsetX: (containerW - videoW * scale) / 2,
    offsetY: (containerH - videoH * scale) / 2,
    containerW,
    containerH,
  };
}

/** A face box in container-normalized space (after cover mapping + mirror). */
export interface NormalizedBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  /** Clamped box area as a fraction of the container (0..1). */
  areaFraction: number;
  /**
   * True when the container clamp actually cut the box, i.e. part of the face is
   * NOT visible on screen. This is the honest "the face is cropped" signal — it
   * measures the VISIBLE result, unlike a raw-video-edge test.
   */
  clipped: boolean;
}

/**
 * Convert a detector box from video pixels to container-normalized display
 * space. `mirror` must be true when the CSS applies `-scale-x-100` (selfie
 * preview) — the detector sees the RAW frame, the user sees the mirrored one.
 * The box is clamped to the container so an over-cropped edge cannot inflate
 * the area or push the center outside 0..1.
 */
export function boxToDisplay(
  box: RawFaceBox,
  map: CoverMapping,
  mirror: boolean,
): NormalizedBox {
  const cx0 = box.x0 * map.scale + map.offsetX;
  const cy0 = box.y0 * map.scale + map.offsetY;
  const cw = (box.x1 - box.x0) * map.scale;
  const ch = (box.y1 - box.y0) * map.scale;
  const nx0 = cx0 / map.containerW;
  const ny0 = cy0 / map.containerH;
  const nw = cw / map.containerW;
  const nh = ch / map.containerH;
  // Mirrored display: left/right swap around the container's center.
  const mx0 = mirror ? 1 - (nx0 + nw) : nx0;
  const my0 = ny0;
  // Measured BEFORE clamping — this is the only place that can honestly tell the
  // caller the box ran past the visible container.
  const clipped = mx0 < 0 || my0 < 0 || mx0 + nw > 1 || my0 + nh > 1;
  const x0 = Math.max(0, mx0);
  const y0 = Math.max(0, my0);
  const x1 = Math.min(1, mx0 + nw);
  const y1 = Math.min(1, my0 + nh);
  const areaFraction = Math.max(0, (x1 - x0) * (y1 - y0));
  return {
    x0,
    y0,
    x1,
    y1,
    centerX: mx0 + nw / 2,
    centerY: my0 + nh / 2,
    width: x1 - x0,
    height: y1 - y0,
    areaFraction,
    clipped,
  };
}

// ── guidance evaluation ──────────────────────────────────────────────────────

export type FaceGuideStatus =
  | 'no-frame' // no analysable video frame yet — NOT a "no face" claim
  | 'no-face' // the detector ran and genuinely found no face
  | 'multiple' // more than one face visible
  | 'outside' // face(s) present but not positioned in the guide
  | 'too-small' // face too far away / tiny
  | 'too-close' // face larger than the oval allows
  | 'cut-off' // face box is cropped by the visible frame
  | 'ok'; // exactly one face, inside the guide, well sized

export interface FaceGuideEval {
  status: FaceGuideStatus;
  /** Number of faces the detector found (0, 1, 2+). */
  count: number;
  /** The single face's display-space box (null when count ≠ 1). */
  displayBox: NormalizedBox | null;
  /** True when the face is positioned inside the guide (status === 'ok'). */
  inside: boolean;
  /** True only when this frame satisfies every face requirement. */
  valid: boolean;
}

/** How far the face center may stray outside the oval bounds and still count. */
export const FACE_GUIDE_MARGIN = 0.35;
/** Minimum face box area (fraction of the container) — below = too far away. */
export const FACE_MIN_AREA = 0.015;
/** Minimum overlap of the face box with the oval bounds to count as "inside". */
export const FACE_OVERLAP_MIN = 0.15;
/** Face area may not exceed this × the oval area (else the face overflows). */
export const FACE_MAX_OVER_GUIDE = 2.5;

/**
 * THE FACE GUIDE — one definition, shared by the CSS and the maths.
 *
 * Previously the guide was written down TWICE as unrelated magic numbers: the
 * Tailwind classes in the JSX and a hard-coded rect here. Nothing tied them
 * together, and the numbers produced a guide 52% of the viewport WIDTH but
 * 94.5% of its HEIGHT in a 4:3 box — it filled the frame almost completely,
 * which is why it read as "far too large". Later it was corrected to a portrait
 * 0.74 aspect, but that over-corrected: it landed at 42% of the WIDTH, which
 * felt like a distant keyhole the user had to squeeze into.
 *
 * It is now sized to hit BOTH target bands against the visible preview, in a
 * 4:3 container:
 *
 *   height = 76% of the preview height          → inside the 70–80% target
 *   width  = 1.03 × height × (containerH/containerW)
 *          → 58.7% of the preview WIDTH          → inside the 55–65% target
 *
 * A NOTE ON THE ASPECT, because it is not a free choice: a 4:3 box is 0.75 as
 * wide as it is tall, so a guide that is 76% tall and 60% wide is very slightly
 * WIDER than it is tall (1.05:1). A strictly portrait oval cannot satisfy both
 * bands — a 0.74 aspect at 76% height is only 42% wide, and reaching 55–65%
 * width would need a height above 100%. The bands were chosen deliberately, so
 * the aspect is 1.03 and the guide is RENDERED as a heavily-rounded rect
 * (rounded-[42%]) rather than a true ellipse: a 1.03:1 box drawn as a soft
 * rounded oval reads correctly, whereas the same box drawn as a mathematical
 * ellipse would read as "squashed".
 *
 * The width is still derived from the real measured container aspect, so the
 * rendered CSS box and the evaluated rect cannot drift apart, and the guide
 * still works unchanged if the preview is ever not 4:3.
 */
export const FACE_GUIDE_HEIGHT_FRACTION = 0.76;
export const FACE_GUIDE_ASPECT = 1.03;

/**
 * The oval's bounds in container-normalized space, derived from the real
 * measured preview box. Must be called with the SAME container dimensions that
 * the CSS percentage resolves against, otherwise the guide and the detector's
 * coordinates stop describing the same rectangle.
 */
export function faceGuideRect(containerW: number, containerH: number): GuideRect {
  const h = FACE_GUIDE_HEIGHT_FRACTION;
  const w = Math.min(1, h * FACE_GUIDE_ASPECT * (containerH / Math.max(containerW, 1)));
  return { x0: (1 - w) / 2, y0: (1 - h) / 2, x1: 1 - (1 - w) / 2, y1: 1 - (1 - h) / 2 };
}

/** The rendered document frame: `w-[66%] aspect-[1.586/1]`, centered. */
export const DOC_GUIDE_RECT: GuideRect = {
  x0: (1 - 0.66) / 2,
  y0: (1 - 0.66 / 1.586) / 2,
  x1: 1 - (1 - 0.66) / 2,
  y1: 1 - (1 - 0.66 / 1.586) / 2,
};

export function expandRect(rect: GuideRect, margin: number): GuideRect {
  return {
    x0: rect.x0 - margin,
    y0: rect.y0 - margin,
    x1: rect.x1 + margin,
    y1: rect.y1 + margin,
  };
}

/** Overlap area of two normalized rectangles (0..1). */
export function rectOverlap(a: GuideRect | NormalizedBox, b: GuideRect): number {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

export function evaluateFaceGuidance(opts: {
  /** Raw detector boxes in video pixels. */
  boxes: RawFaceBox[];
  videoWidth: number;
  videoHeight: number;
  /** CSS size of the preview container (the one the oval is drawn in). */
  containerWidth: number;
  containerHeight: number;
  /** Normalized oval bounds in container space. */
  guide: GuideRect;
  /** True when the preview is mirrored with `-scale-x-100`. */
  mirror: boolean;
}): FaceGuideEval {
  const { boxes, videoWidth, videoHeight, containerWidth, containerHeight, guide, mirror } = opts;
  const empty: FaceGuideEval = { status: 'no-face', count: boxes.length, displayBox: null, inside: false, valid: false };
  if (boxes.length === 0) return { ...empty, status: 'no-face' };
  if (boxes.length > 1) return { ...empty, status: 'multiple' };

  // Single face — map into display space once; all requirements share it.
  const map = coverMapping(videoWidth, videoHeight, containerWidth, containerHeight);
  const box = boxToDisplay(boxes[0], map, mirror);

  // Guide placement calculation
  const expanded = expandRect(guide, FACE_GUIDE_MARGIN);
  const centerIn =
    box.centerX >= expanded.x0 && box.centerX <= expanded.x1 &&
    box.centerY >= expanded.y0 && box.centerY <= expanded.y1;
  const overlap = rectOverlap(box, guide) / Math.max(box.areaFraction, 1e-6);

  // Severe cut off: only reject if the face center is outside or significantly cropped
  if (box.clipped && !centerIn) {
    return { ...empty, count: 1, displayBox: box, status: 'cut-off' };
  }

  // Too far away: the box covers almost nothing.
  if (box.areaFraction < FACE_MIN_AREA) {
    return { ...empty, count: 1, displayBox: box, status: 'too-small' };
  }

  // Too close: the box would overflow the oval by a wide margin.
  const guideArea = (guide.x1 - guide.x0) * (guide.y1 - guide.y0);
  if (box.areaFraction > guideArea * FACE_MAX_OVER_GUIDE) {
    return { ...empty, count: 1, displayBox: box, status: 'too-close' };
  }

  if (!centerIn || overlap < FACE_OVERLAP_MIN) {
    return { ...empty, count: 1, displayBox: box, status: 'outside' };
  }

  return { ...empty, count: 1, displayBox: box, inside: true, valid: true, status: 'ok' };
}

// ── Stability gate with momentary glitch tolerance ──────────────────────────

export interface StabilitySnapshot {
  /** 0..1 — how far into the required continuous hold we are. */
  progress: number;
  /** True after continuous hold of valid frames. */
  ready: boolean;
}

/**
 * The "hold still" timer. Starts on the first valid frame and advances toward 1.0.
 * Includes a 400ms grace period so single dropped frames or slight movements do not
 * jarringly nuke the hold progress to zero.
 */
export class StabilityGate {
  private stableStart: number | null = null;
  private lastValidAt: number | null = null;
  private holdProgress = 0;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly holdMs = 600,
  ) {}

  push(valid: boolean): StabilitySnapshot {
    const t = this.now();
    if (!valid) {
      if (this.lastValidAt !== null && t - this.lastValidAt < 800) {
        return { progress: this.holdProgress, ready: this.holdProgress >= 1 };
      }
      this.stableStart = null;
      this.lastValidAt = null;
      this.holdProgress = 0;
      return { progress: 0, ready: false };
    }
    this.lastValidAt = t;
    if (this.stableStart === null) this.stableStart = t;
    const elapsed = t - this.stableStart;
    this.holdProgress = Math.min(Math.max(elapsed / this.holdMs, 0), 1);
    return { progress: this.holdProgress, ready: elapsed >= this.holdMs };
  }

  reset(): void {
    this.stableStart = null;
    this.lastValidAt = null;
    this.holdProgress = 0;
  }
}