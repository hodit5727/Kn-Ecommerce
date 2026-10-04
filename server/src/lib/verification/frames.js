/**
 * In-memory store for live-capture frames during an ACTIVE verification
 * session (spec §11 — "Do not store raw biometric information
 * unnecessarily"; §17 — short-lived verification sessions).
 *
 * Design:
 *   - Frames exist ONLY in server RAM, are keyed by the verification session
 *     id (which is itself bound to a user), and are automatically dropped
 *     when the session expires or completes.
 *   - Bounded: max sessions, max frames per session, per-frame byte cap,
 *     TTL. Old entries are evicted on access (no timers needed).
 *   - Nothing here is ever written to Supabase, logs, or disk.
 */
const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_MAX_FRAMES = 24; // 3 steps × 4 frames + slack
const DEFAULT_FRAME_BYTES = 800 * 1024; // 800 KB per frame (frontend sends ≤ 640px JPEGs)
const DEFAULT_TTL_MS = 20 * 60 * 1000; // 20 min — covers the 15-min session + compare step

/**
 * Bounded, TTL'd in-memory frame cache. Instances are created per app
 * (per process) so tests get isolated state.
 */
export class FrameCache {
  constructor(opts = {}) {
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxFrames = opts.maxFrames ?? DEFAULT_MAX_FRAMES;
    this.frameBytes = opts.frameBytes ?? DEFAULT_FRAME_BYTES;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    /** sessionId → { expiresAt, frames: [{ step, bytes, mime, capturedAt }] } */
    this.sessions = new Map();
  }

  /** Drop everything (used between tests / on shutdown). */
  clear() {
    this.sessions.clear();
  }

  _live(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    return entry;
  }

  /** Start (or extend) a frame collection window for a session. */
  begin(sessionId, ttlMs = this.ttlMs) {
    this._evict();
    const existing = this._live(sessionId);
    if (existing) {
      existing.expiresAt = Date.now() + ttlMs;
      return existing;
    }
    const entry = { expiresAt: Date.now() + ttlMs, frames: [] };
    this.sessions.set(sessionId, entry);
    this._evict();
    return entry;
  }

  /**
   * Add one captured frame. Returns false when the session is unknown/expired
   * or the frame/session bounds would be exceeded (caller then rejects the
   * step request — the attempt just did not register).
   */
  add(sessionId, { step, bytes, mime, capturedAt = new Date().toISOString() }) {
    const entry = this._live(sessionId);
    if (!entry) return false;
    if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0 || bytes.byteLength > this.frameBytes) {
      return false;
    }
    const stepFrames = entry.frames.filter((f) => f.step === step);
    if (entry.frames.length >= this.maxFrames || stepFrames.length >= 4) return false;
    entry.frames.push({ step, bytes, mime, capturedAt });
    return true;
  }

  /** Frames captured so far for a session (empty when unknown/expired). */
  framesFor(sessionId) {
    return this._live(sessionId)?.frames ?? [];
  }

  /**
   * Atomically retrieve AND drop every frame captured for `step` (used when
   * a step burst is finalized — the server keeps no frames between requests).
   * Returns [] when the session is unknown/expired.
   */
  take(sessionId, step) {
    const entry = this._live(sessionId);
    if (!entry) return [];
    const taken = entry.frames.filter((f) => f.step === step);
    entry.frames = entry.frames.filter((f) => f.step !== step);
    return taken;
  }

  /** Remove a session immediately (on COMPLETED / REVOKED — spec §11). */
  discard(sessionId) {
    this.sessions.delete(sessionId);
  }

  /** Remove the oldest sessions until under the bound. */
  _evict() {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now > entry.expiresAt) this.sessions.delete(id);
    }
    while (this.sessions.size > this.maxSessions) {
      const oldest = [...this.sessions.entries()].sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt,
      )[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
  }

  /** Number of live sessions (test/diagnostic helper). */
  size() {
    this._evict();
    return this.sessions.size;
  }
}

export const createFrameCache = (opts) => new FrameCache(opts);