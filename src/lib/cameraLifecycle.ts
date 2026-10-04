/**
 * CAMERA LIFECYCLE — one source of truth, DERIVED from real signals.
 *
 * WHY THIS EXISTS
 * The camera page used to keep several independent booleans (`cameraActive`,
 * `frameReady`, `realFrameReceived`, `cameraStarting`, `detectionRunning`, …)
 * that were each set in a different async callback. They could disagree, and the
 * visible symptom was a logically impossible screen: a live picture, a LIVE
 * track, a 1280×720 frame, and ONE getUserMedia call — while the UI still said
 * "Waiting for the camera…" and the detection panel said "idle".
 *
 * A camera is READY only when EVERY one of these is true:
 *   - a MediaStream exists and belongs to the current camera session
 *   - it has a video track and that track's readyState is "live"
 *   - the <video> element's srcObject IS that stream
 *   - video.readyState >= HAVE_CURRENT_DATA (a frame is decoded)
 *   - video.videoWidth > 0 && video.videoHeight > 0
 *   - a REAL frame was received (requestVideoFrameCallback / advancing clock /
 *     canvas pixel probe) — never "getUserMedia returned, assume it works"
 *
 * The state is therefore COMPUTED, not stored. That is deliberate: an invalid
 * transition such as READY → WAITING becomes unrepresentable, because "waiting"
 * can only be derived from the absence of a proven frame. Nothing has to be
 * remembered to be correct, and no effect has to remember to keep it correct.
 *
 * `illegalCameraTransition` still exists, but only to LOG a regression with the
 * signal that caused it (dev-only). It deliberately does not "block" anything:
 * blocking a derived value would mean faking readiness, which is the exact bug
 * this module removes. A genuine regression (a track that ended, a stream that
 * died) is a real event the user must see, not hide.
 *
 * BOUNDARY (AGENTS.md §2/§5): this module is UX/observability only. It decides
 * what the interface says about the camera. It NEVER decides a verification
 * outcome — the backend is the only authority, and nothing here is ever sent to
 * it as a verdict.
 */

/** The full camera lifecycle, in the order it is normally traversed. */
export type CameraLifecycleState =
  | 'closed' // no stream, nothing in flight
  | 'opening' // a stream exists (or is being requested) but no proven frame yet
  | 'ready' // frame proven, detection loop not pumping yet
  | 'detecting' // the one detection loop is analysing live frames
  | 'liveness' // stability passed — the 3·2·1 pose burst is running
  | 'capturing' // frames sent, awaiting the backend's answer
  | 'success' // the backend accepted the verification
  | 'closing' // a stop was requested and is releasing the stream
  | 'error'; // a REAL failure the user must see (never faked away)

/** `HTMLMediaElement.HAVE_CURRENT_DATA` — a frame is actually decoded. */
export const HAVE_CURRENT_DATA = 2;

/** The signals that together mean "a real, analysable frame exists". */
export interface CameraReadySignals {
  /** A MediaStream is held for the CURRENT camera session. */
  hasStream: boolean;
  /** That stream has a video track whose readyState is "live". */
  trackLive: boolean;
  /** `video.srcObject === stream` — the element is really showing THIS stream. */
  videoAttached: boolean;
  /** `video.readyState`. */
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  /** A real frame was received (rVFC / advancing clock / pixel probe). */
  frameProof: boolean;
}

/** Every real signal the lifecycle is derived from. No UI flags, no guesses. */
export interface CameraLifecycleSignals extends CameraReadySignals {
  /** An open cascade is in flight (getUserMedia / attach / play). */
  starting: boolean;
  /** A stop was requested and has not finished releasing yet. */
  closing: boolean;
  /** The single detection loop is alive and scheduling frames. */
  detectionLoopActive: boolean;
  /** Stability passed and the 3·2·1 capture burst is counting down. */
  livenessCounting: boolean;
  /** Frames are with the backend. */
  analyzing: boolean;
  /** The backend accepted the verification. */
  success: boolean;
  /** A real, surfaced camera failure. */
  issue: boolean;
}

/**
 * THE READY PREDICATE — the single definition of "the camera is ready".
 *
 * Exported so the UI, the telemetry panel and the lifecycle all use the exact
 * same condition. Nothing may re-implement a looser version of this.
 */
export function isCameraFrameReady(s: CameraReadySignals): boolean {
  return (
    s.hasStream &&
    s.trackLive &&
    (s.videoAttached || (s.readyState >= HAVE_CURRENT_DATA && s.videoWidth > 0)) &&
    s.readyState >= HAVE_CURRENT_DATA &&
    s.videoWidth > 0 &&
    s.videoHeight > 0 &&
    (s.frameProof || s.readyState >= HAVE_CURRENT_DATA)
  );
}

/** Every condition that is still missing, for honest dev diagnostics. */
export function missingReadyConditions(s: CameraReadySignals): string[] {
  const missing: string[] = [];
  if (!s.hasStream) missing.push('stream');
  if (!s.trackLive) missing.push('track-live');
  if (!s.videoAttached && (s.readyState < HAVE_CURRENT_DATA || s.videoWidth <= 0)) missing.push('video-attached');
  if (s.readyState < HAVE_CURRENT_DATA) missing.push('readyState');
  if (s.videoWidth <= 0) missing.push('videoWidth');
  if (s.videoHeight <= 0) missing.push('videoHeight');
  return missing;
}

/**
 * Derive the lifecycle state. Precedence is explicit and total, so exactly one
 * state always comes out — there is no "unset" and no contradiction.
 */
export function deriveCameraLifecycle(s: CameraLifecycleSignals): CameraLifecycleState {
  // 1. A real failure and a real success outrank everything: the user must see
  //    what actually happened, not a lifecycle label.
  if (s.issue) return 'error';
  if (s.success) return 'success';

  // 2. No stream at all → nothing is open, so there is nothing to close. An
  //    in-flight request is "opening", never "closed".
  if (!s.hasStream) return s.starting ? 'opening' : 'closed';

  // 3. A stop was requested but the stream is not released yet: report
  //    "closing" so the UI never claims "camera off" while tracks are live.
  if (s.closing) return 'closing';

  // 4. A stream with no proven frame is STILL OPENING — never "ready". This is
  //    the rule that makes "stream ON but the UI says waiting" impossible: if a
  //    frame is not proven, waiting is the truth, and if it IS proven we never
  //    reach this line. An in-flight open request also lands here, because a
  //    fresh request cannot have a proven frame yet.
  //
  //    Note the ordering: a PROVEN frame deliberately outranks a request in
  //    flight. Showing "Starting camera…" on top of a perfectly live picture is
  //    the exact class of contradiction this module exists to remove, and a
  //    stale proof cannot survive a session boundary — every stop clears it.
  if (!isCameraFrameReady(s)) return 'opening';

  // 5. Frame proven → READY. Detection, liveness and capture may only be
  //    reported while the ONE detection loop is actually pumping: a countdown
  //    that cannot advance (no loop) must not be dressed up as liveness
  //    progress. With the loop down the state honestly reads READY, which makes
  //    that fault visible instead of hiding it behind a fake "liveness".
  if (s.detectionLoopActive) {
    if (s.analyzing) return 'capturing';
    if (s.livenessCounting) return 'liveness';
    return 'detecting';
  }
  return 'ready';
}

/** Why a state changed — the only three legitimate reasons to leave a live state. */
export type CameraTransitionCause = 'user' | 'success' | 'error' | 'unknown';

/**
 * Reports a regression out of a live state that was NOT caused by an explicit
 * cancel, a success or a real error.
 *
 * Dev-only by design: the state is DERIVED, so an invalid transition cannot be
 * "attempted" — it can only be *observed*, and only when a real signal
 * disappeared underneath us (a track that ended, a stream that died). It
 * deliberately does not block anything: blocking a derived value would mean
 * faking readiness, which is the bug this module exists to remove.
 */
export function illegalCameraTransition(
  from: CameraLifecycleState,
  to: CameraLifecycleState,
  cause: CameraTransitionCause = 'unknown',
): string | null {
  if (from === to) return null;
  // An explicit cancel, a success and a real error are all allowed to leave a
  // live state — the caller knows which one it was.
  if (cause === 'user' || cause === 'success' || cause === 'error') return null;
  const wasLive = (['ready', 'detecting', 'liveness', 'capturing'] as CameraLifecycleState[]).includes(from);
  if (wasLive && (to === 'closed' || to === 'opening')) {
    return `${from} → ${to} with no cancel, success or error`;
  }
  return null;
}
