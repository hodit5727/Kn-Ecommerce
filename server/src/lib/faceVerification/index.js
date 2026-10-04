/**
 * Seller identity + face verification — PROVIDER abstraction (§6).
 *
 * The backend decides every verification outcome through a provider that
 * matches this contract. In production the provider is `human` — a REAL
 * on-server ML pipeline (@vladmandic/human, TF.js CPU backend, local model
 * weights; see ./engine.js). Nothing here ever fabricates a verdict: when a
 * provider is not configured the flow answers an honest 503 (§2.6 "never
 * fake functionality"), and when a model cannot produce a confident result
 * the outcome defaults to MANUAL_REVIEW (fail-closed, §8).
 *
 * Provider object:
 *   { mode: 'human'|'disabled', configured: boolean, thresholds: object,
 *     analyzeIdentityDocument({bytes,mime}) → { status, faceCount, reasons, meta }
 *     analyzeLiveFrame({bytes,mime})      → { pass, faceCount, reasons, measurements }
 *     computeLiveness({frames, step})     → { passed, reasons }
 *     compareFaces({ id, live })          → { similarity, distance, threshold,
 *                                              passed, unable?, reason? } }
 *
 * Tests inject a deterministic fake provider (dependency injection — there is
 * NO env-controllable "test mode" in this module; see server/tests).
 */
import { httpError } from '../errors.js';
import { sniffMime } from '../uploads.js';
import {
  decodeImageTensor,
  getEngine,
  runDetection,
  measureFaceQuality,
  faceGestures,
  eyeAspectRatio,
} from './engine.js';

export const FACE_PROVIDER_HUMAN = 'human';
export const FACE_PROVIDER_DISABLED = 'disabled';

/**
 * Resolve the configured provider. `FACE_VERIFICATION_PROVIDER` accepts only
 * "human" (default — real ML) or "disabled" (honest 503 on every attempt).
 */
export function createFaceVerificationProvider({ env }) {
  const mode = String(env.FACE_VERIFICATION_PROVIDER || FACE_PROVIDER_HUMAN).trim();
  if (mode === FACE_PROVIDER_DISABLED) return disabledProvider();
  if (mode === FACE_PROVIDER_HUMAN) return humanProvider(env);
  throw new Error(
    `Configuration error — FACE_VERIFICATION_PROVIDER must be "${FACE_PROVIDER_HUMAN}" or ` +
      `"${FACE_PROVIDER_DISABLED}" (got "${mode}").`,
  );
}

function disabledProvider() {
  const unavailable = () => {
    throw httpError(
      503,
      'Identity verification is not configured on this server. Please try again later.',
    );
  };
  return {
    mode: FACE_PROVIDER_DISABLED,
    configured: false,
    thresholds: {},
    analyzeIdentityDocument: unavailable,
    analyzeLiveFrame: unavailable,
    computeLiveness: unavailable,
    compareFaces: unavailable,
  };
}

function humanProvider(env) {
  const thresholds = {
    matchSimilarity: env.FACE_MATCH_SIMILARITY_THRESHOLD,
    manualReviewSimilarity: env.FACE_MANUAL_REVIEW_SIMILARITY,
    livenessMin: env.FACE_LIVENESS_MIN_SCORE,
    antispoofMin: env.FACE_ANTISPOOF_MIN_SCORE,
    maxAttempts: env.FACE_MAX_ATTEMPTS,
  };

  const engineUnavailable = (label, cause) => {
    // eslint-disable-next-line no-console
    console.error(
      '[faceVerification] provider unavailable during', label,
      '-', cause && cause.message ? cause.message : cause,
    );
    throw httpError(503, 'Identity verification is temporarily unavailable. Please try again later.');
  };

  // Human's ML engine is NOT concurrency-safe (a single shared TF graph), so
  // every public provider call is serialized through a promise chain. This
  // keeps concurrent users from corrupting each other's inference runs.
  let opChain = Promise.resolve();
  const serial = (fn) => {
    const run = opChain.then(fn, fn);
    opChain = run.then(() => {}, () => {});
    return run;
  };

  const frameOf = ({ bytes, mime }) => {
    const real = sniffMime(bytes);
    if ((real !== 'image/jpeg' && real !== 'image/png') || (mime && mime !== real)) {
      return null;
    }
    return decodeImageTensor(bytes, real);
  };

  const single = (faces) => {
    if (!faces || faces.length === 0) return { ok: false, reason: 'no_face' };
    if (faces.length > 1) return { ok: false, reason: 'multiple_faces' };
    return { ok: true, face: faces[0] };
  };

  const num = (v) => (Array.isArray(v) ? v[0] : v);

  /**
   * Identity-document scan: exactly one readable face, sharp enough, not cut
   * off, not absurdly small. Uses the FAST pipeline (detector only).
   */
  async function analyzeIdentityDocument({ bytes, mime }) {
    try {
      const decoded = frameOf({ bytes, mime });
      if (!decoded) {
        return { status: 'FAILED', faceCount: 0, reasons: ['not_an_image'], provider: 'human', meta: {} };
      }
      const res = await runDetection(decoded.tensor, {
        face: {
          mesh: { enabled: false },
          iris: { enabled: false },
          emotion: { enabled: false },
          antispoof: { enabled: false },
          liveness: { enabled: false },
        },
        gesture: { enabled: false },
      });
      const picked = single(res.face);
      if (!picked.ok) {
        return { status: 'FAILED', faceCount: res.face?.length ?? 0, reasons: [picked.reason], provider: 'human', meta: {} };
      }
      const q = await measureFaceQuality(picked.face, decoded.tensor, decoded.width, decoded.height, {
        minAreaFraction: 0.01,
        minLuma: 30,
        minSharpness: 6,
      });
      const reasons = [];
      if (q.blurred) reasons.push('blurred');
      if (q.tooDark) reasons.push('too_dark');
      if (q.tooSmall) reasons.push('face_too_small');
      if (q.cutOff) reasons.push('face_cut_off');
      const status = reasons.length ? 'FAILED' : 'PASSED';
      return {
        status,
        faceCount: 1,
        reasons,
        provider: 'human',
        meta: { sharpness: q.sharpness, luma: q.luma, areaFraction: q.areaFraction },
      };
    } catch (e) {
      if (e.status === 503) throw e;
      return engineUnavailable('document scan', e);
    }
  }

  /**
   * Single live-capture frame: exactly one face, quality OK, and the
   * anti-spoof/liveness models both clear. Returns measurements for the
   * challenge step logic. DESCRIPTION is deliberately OFF here (frame
   * comparison happens once, in compareFaces, to stay fast).
   */
  async function analyzeLiveFrame({ bytes, mime }) {
    try {
      const decoded = frameOf({ bytes, mime });
      if (!decoded) {
        return { pass: false, faceCount: 0, reasons: ['not_an_image'], measurements: {} };
      }
      const res = await runDetection(decoded.tensor, {
        face: { description: { enabled: false } },
      });
      const picked = single(res.face);
      if (!picked.ok) {
        return { pass: false, faceCount: res.face?.length ?? 0, reasons: [picked.reason], measurements: {} };
      }
      const f = picked.face;
      const liveness = num(f.live);
      const antispoof = num(f.real);
      const q = await measureFaceQuality(f, decoded.tensor, decoded.width, decoded.height, {
        minAreaFraction: 0.02,
        minLuma: 35,
        minSharpness: 6,
      });
      const reasons = [];
      if (q.blurred) reasons.push('blurred');
      if (q.tooDark) reasons.push('too_dark');
      if (q.tooSmall) reasons.push('face_too_small');
      if (q.cutOff) reasons.push('face_cut_off');
      if (typeof liveness === 'number' && liveness < thresholds.livenessMin) reasons.push('liveness_low');
      if (typeof antispoof === 'number' && antispoof < thresholds.antispoofMin) reasons.push('spoof_suspected');
      return {
        pass: reasons.length === 0,
        faceCount: 1,
        reasons,
        measurements: {
          liveness,
          antispoof,
          luma: q.luma,
          sharpness: q.sharpness,
          areaFraction: q.areaFraction,
          cutOff: q.cutOff,
          gestures: faceGestures(res, f.id ?? 0),
          leftEar: eyeAspectRatio(
            f.annotations, 'leftEyeUpper0', 'leftEyeLower0',
            'leftEyeUpper1', 'leftEyeLower1', 'leftEyeUpper2', 'leftEyeLower2',
          ),
          rightEar: eyeAspectRatio(
            f.annotations, 'rightEyeUpper0', 'rightEyeLower0',
            'rightEyeUpper1', 'rightEyeLower1', 'rightEyeUpper2', 'rightEyeLower2',
          ),
        },
      };
    } catch (e) {
      if (e.status === 503) throw e;
      return engineUnavailable('live-frame analysis', e);
    }
  }

  /** Challenge step acceptance on top of per-frame base checks (§5 randomized
   *  liveness: blink / head-turn bursts must really occur during capture). */
  function stepEvidence(measurementsList, step) {
    const gestures = measurementsList.flatMap((m) => m.measurements.gestures ?? []);
    const mean = (m) => {
      const v = m.measurements[{
        look_straight: 'liveness', blink: 'liveness', turn_left: 'liveness', turn_right: 'liveness',
      }[step]];
      return typeof v === 'number' ? v : null;
    };
    const blinked = (g) => /blink/i.test(g);
    const turned = (g) => /facing (left|right)/i.test(g);
    switch (step) {
      case 'blink': {
        const gestureBlink = gestures.some(blinked) && gestures.some((g) => !blinked(g));
        const ears = measurementsList
          .map((m) => {
            const l = m.measurements?.leftEar;
            const r = m.measurements?.rightEar;
            if (typeof l === 'number' && typeof r === 'number') return (l + r) / 2;
            if (typeof l === 'number') return l;
            if (typeof r === 'number') return r;
            return null;
          })
          .filter((v) => typeof v === 'number');
        const earBlink = ears.length >= 2 && (
          Math.min(...ears) < 0.24 ||
          Math.min(...ears) <= Math.max(...ears) * 0.88
        );
        const passed = gestureBlink || earBlink;
        return { passed, reasons: passed ? [] : ['blink_not_observed'] };
      }
      case 'turn_left':
        return { passed: gestures.some((g) => /facing left/i.test(g)), reasons: ['turn_not_observed'] };
      case 'turn_right':
        return { passed: gestures.some((g) => /facing right/i.test(g)), reasons: ['turn_not_observed'] };
      case 'look_straight':
      default:
        return {
          passed: !gestures.some((g) => turned(g)),
          reasons: gestures.some((g) => turned(g)) ? ['head_turned'] : [],
        };
    }
  }

  /**
   * Liveness challenge step: every frame in the burst must clear the base
   * bar (one face, quality, liveness, anti-spoof) and the burst must show the
   * requested behaviour (§5 randomized challenge, §7 exactly one live face).
   */
  async function computeLiveness({ frames, step }) {
    try {
      if (!Array.isArray(frames) || frames.length === 0) {
        return { passed: false, reasons: ['no_frames'] };
      }
      const analyzed = [];
      for (const frame of frames) {
        const r = await analyzeLiveFrame(frame);
        analyzed.push(r);
      }
      const passedFrames = analyzed.filter((a) => a.pass);
      // Require at least half of frames (min 2) to clear all strict checks
      if (passedFrames.length < Math.min(2, frames.length)) {
        const failedReasons = analyzed.filter((a) => !a.pass).flatMap((a) => a.reasons);
        return {
          passed: false,
          reasons: failedReasons.length ? [...new Set(failedReasons)] : ['quality_failed'],
          frames: analyzed.map((a) => ({ pass: a.pass, reasons: a.reasons })),
        };
      }
      const { passed, reasons } = stepEvidence(analyzed, step);
      return {
        passed,
        reasons: passed ? [] : reasons,
        frames: analyzed.map((a) => ({ pass: a.pass, reasons: a.reasons })),
      };
    } catch (e) {
      if (e.status === 503) throw e;
      return engineUnavailable('liveness check', e);
    }
  }

  /**
   * Final face match: real embedding similarity between the stored identity
   * document photo and the best live frame (spec §6 — no universal threshold;
   * this provider's threshold is configured via env and validated by tests).
   * An engine that cannot produce both descriptors returns `unable` — the
   * route treats that as MANUAL_REVIEW (fail-closed), never as a pass.
   */
  async function compareFaces({ id, live }) {
    try {
      const idDecoded = frameOf(id);
      const liveDecoded = frameOf(live);
      if (!idDecoded || !liveDecoded) {
        return { similarity: null, distance: null, threshold: thresholds.matchSimilarity, passed: false, unable: true, reason: 'unreadable_image' };
      }
      // Sequential, not parallel — the shared TF engine is single-threaded.
      const idRes = await runDetection(idDecoded.tensor, {
        face: { iris: { enabled: false }, emotion: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false } },
        gesture: { enabled: false },
      });
      const liveRes = await runDetection(liveDecoded.tensor, {
        face: { iris: { enabled: false }, emotion: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false } },
        gesture: { enabled: false },
      });
      const idFace = idRes.face?.[0];
      const liveFace = liveRes.face?.[0];
      if (!idFace || !liveFace) {
        return { similarity: null, distance: null, threshold: thresholds.matchSimilarity, passed: false, unable: true, reason: 'face_not_found' };
      }
      if (!idFace.embedding?.length || !liveFace.embedding?.length) {
        return { similarity: null, distance: null, threshold: thresholds.matchSimilarity, passed: false, unable: true, reason: 'embedding_unavailable' };
      }
      const human = await getEngine();
      const similarity = human.match.similarity(idFace.embedding, liveFace.embedding);
      const distance = human.match.distance(idFace.embedding, liveFace.embedding);
      return {
        similarity,
        distance,
        threshold: thresholds.matchSimilarity,
        passed: similarity >= thresholds.matchSimilarity,
      };
    } catch (e) {
      if (e.status === 503) throw e;
      return { similarity: null, distance: null, threshold: thresholds.matchSimilarity, passed: false, unable: true, reason: 'provider_error' };
    }
  }

  return {
    mode: FACE_PROVIDER_HUMAN,
    configured: true,
    thresholds,
    // Public boundary goes through the serialization mutex (engine safety).
    analyzeIdentityDocument: (...a) => serial(() => analyzeIdentityDocument(...a)),
    analyzeLiveFrame: (...a) => serial(() => analyzeLiveFrame(...a)),
    computeLiveness: (...a) => serial(() => computeLiveness(...a)),
    compareFaces: (...a) => serial(() => compareFaces(...a)),
  };
}

export const isFaceVerificationEnabled = ({ env }) =>
  String(env.FACE_VERIFICATION_PROVIDER || FACE_PROVIDER_HUMAN).trim() === FACE_PROVIDER_HUMAN;