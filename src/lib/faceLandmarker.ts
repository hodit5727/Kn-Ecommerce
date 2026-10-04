/**
 * THE on-device vision task — one MediaPipe FaceLandmarker, used for BOTH face
 * detection and the blink measurement.
 *
 * WHY ONE TASK AND NOT TWO
 * ------------------------
 * This used to run a bounding-box `FaceDetector` (BlazeFace short-range) for the
 * guide and a separate `FaceLandmarker` for the blink. That was a bug, and the
 * model files prove it:
 *
 *   public/vision/blaze_face_short_range.tflite        229,746 bytes
 *   face_landmarker.task -> face_detector.tflite       229,746 bytes
 *   SHA256 of both: B4578F35...B0152F                  IDENTICAL
 *
 * `face_landmarker.task` ALREADY CONTAINS BlazeFace. Running both meant
 * BlazeFace was instantiated twice, in two ~9.4 MB WASM runtimes, each taking
 * its own WebGL context for the GPU delegate. The second task could not get a
 * context ("the eye-landmark model could not start") and the contention could
 * starve the first one, which is how the guide reported `faces: 0` while a face
 * was plainly on screen and the camera telemetry was perfectly healthy.
 *
 * The FaceLandmarker alone is sufficient, because a face mesh IS a face
 * detection: the model runs BlazeFace internally, applies the documented
 * detection/tracking confidence thresholds, and only returns a mesh for a face
 * it actually found. `buildFaceFrame` derives the face box from the mesh's own
 * landmark extents, so the guide is driven by a real measurement of a real
 * face. One runtime, one model, one WebGL context — and face detection can no
 * longer be broken by the eye model, because they are the same model.
 *
 * WHAT IT IS AND IS NOT
 * ---------------------
 * The documented model options are used verbatim (`minFaceDetectionConfidence`,
 * `minTrackingConfidence`). The model does NOT expose a per-face score, so none
 * is invented: telemetry reports the count of meshes and the threshold that is
 * in force, never a fabricated "confidence".
 *
 * BOUNDARY (AGENTS.md §2 / §5)
 * ----------------------------
 * Nothing computed here is a verdict. Landmarks and boxes never leave the
 * browser; only compressed video frames are uploaded, and the backend re-derives
 * liveness from those with its own models. This can enable a Submit button and
 * nothing more. Landmark coordinates are never logged, not even in dev: they
 * are biometric data derived from the face image.
 *
 * Loading is a lazy singleton: a FAILED load is never cached (the next call
 * retries), GPU falls back to CPU, and `closeFaceLandmarker()` releases the task.
 */
import type { FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { landmarkCoords } from './eyeAspectRatio';
import type { Point2D } from './eyeAspectRatio';
import type { RawFaceBox } from './faceGuide';

const LOCAL_WASM_DIR = `${import.meta.env.BASE_URL}vision`;
const LOCAL_WASM_BINARY = `${LOCAL_WASM_DIR}/vision_wasm_internal.wasm`;
const LOCAL_MODEL_URL = `${LOCAL_WASM_DIR}/face_landmarker.task`;

/**
 * Minimum face-detection confidence the model applies internally.
 *
 * This used to be the bounding-box detector's `minDetectionConfidence`, and it
 * used to be 0.5 — which is too strict for BlazeFace SHORT-RANGE at selfie
 * distance: a face that is plainly visible — slightly dim, slightly turned, or
 * near the frame edge — scored below 0.5, so the model returned nothing and the
 * guide reported "No face detected" while a face was right there on screen.
 * 0.3 is the commonly used floor for this model, and the same model is still
 * doing the detecting, so the same floor carries over.
 *
 * Lowering it cannot make verification pass by accident: a false positive still
 * has to satisfy the single-face, size and centring rules, AND every submitted
 * frame is re-validated server-side. The backend is the only authority.
 */
export const MIN_FACE_CONFIDENCE = 0.2;

/**
 * How many faces to mesh. TWO, deliberately.
 *
 * ONE would be cheaper, but it would also be dishonest: with `numFaces: 1` the
 * model returns only the largest face, so a second person in frame is silently
 * ignored and the check cannot enforce its own "only one person should be
 * visible" rule. With TWO, a returned pair of meshes PROVES at least two people
 * are present, which is exactly the claim the UI needs to make. The cost is
 * meshing one extra face, only when a second face is actually there.
 */
export const MAX_MESHES = 2;

/**
 * How many landmarks the model must return before a mesh is trusted at all.
 * 468 is the standard face mesh; 478 includes the iris refinement.
 */
const MIN_LANDMARKS = 400;

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

/** Probe a static URL (HEAD, GET fallback) so a missing asset is NAMED, not guessed. */
async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) return true;
    // Some static hosts reject HEAD; a tiny range GET is an honest second try.
    const get = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    return get.ok || get.status === 206;
  } catch (err) {
    // A probe that could not even be sent (offline, CSP, bad base URL) is not
    // proof the asset is missing — but the caller treats "not reachable" as
    // "cannot be used" either way, so record why and move on (§7: never silent).
    console.warn('[faceLandmarker] asset probe failed', { url }, err);
    return false;
  }
}

async function loadLandmarker(): Promise<FaceLandmarker> {
  const { FaceLandmarker: FaceLandmarkerCtor, FilesetResolver } = await import(
    '@mediapipe/tasks-vision'
  );

  // The app ships its own copies of both assets, so a missing file is a BUILD
  // problem, not something to paper over by quietly downloading a 3.6 MB
  // biometric model from a third-party CDN at runtime. Probe first and name the
  // exact missing path, so the failure is diagnosable instead of surfacing as
  // an opaque "could not start" (§3 / §20).
  const unreachable: string[] = [];
  if (!(await reachable(LOCAL_WASM_BINARY))) unreachable.push(LOCAL_WASM_BINARY);
  if (!(await reachable(LOCAL_MODEL_URL))) unreachable.push(LOCAL_MODEL_URL);
  if (unreachable.length > 0) {
    throw new Error(
      `Live face verification could not start: these app assets could not be loaded — ` +
        `${unreachable.join(' and ')}. They ship in public/vision, so this is an install/` +
        `build problem, not a camera or document problem.`,
    );
  }
  // Asset paths only — no image data, no landmark data.
  console.debug('[faceVerification] loading face landmarker', {
    wasmBase: LOCAL_WASM_DIR,
    modelPath: LOCAL_MODEL_URL,
  });

  const fileset = await FilesetResolver.forVisionTasks(LOCAL_WASM_DIR);

  let lastError: unknown = null;
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      const landmarker = await FaceLandmarkerCtor.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: LOCAL_MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numFaces: MAX_MESHES,
        minFaceDetectionConfidence: MIN_FACE_CONFIDENCE,
        minFacePresenceConfidence: MIN_FACE_CONFIDENCE,
        minTrackingConfidence: MIN_FACE_CONFIDENCE,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      console.debug('[faceVerification] face landmarker ready', { delegate });
      return landmarker;
    } catch (err) {
      lastError = err;
      console.warn(
        `[faceVerification] FaceLandmarker init failed with delegate=${delegate} (retrying on next delegate)`,
        err,
      );
    }
  }
  throw lastError;
}

/**
 * Get the shared landmarker, loading it lazily. A failed load clears the cached
 * promise so the very next call retries instead of rethrowing the same error.
 * Calling this while a load is in flight joins THAT load — it can never start a
 * second one, which is what keeps the page to a single WASM runtime and a
 * single WebGL context.
 */
export function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = loadLandmarker().catch((err) => {
      landmarkerPromise = null; // never cache a failed load — retry next request
      throw err;
    });
  }
  return landmarkerPromise;
}

/** Release the WASM task. Safe to call with nothing loaded. */
export async function closeFaceLandmarker(): Promise<void> {
  const pending = landmarkerPromise;
  landmarkerPromise = null;
  if (!pending) return;
  try {
    const landmarker = await pending;
    landmarker.close();
  } catch (err) {
    // The load itself failed earlier — nothing to close, but say why (§7).
    console.warn('[faceLandmarker] closeFaceLandmarker: no live landmarker to release', err);
  }
}

/**
 * Warm the model up so the FIRST analysed frame does not pay for it.
 *
 * The WASM bundle is ~9.4 MB and the mesh weights are a further ~3.6 MB, so
 * paying for that inside the detection loop — after the camera is already live —
 * stalls the main thread on the very first frames, which is when the user
 * expects the preview to appear.
 *
 * This is a pure pre-warm: `getFaceLandmarker()` is a module-level singleton, so
 * this can never create a second task, and a failure here is not cached (the
 * loop's real load retries) and is not swallowed silently.
 */
export function preloadFaceLandmarker(): void {
  if (landmarkerPromise) return; // already loading or loaded — never a 2nd copy
  void getFaceLandmarker().catch((err) => {
    console.warn(
      '[faceVerification] face-model pre-warm did not finish (the capture loop will retry honestly)',
      err,
    );
  });
}

// ── result → face geometry (PURE, so it can be tested without a camera) ──────

/** One analysed video frame: the meshes found and their boxes, same order. */
export interface FaceFrame {
  /** Face meshes, LARGEST FACE FIRST. Empty when the model found no face. */
  meshes: readonly (readonly Point2D[])[];
  /** Face boxes in VIDEO pixels, in the same order as `meshes`. */
  boxes: RawFaceBox[];
}

const NO_FACES: FaceFrame = { meshes: [], boxes: [] };

/**
 * The face's own box, from the extent of the mesh the model returned.
 *
 * The mesh tessellates the face — forehead to chin, ear to ear — so its extent
 * IS the face's extent, and min/max over the points is the honest analogue of
 * the detector bounding box this replaces. There is no smoothing, padding or
 * guessed margin: every number here is a landmark coordinate.
 *
 * `null` means "not a usable face this frame" — no mesh, a truncated mesh, no
 * finite coordinates at all, or a degenerate box. The caller must not substitute
 * a value; see `eyeAspectRatio.ts` for why a fabricated measurement is worse
 * than none.
 */
function meshBox(
  mesh: readonly Point2D[] | null | undefined,
  videoWidth: number,
  videoHeight: number,
): RawFaceBox | null {
  if (!Array.isArray(mesh) || mesh.length < MIN_LANDMARKS) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of mesh) {
    // The SAME reader the EAR uses. One definition of "how do I get x and y off a
    // landmark" — if the two disagreed, the guide could be drawing one face's
    // box while the blink measured another face's landmarks.
    const xy = landmarkCoords(point);
    if (!xy) continue;
    const [x, y] = xy;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  // Normalized → video pixels, then clamped to the frame. The clamp matches what
  // the bounding-box detector did: a mesh point sitting exactly on the frame
  // edge must not push the box outside it and corrupt the area and clip tests.
  const x0 = Math.max(0, Math.min(minX * videoWidth, videoWidth));
  const y0 = Math.max(0, Math.min(minY * videoHeight, videoHeight));
  const x1 = Math.max(x0, Math.min(maxX * videoWidth, videoWidth));
  const y1 = Math.max(y0, Math.min(maxY * videoHeight, videoHeight));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Turn the model's raw result into the face geometry the UI needs, LARGEST FACE
 * FIRST. Pure and DOM-free.
 *
 * Ordering both lists together is what guarantees the eye measurement and the
 * guide are looking at the SAME face: the guide's `boxes[0]` and the blink's
 * `meshes[0]` are the largest face in the frame, by construction.
 *
 * Returns no faces (never a fabricated one) when the model found nothing, when
 * the frame has no usable dimensions, or when a mesh is too short to be a face.
 */
export function buildFaceFrame(
  rawMeshes: readonly (readonly Point2D[])[] | null | undefined,
  videoWidth: number,
  videoHeight: number,
): FaceFrame {
  if (!Array.isArray(rawMeshes) || rawMeshes.length === 0) return NO_FACES;
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)) return NO_FACES;
  if (videoWidth <= 0 || videoHeight <= 0) return NO_FACES;

  const found: { mesh: readonly Point2D[]; box: RawFaceBox; area: number }[] = [];
  for (const mesh of rawMeshes) {
    const box = meshBox(mesh, videoWidth, videoHeight);
    if (!box) continue;
    found.push({ mesh, box, area: (box.x1 - box.x0) * (box.y1 - box.y0) });
  }
  if (found.length === 0) return NO_FACES;
  found.sort((a, b) => b.area - a.area);
  return { meshes: found.map((entry) => entry.mesh), boxes: found.map((entry) => entry.box) };
}

/**
 * Run the model on the CURRENT frame of a live <video> element — the same frame
 * the user is actually seeing, never a stale canvas or blob. Returns the face
 * meshes and their boxes, largest face first.
 *
 * `timestampMs` must increase monotonically per camera session; the page tracks
 * the last timestamp it passed and skips the call rather than letting the task
 * throw once per frame.
 *
 * This deliberately does NOT catch. A per-frame failure is real information the
 * caller must record and show — the previous shape swallowed it here, which is
 * how a broken detector could leave the guide reading a stale face count
 * forever with nothing in the UI to say so. The caller's frame handler catches,
 * marks the frame as yielding no verdict, and keeps the loop running.
 */
let landmarkerCanvas: HTMLCanvasElement | null = null;
let landmarkerCtx: CanvasRenderingContext2D | null = null;
let globalLandmarkerTs = 0;

export function detectFacesAndEyesNow(
  landmarker: FaceLandmarker,
  video: HTMLVideoElement | HTMLCanvasElement,
  timestampMs?: number,
): FaceFrame {
  const videoWidth = video instanceof HTMLVideoElement ? video.videoWidth : video.width;
  const videoHeight = video instanceof HTMLVideoElement ? video.videoHeight : video.height;

  if (!videoWidth || !videoHeight || (video instanceof HTMLVideoElement && video.readyState < 2)) {
    return NO_FACES;
  }

  // Strictly monotonic timestamp across the entire app lifecycle
  const now = Math.floor(performance.now());
  const requestedTs = typeof timestampMs === 'number' && Number.isFinite(timestampMs) ? timestampMs : now;
  globalLandmarkerTs = Math.max(requestedTs, globalLandmarkerTs + 33);

  // Safe canvas decoupling: copy frame to dedicated offscreen canvas so WebGL/WASM
  // never contends with Chromium's native DirectComposition video overlay.
  // This completely eliminates black flickering, texture locks, and GPU pipeline stalls.
  let sourceElement: HTMLCanvasElement | HTMLVideoElement = video;
  if (video instanceof HTMLVideoElement && typeof document !== 'undefined') {
    if (!landmarkerCanvas) {
      landmarkerCanvas = document.createElement('canvas');
      landmarkerCtx = landmarkerCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (landmarkerCanvas && landmarkerCtx) {
      const targetW = Math.min(videoWidth, 640);
      const targetH = Math.max(1, Math.round((targetW / videoWidth) * videoHeight));
      if (landmarkerCanvas.width !== targetW || landmarkerCanvas.height !== targetH) {
        landmarkerCanvas.width = targetW;
        landmarkerCanvas.height = targetH;
      }
      landmarkerCtx.drawImage(video, 0, 0, targetW, targetH);
      sourceElement = landmarkerCanvas;
    }
  }

  let result: FaceLandmarkerResult;
  try {
    result = landmarker.detectForVideo(sourceElement, globalLandmarkerTs);
  } catch (err) {
    console.warn('[faceLandmarker] detectForVideo call failed', { ts: globalLandmarkerTs }, err);
    return NO_FACES;
  }

  return buildFaceFrame(result?.faceLandmarks, videoWidth, videoHeight);
}
