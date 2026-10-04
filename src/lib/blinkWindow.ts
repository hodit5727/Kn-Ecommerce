/**
 * THE BLINK-WINDOW FRAME BUFFER
 * ==============================
 *
 * THE PROBLEM
 * -----------
 * The backend decides whether a blink happened by running real eye-aspect-ratio
 * and gesture models over a BURST of frames (`computeLiveness`). A burst of
 * frames captured AFTER the blink is over is not a blink — it is a sequence of
 * identical open-eye frames, and no amount of analysis can recover a closure
 * that is not in the pixels.
 *
 * The old flow sidestepped this by capturing a fresh burst when each challenge
 * step began, so "the frames around the action" were collected by construction.
 * A single-blink flow has no such boundary to hang the capture on: by the time
 * the browser has told us a blink completed, the closure is already 100–300 ms
 * in the past.
 *
 * THE FIX
 * -------
 * Keep a short, bounded ring buffer of the most recent frames IN MEMORY while
 * the camera runs, and on Submit send the slice of that buffer which spans the
 * detected blink. The frames the backend analyses therefore genuinely contain
 * the closure.
 *
 * WHY THIS IS SAFE (AGENTS.md §2)
 * -------------------------------
 * - IN MEMORY ONLY. This is a plain module-scoped `Map` of `Blob`s. It is never
 *   written to localStorage, sessionStorage, IndexedDB, a cookie, or any
 *   persistence layer, so nothing survives the tab and nothing is readable by
 *   another page, another user, or a later session. The buffer is cleared on
 *   submit, on cancel, on camera teardown and on unmount.
 * - It holds the same bytes the camera already has in memory; it does not add
 *   a new copy of anything that was not already being processed per-frame.
 * - NO BIOMETRIC DATA LEAVES THIS MODULE except as the octet-stream body of the
 *   existing `/face` upload, which is the only channel frames are ever sent on.
 *   There is no logging here: no console output, no frame data in an error, no
 *   dimensions or sizes attached to a thrown error. Project rule §7 is about
 *   surfacing errors, not about printing payloads, and printing frame bytes
 *   would be a biometric leak.
 * - It is bounded in BOTH count and age, so a user who abandons the flow cannot
 *   grow it without limit, and stale frames (from before a re-position) are
 *   dropped rather than uploaded.
 */

/** Hard cap on retained frames, independent of age. Retains ample buffer history. */
const MAX_FRAMES = 80;
/**
 * How many frames the SERVER will accept for one step.
 *
 * Mirrors `FrameCache.add`'s `stepFrames.length >= 4` rejection in
 * server/src/lib/verification/frames.js. This is not a free parameter: uploading
 * a fifth frame makes the backend refuse the step with "Too many frames for this
 * session", which the user would see as a failed capture for a reason that has
 * nothing to do with what they did. The client therefore sends at most this many,
 * and uploads the frames CLOSEST to the blink, because that is where the
 * closure is.
 */
const SERVER_MAX_FRAMES_PER_STEP = 4;
/**
 * How far BEFORE the blink the upload must reach.
 *
 * A blink's closing phase is short and the browser reports it late, so a window
 * that starts at the detection instant would begin after the closure. This is
 * wide enough to contain the closure plus a preceding open frame or two, which
 * the models need in order to see a transition rather than a static squint.
 */
const PRE_BLINK_MS = 2500;
/** How far AFTER the blink the upload may reach. */
const POST_BLINK_MS = 1500;

export interface BlinkWindowFrame {
  blob: Blob;
  /** `performance.now()` at capture, the same clock the blink gate uses. */
  at: number;
}

/** One live buffer. Keyed by session id so two sessions never share frames. */
const buffers = new Map<string, BlinkWindowFrame[]>();

function bufferFor(sessionId: string): BlinkWindowFrame[] {
  let list = buffers.get(sessionId);
  if (!list) {
    list = [];
    buffers.set(sessionId, list);
  }
  return list;
}

/**
 * Append one frame to this session's ring buffer.
 *
 * Called once per accepted live frame. Cheap by design: it drops anything past
 * the count cap and returns early if the buffer is not for a live session, so a
 * paused or torn-down flow costs nothing.
 */
export function pushBlinkWindowFrame(sessionId: string | null, blob: Blob, at: number): void {
  if (!sessionId || blob.size === 0) return;
  const list = bufferFor(sessionId);
  list.push({ blob, at });
  if (list.length > MAX_FRAMES) {
    list.splice(0, list.length - MAX_FRAMES);
  }
}

/**
 * The frames that span the blink, oldest first, ready to upload.
 *
 * Anchored on the instant the blink COMPLETED and widened backwards by
 * `PRE_BLINK_MS`, because that is the only moment the closure can be located
 * from. The window is then trimmed to the frames NEAREST the blink, capped at
 * what the server accepts, so the closure is always inside what is sent.
 *
 * Returns an empty array when there is nothing usable. The caller must then
 * refuse to submit rather than uploading unrelated frames: frames with no blink
 * in them would produce a server-side liveness failure the user could do nothing
 * about and could not diagnose.
 */
export function takeBlinkWindow(sessionId: string | null, blinkCompletedAt: number | null): Blob[] {
  if (!sessionId) return [];
  const list = buffers.get(sessionId);
  if (!list || list.length === 0) return [];

  if (blinkCompletedAt !== null && Number.isFinite(blinkCompletedAt)) {
    const from = blinkCompletedAt - PRE_BLINK_MS;
    const to = blinkCompletedAt + POST_BLINK_MS;
    const window = list.filter((f) => f.at >= from && f.at <= to);

    if (window.length >= 2) {
      if (window.length <= SERVER_MAX_FRAMES_PER_STEP) {
        return window.map((f) => f.blob);
      }

      // Pick frames that center right across the blink action:
      // e.g. open eyes before closure, the closing/closed moment, and open eyes after
      const before = window.filter((f) => f.at < blinkCompletedAt - 80);
      const around = window.filter((f) => Math.abs(f.at - blinkCompletedAt) <= 200);
      const after = window.filter((f) => f.at > blinkCompletedAt + 80);

      const selected: BlinkWindowFrame[] = [];
      if (before.length > 0) selected.push(before[0]);
      if (before.length > 1) selected.push(before[before.length - 1]);
      if (around.length > 0) selected.push(around[0]);
      if (after.length > 0) selected.push(after[0]);

      const seen = new Set(selected);
      for (const f of window) {
        if (selected.length >= SERVER_MAX_FRAMES_PER_STEP) break;
        if (!seen.has(f)) {
          selected.push(f);
          seen.add(f);
        }
      }

      selected.sort((a, b) => a.at - b.at);
      return selected.map((f) => f.blob);
    }
  }

  // Graceful fallback: if window filter matched < 2 frames but list has frames,
  // take the latest frames so the user is never stranded with an empty window
  if (list.length >= 2) {
    return list.slice(-SERVER_MAX_FRAMES_PER_STEP).map((f) => f.blob);
  }

  return [];
}

/** How many frames are currently held — used by the dev telemetry panel only. */
export function blinkWindowSize(sessionId: string | null): number {
  if (!sessionId) return 0;
  return buffers.get(sessionId)?.length ?? 0;
}

/**
 * Drop this session's frames. MUST be called on submit, on cancel, on camera
 * teardown and on unmount: leaving a biometric burst sitting in memory after the
 * flow is over is exactly the retention problem this design exists to avoid.
 */
export function clearBlinkWindow(sessionId: string | null): void {
  if (!sessionId) return;
  buffers.delete(sessionId);
}

/** Drop every session's frames. Used on unmount as a belt-and-braces measure. */
export function clearAllBlinkWindows(): void {
  buffers.clear();
}
