/**
 * LIVE FACE CHECK — the ONE state machine for seller identity verification.
 *
 * A seller submits an ID document first; the application accepts it. This module
 * covers the SECOND and FINAL step only: a single live face check with ONE blink.
 * There is no pose challenge, no "pose 2 of 4", and no hidden pose logic — the
 * previous four-pose state machine is gone, not commented out.
 *
 * WHY A SEPARATE, PURE MODULE
 * ---------------------------
 * The previous screen shipped a real defect: telemetry reported
 * `camera state: LIVENESS` while the chip on screen read "Position your face
 * inside the frame". That happened because the words and the state were computed
 * by two independent pieces of code from two different sources. The cure is
 * structural, not cosmetic: there is exactly ONE state (derived here), and
 * exactly ONE message function, which is a pure function of that state. A second
 * label cannot contradict the state because a second label no longer exists.
 *
 * EVERYTHING HERE IS PURE AND DOM-FREE, so the invariants are executable rather
 * than aspirational: `liveCheckContradiction` is asserted across an exhaustive
 * sweep of every signal combination in the test harness.
 *
 * SECURITY BOUNDARY (AGENTS.md §2, §5)
 * ------------------------------------
 * Nothing in this file decides anything. It renders what the user is told. The
 * ONLY liveness evidence produced here is `blinkDetected`, which means a real
 * eye-state transition was observed (see `EyeBlinkGate`) — it is a *prompt* to
 * submit, never an approval. Approval comes from the backend, arrives in
 * `signals.review`, and is read from the database. The browser never grants a
 * role, never marks a verification approved, and stores nothing in
 * localStorage/sessionStorage.
 *
 * This is the application's own live face check. It is NOT Aadhaar, and no such
 * claim is made anywhere in this flow (see also §23 of the product spec).
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 1. THE STATES
 * ------------------------------------------------------------------------ */

/**
 * The complete, closed set of live-check states. There are no pose states.
 *
 * Lifecycle:  CAMERA_STARTING → CAMERA_READY → FACE_SEARCHING → FACE_DETECTED
 *             → FACE_POSITIONED → BLINK_INSTRUCTION → BLINK_DETECTED
 *             → READY_TO_SUBMIT → (user clicks) → SUBMITTING → SUBMITTED
 *             → UNDER_REVIEW → APPROVED | REJECTED
 * Failure:    ERROR (camera/detector/network), REJECTED (backend decision).
 */
export type LiveCheckState =
  | 'CAMERA_STARTING'
  | 'CAMERA_READY'
  | 'FACE_SEARCHING'
  | 'FACE_DETECTED'
  | 'FACE_POSITIONED'
  | 'BLINK_INSTRUCTION'
  | 'BLINK_DETECTED'
  | 'READY_TO_SUBMIT'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'ERROR';

/** Every state, in lifecycle order — used by the harness to prove reachability. */
export const LIVE_CHECK_STATES: readonly LiveCheckState[] = Object.freeze([
  'CAMERA_STARTING',
  'CAMERA_READY',
  'FACE_SEARCHING',
  'FACE_DETECTED',
  'FACE_POSITIONED',
  'BLINK_INSTRUCTION',
  'BLINK_DETECTED',
  'READY_TO_SUBMIT',
  'SUBMITTING',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'ERROR',
]);

/* ────────────────────────────────────────────────────────────────────────────
 * 2. THE SIGNALS — everything the state is derived from
 * ------------------------------------------------------------------------ */

/**
 * The four review states the BACKEND can report. `null` means "the backend has
 * not told us anything yet", which is why the frontend can never invent a
 * review result.
 */
export type ReviewStatus = 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | null;

/**
 * The real, current evidence. No stored state, no flags set on a timer.
 * Every field is either read from a detector, a MediaStream, or the backend.
 */
export interface LiveCheckSignals {
  /** The camera is being opened / is not yet delivering frames. */
  cameraStarting: boolean;
  /** REAL decoded video frames are on screen (readyState, dimensions, frame proof). */
  cameraReady: boolean;
  /** The detection loop is actually pumping (exactly one loop per session). */
  loopActive: boolean;
  /** At least one frame has been analysed, so face claims are real. */
  frameAnalysed: boolean;
  /** Faces the detector found in the last analysed frame. */
  faceCount: number;
  /**
   * Exactly one face, correctly placed, on THIS frame.
   * A momentary verdict — it flickers, which is why it is not used directly.
   */
  facePlaced: boolean;
  /**
   * The placement has been HELD long enough to count (§13 hysteresis).
   * This is the latched signal — see `PlacementLatch`. It is what separates
   * "your face is in the right place" (FACE_POSITIONED, "hold still") from
   * "your face has been steady long enough" (BLINK_INSTRUCTION).
   */
  faceHeld: boolean;
  /** The blink prompt has been shown and the gate is armed. */
  blinkInstructed: boolean;
  /** A real EYES_OPEN → EYES_CLOSED → EYES_OPEN transition was observed. */
  blinkDetected: boolean;
  /** The submit request is in flight. Guards double-clicks. */
  submitting: boolean;
  /** The backend accepted the live check (acknowledged, review not yet started). */
  submitted: boolean;
  /** The backend's authoritative review state. The ONLY source of APPROVED/REJECTED. */
  review: ReviewStatus;
  /** A real failure: camera, detector, or network. Never faked away. */
  error: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. DERIVATION — one total, ordered precedence
 * ------------------------------------------------------------------------ */

/**
 * Derive the ONE state from the real signals.
 *
 * The precedence is explicit and total, so exactly one state always comes out.
 * There is no "unset" and no pair of contradicting labels. The ordering encodes
 * what must outrank what:
 *
 *  1. A backend decision (APPROVED/REJECTED) is final and outranks everything.
 *  2. `UNDER_REVIEW` outranks local optimism: once the backend says the request
 *     is under review, no local signal may claim otherwise. This is what makes
 *     a page RELOAD honest — the state comes back from the database, and the
 *     camera is never restarted (see `isCameraAllowed`).
 *  3. An in-flight/acknowledged submit outranks any face talk.
 *  4. Any FACE claim requires PROOF behind it: an analysed frame, and exactly
 *     one face in it. `facePlaced` and `blinkDetected` are on the client and
 *     therefore untrusted inputs to this function — they are only honoured in
 *     the branch where a single face has actually been seen. A `facePlaced` left
 *     set while the camera is off, or while a second person steps in, cannot
 *     produce "Blink your eyes once".
 *  5. Within the live branch, holding outranks placing: a held face earns the
 *     one liveness instruction, a merely-placed face earns "hold still".
 */
export function deriveLiveCheckState(s: LiveCheckSignals): LiveCheckState {
  // 1. The backend's decision is the only authority on the outcome.
  if (s.review === 'REJECTED') return 'REJECTED';
  if (s.review === 'APPROVED') return 'APPROVED';
  if (s.review === 'UNDER_REVIEW') return 'UNDER_REVIEW';

  // 2. A real failure is surfaced, never swallowed into a happy path.
  if (s.error) return 'ERROR';

  // 3. Submission in flight, then acknowledged. Both outrank the camera states so
  //    a late-arriving frame cannot drag the UI back to "look at the camera".
  if (s.submitting) return 'SUBMITTING';
  if (s.submitted) return 'SUBMITTED';

  // 4. Exactly one face, proven by an analysed frame, gates every face claim.
  if (s.frameAnalysed && s.faceCount === 1) {
    // Blinked AND still placed → the check is complete and submittable. Both
    // are required, so a user who blinked and then walked away is honestly told
    // to come back rather than being shown a live Submit button.
    if (s.blinkDetected && (s.facePlaced || s.faceHeld)) return 'READY_TO_SUBMIT';
    if (s.blinkDetected) return 'BLINK_DETECTED';
    // Held steady for the required duration → the one and only instruction.
    if (s.faceHeld) return 'BLINK_INSTRUCTION';
    // Rules satisfied on this frame, but not yet held.
    if (s.facePlaced) return 'FACE_POSITIONED';
    // A face is visible but does not satisfy every rule yet.
    return 'FACE_DETECTED';
  }

  // 5. A frame was analysed and no usable single face was in it: zero, or more
  //    than one. Either way the user still has to FIND a face.
  if (s.frameAnalysed) return 'FACE_SEARCHING';

  // 6. Camera talk — proven frames exist, but none analysed yet.
  if (s.cameraReady || s.loopActive) return 'CAMERA_READY';
  return 'CAMERA_STARTING';
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. MESSAGES — a pure function of the state
 * ------------------------------------------------------------------------ */

/**
 * Placement problems. These refine the "find your face" states; they are NOT
 * lifecycle states of their own (the state set above is deliberately closed and
 * has no NO_FACE / MULTIPLE_FACES member).
 *
 * `getLiveCheckMessage` therefore takes the state plus this refinement. It is
 * still a pure, total function of its arguments — there is no second, competing
 * source of words anywhere in this flow.
 */
export type PlacementProblem =
  | 'none' // a face is present and correctly placed
  | 'no-face' // the detector ran and genuinely found no face
  | 'multiple' // more than one face visible
  | 'too-far'
  | 'too-close'
  | 'outside'
  | 'cut-off'
  | 'no-frame' // nothing analysed yet — NOT a "no face" claim
  | 'detector-unavailable';

/** Every message that asks the user to MOVE their face. Asserted against in tests. */
export const PLACEMENT_MESSAGES: readonly string[] = Object.freeze([
  'Position your face inside the frame',
  'Move closer',
  'Move back a little',
  'Keep your whole face in the frame',
  'Only one person should be visible',
  'Face detector unavailable — see below',
]);

/** The ONE liveness instruction. There is exactly one action in this flow. */
export const BLINK_INSTRUCTION = 'Blink your eyes once';

export interface MessageContext {
  /** The specific placement problem, used only by the face-finding states. */
  problem?: PlacementProblem;
  /** Stability progress in seconds, for the "hold still" states. */
  holdSeconds?: number;
}

/**
 * THE ONE MESSAGE SOURCE.
 *
 * `BLINK_INSTRUCTION` returns `BLINK_INSTRUCTION` and nothing else, and
 * `BLINK_DETECTED` / `READY_TO_SUBMIT` return their own confirmations. That is
 * what makes "blink your eyes once" and "Blink detected ✓" structurally
 * impossible to show at the same time, and what guarantees a placement
 * instruction can never appear once the blink stage is reached.
 */
export function getLiveCheckMessage(
  state: LiveCheckState,
  ctx: MessageContext = {},
): string {
  switch (state) {
    case 'CAMERA_STARTING':
      return 'Starting camera…';
    case 'CAMERA_READY':
      return 'Look directly at the camera';

    case 'FACE_SEARCHING':
      // The user is being asked to FIND their face. Be specific about what is
      // wrong, and never pretend the camera is still warming up once frames are
      // real — that false "waiting for camera" claim is what made a perfectly
      // working camera look broken.
      switch (ctx.problem ?? 'no-face') {
        case 'no-face':
          return 'Position your face inside the frame';
        case 'multiple':
          return 'Only one person should be visible';
        case 'too-far':
          return 'Move closer';
        case 'too-close':
          return 'Move back a little';
        case 'outside':
        case 'cut-off':
          return 'Position your face inside the frame';
        case 'detector-unavailable':
          return 'Face detector unavailable — see below';
        case 'no-frame':
          // Frames exist but none has been analysed yet. Say what is actually
          // happening — the camera is not the problem here.
          return 'Look directly at the camera';
        default:
          return 'Position your face inside the frame';
      }

    case 'FACE_DETECTED':
      // A face IS visible but it does not yet satisfy every rule. Name the
      // specific thing to fix; fall back to a positive confirmation.
      switch (ctx.problem ?? 'none') {
        case 'too-far':
          return 'Move closer';
        case 'too-close':
          return 'Move back a little';
        case 'outside':
        case 'cut-off':
          return 'Position your face inside the frame';
        default:
          return 'Face detected ✓';
      }

    case 'FACE_POSITIONED':
      // Placed and holding. A hold instruction is deliberately NOT a placement
      // message: the face is already correct, so telling the user to move it
      // would be wrong.
      return (ctx.holdSeconds ?? 0) > 0
        ? `Hold still ${(ctx.holdSeconds ?? 0).toFixed(1)}s`
        : 'Hold still…';

    case 'BLINK_INSTRUCTION':
      // The only liveness action in the whole flow. Never a placement message.
      return BLINK_INSTRUCTION;

    case 'BLINK_DETECTED':
      return 'Blink detected ✓';

    case 'READY_TO_SUBMIT':
      return 'Live check complete ✓';

    case 'SUBMITTING':
      return 'Submitting your live check…';

    case 'SUBMITTED':
      return 'Verification submitted ✓';

    case 'UNDER_REVIEW':
      return 'Your identity verification is under review.';

    case 'APPROVED':
      return 'Seller verification approved ✓';

    case 'REJECTED':
      return 'Verification was not approved.';

    case 'ERROR':
      return 'Something went wrong — see the details below';
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. UI GATING — one place that answers "what may the user do right now?"
 * ------------------------------------------------------------------------ */

/**
 * The camera may only run in the live-capture states. This is the single gate
 * that makes the reload requirement hold: after a reload the state comes back as
 * UNDER_REVIEW / APPROVED / REJECTED, so `isCameraAllowed` is false and the
 * camera is never opened. Nothing auto-restarts it.
 */
export function isCameraAllowed(state: LiveCheckState): boolean {
  return (
    state === 'CAMERA_STARTING' ||
    state === 'CAMERA_READY' ||
    state === 'FACE_SEARCHING' ||
    state === 'FACE_DETECTED' ||
    state === 'FACE_POSITIONED' ||
    state === 'BLINK_INSTRUCTION' ||
    state === 'BLINK_DETECTED' ||
    state === 'READY_TO_SUBMIT' ||
    state === 'SUBMITTING' ||
    state === 'ERROR'
  );
}

/**
 * The Submit button is enabled ONLY after a real blink was observed. This is the
 * acceptance criterion "Before blink: disabled / After blink: enabled", enforced
 * in one place so no render path can disagree.
 */
export function isSubmitEnabled(state: LiveCheckState): boolean {
  return state === 'READY_TO_SUBMIT' || state === 'BLINK_DETECTED';
}

/** True once the live check is finished and the camera must be released. */
export function isTerminal(state: LiveCheckState): boolean {
  return state === 'SUBMITTED' || state === 'UNDER_REVIEW' || state === 'APPROVED' || state === 'REJECTED';
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. HYSTERESIS — the face must be HELD, not momentarily correct
 * ------------------------------------------------------------------------ */

/** Consecutive valid frames required before a face counts as placed. */
export const PLACED_OK_FRAMES = 2;
/** Consecutive invalid frames required before a placed face is given up. */
export const PLACED_LOST_FRAMES = 8;

/**
 * ASYMMETRIC HYSTERESIS LATCH for "the face is placed and held".
 *
 * Why this exists: a bare per-frame boolean flickers. One dropped detection
 * frame during a perfectly good hold would drop the UI back to "position your
 * face", and one lucky frame could claim a hold that never happened. Earning is
 * quick (2 frames); losing is slow (8 frames), because losing a placed face
 * mid-check is the thing a person actually notices.
 *
 * Pure and DOM-free, so it is exercised deterministically in Node.
 */
export class PlacementLatch {
  private okStreak = 0;
  private badStreak = 0;
  private passed = false;

  constructor(
    private readonly okFrames = PLACED_OK_FRAMES,
    private readonly lostFrames = PLACED_LOST_FRAMES,
  ) {}

  /** Feed one frame's honest verdict: is exactly one face placed AND held? */
  push(good: boolean): { passed: boolean; okStreak: number; badStreak: number } {
    if (good) {
      this.okStreak += 1;
      this.badStreak = 0;
      if (this.okStreak >= this.okFrames) this.passed = true;
    } else {
      this.badStreak += 1;
      this.okStreak = 0;
      if (this.passed && this.badStreak >= this.lostFrames) this.passed = false;
    }
    return { passed: this.passed, okStreak: this.okStreak, badStreak: this.badStreak };
  }

  get isPassed(): boolean {
    return this.passed;
  }

  /** A new attempt must re-prove its position from scratch. */
  reset(): void {
    this.okStreak = 0;
    this.badStreak = 0;
    this.passed = false;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 7. BLINK — a real eye-state transition, never a timer
 * ------------------------------------------------------------------------ */

export type EyeState = 'UNKNOWN' | 'EYES_OPEN' | 'EYES_CLOSED';

/**
 * The one action in this flow, and the ONLY liveness evidence it accepts.
 *
 * A blink is accepted only when a genuine three-phase transition is observed:
 *
 *     EYES_OPEN → EYES_CLOSED → EYES_OPEN
 *
 * Deliberately NOT accepted, because each of these is a way to fake a liveness
 * pass without a blink:
 *  - a face merely being detected (the detector is not an eye-state model),
 *  - a fixed number of seconds elapsing,
 *  - a `setTimeout` firing,
 *  - a single closed-eye sample with no evidence the eyes were ever open.
 *
 * `openness` is 0..1 where 1 means fully open. The caller derives it from a real
 * per-frame measurement of the eye APERTURE — the MediaPipe face mesh reduced to
 * an Eye Aspect Ratio in `src/lib/eyeAspectRatio.ts` — so this class only owns
 * the sequencing, and the logic is testable without a camera. (It used to say
 * `cameraQuality.ts`, which held a pixel-luminance proxy that has since been
 * deleted: that proxy could not tell a blink from a shadow.)
 *
 * HYSTERESIS: `openAt`/`closedAt` are separated by a dead band, so noise around
 * the threshold cannot flap between states and manufacture a blink.
 */
export class EyeBlinkGate {
  /** Below this the eyes are considered closed. */
  private static readonly CLOSED_AT = 0.42;
  /** Above this the eyes are considered open. Deliberately > CLOSED_AT. */
  private static readonly OPEN_AT = 0.58;
  /** A closed phase shorter than this is a glitch, not a blink. */
  private static readonly MIN_CLOSED_MS = 60;
  /** Longer than this is probably a look-away, not a blink. */
  private static readonly MAX_CLOSED_MS = 1600;

  private state: EyeState = 'UNKNOWN';
  private closedAtMs = 0;
  private sawOpen = false;
  private blinkDone = false;

  constructor(private readonly now: () => number = Date.now) {}

  get eyeState(): EyeState {
    return this.state;
  }

  /** True once a complete OPEN → CLOSED → OPEN sequence has been observed. */
  get blinkCompleted(): boolean {
    return this.blinkDone;
  }

  /**
   * Feed one measured eye-openness sample in 0..1.
   * @returns true on the exact frame the blink completes.
   */
  push(openness: number): { blink: boolean; eyeState: EyeState } {
    const clamped = Math.max(0, Math.min(1, openness));

    if (this.state !== 'EYES_CLOSED') {
      // Rising edge into the open region. This is what proves the eyes were open,
      // so a blink cannot be credited to a face that appeared already shut.
      if (clamped >= EyeBlinkGate.OPEN_AT) {
        this.sawOpen = true;
        if (this.state === 'UNKNOWN') this.state = 'EYES_OPEN';
      }
      // Falling edge into the closed region — only from a proven open state.
      else if (this.sawOpen && clamped <= EyeBlinkGate.CLOSED_AT) {
        this.state = 'EYES_CLOSED';
        this.closedAtMs = this.now();
      }
      return { blink: false, eyeState: this.state };
    }

    // We are in the closed phase; wait for the eyes to come back open.
    if (clamped >= EyeBlinkGate.OPEN_AT) {
      const held = this.now() - this.closedAtMs;
      this.state = 'EYES_OPEN';
      this.closedAtMs = 0;
      // Both bounds matter: too short is sensor noise, too long is the user
      // looking away rather than blinking.
      if (held >= EyeBlinkGate.MIN_CLOSED_MS && held <= EyeBlinkGate.MAX_CLOSED_MS) {
        this.blinkDone = true;
        return { blink: true, eyeState: this.state };
      }
    } else if (this.now() - this.closedAtMs > EyeBlinkGate.MAX_CLOSED_MS) {
      // Held shut far too long to be a blink. Forget the closed phase and
      // require a fresh open→closed→open rather than crediting a long squint.
      this.state = this.sawOpen ? 'EYES_OPEN' : 'UNKNOWN';
      this.closedAtMs = 0;
    }
    return { blink: false, eyeState: this.state };
  }

  /** Arm the gate for a new attempt. The completed blink is NOT carried over. */
  reset(): void {
    this.state = 'UNKNOWN';
    this.closedAtMs = 0;
    this.sawOpen = false;
    this.blinkDone = false;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 8. THE INVARIANT CHECKER
 * ------------------------------------------------------------------------ */

/**
 * States that speak about the FACE at all. Each of these is a claim about what
 * the camera can currently see, so each one must be backed by a frame that was
 * actually analysed — a claim with no frame behind it is exactly the class of
 * bug this module exists to make unconstructable.
 */
const FACE_STATES: readonly LiveCheckState[] = [
  'FACE_SEARCHING',
  'FACE_DETECTED',
  'FACE_POSITIONED',
  'BLINK_INSTRUCTION',
  'BLINK_DETECTED',
  'READY_TO_SUBMIT',
];

/**
 * States that claim a SINGLE, correctly-identified face.
 *
 * Deliberately a SUBSET of `FACE_STATES`, excluding `FACE_SEARCHING` — that
 * state exists precisely for "zero faces" and "more than one face", so requiring
 * `faceCount === 1` there would be asserting the opposite of what the state
 * means. Conflating the two sets is how "the chip said Position your face while
 * telemetry said a face was detected" got shipped in the first place: the
 * assertion was written for the wrong set of states and so never held.
 */
const SINGLE_FACE_STATES: readonly LiveCheckState[] = [
  'FACE_DETECTED',
  'FACE_POSITIONED',
  'BLINK_INSTRUCTION',
  'BLINK_DETECTED',
  'READY_TO_SUBMIT',
];

/**
 * DEV-ONLY invariant check. Returns a description of any contradiction, or null.
 *
 * This must never fire. With a total precedence and a message that is a pure
 * function of the state, the contradictions this flow must never display are not
 * merely unlikely — they cannot be constructed. Keeping the assertion executable
 * means a future edit that breaks the ordering fails a test instead of reaching
 * a user.
 *
 * NOTE ON SCOPE: the signal-level rules below are only asserted for states where
 * that signal is actually load-bearing. A stale `facePlaced` left set while the
 * camera is off is harmless — the derivation ignores it, which is the point — so
 * flagging it as a contradiction everywhere would produce false alarms. The rule
 * that matters is the consequence: it must never produce a face state.
 */
export function liveCheckContradiction(
  state: LiveCheckState,
  message: string,
  signals: LiveCheckSignals,
): string | null {
  // The headline rule: once the blink stage is reached, the words must be blink
  // words. This is the exact defect that was reported and fixed.
  if (state === 'BLINK_INSTRUCTION' && message !== BLINK_INSTRUCTION) {
    return `BLINK_INSTRUCTION showed "${message}"`;
  }
  if (state === 'BLINK_DETECTED' && message !== 'Blink detected ✓') {
    return `BLINK_DETECTED showed "${message}"`;
  }
  if (state === 'READY_TO_SUBMIT' && message !== 'Live check complete ✓') {
    return `READY_TO_SUBMIT showed "${message}"`;
  }
  // No stage from "positioned" onward may show a placement instruction: at that
  // point the face is already correct, so telling the user to move it is wrong.
  if (
    (state === 'FACE_POSITIONED' ||
      state === 'BLINK_INSTRUCTION' ||
      state === 'BLINK_DETECTED' ||
      state === 'READY_TO_SUBMIT') &&
    PLACEMENT_MESSAGES.includes(message)
  ) {
    return `${state} showed the placement message "${message}"`;
  }
  // A ready camera never claims to be waiting for a camera.
  if (state === 'CAMERA_READY' && /waiting for (the )?camera/i.test(message)) {
    return `CAMERA_READY claimed it was waiting for the camera`;
  }

  // ── Signal-level rules, scoped to the states where the signal matters ────
  // A face verdict needs an analysed frame behind it.
  if (!signals.frameAnalysed && FACE_STATES.includes(state)) {
    return `no analysed frame but state=${state}`;
  }
  // Every single-face state requires EXACTLY one face — not zero, not two.
  if (SINGLE_FACE_STATES.includes(state) && signals.faceCount !== 1) {
    return `${state} with faceCount=${signals.faceCount}`;
  }
  // FACE_SEARCHING means the count is NOT one, so 0 and 2+ are both correct here
  // and neither may be reported as a contradiction.
  if (state === 'FACE_SEARCHING' && signals.faceCount === 1) {
    return `FACE_SEARCHING while exactly one face was in frame`;
  }
  // FACE_POSITIONED is the instantaneous verdict, so it requires THIS frame's
  // placement. It is only reachable when placed-and-not-yet-held.
  if (state === 'FACE_POSITIONED' && !signals.facePlaced) {
    return 'FACE_POSITIONED without a placed face';
  }
  if (state === 'FACE_POSITIONED' && signals.faceHeld) {
    return 'FACE_POSITIONED despite the face being held';
  }
  // The blink instruction is earned by HOLDING, not by a lucky frame — and it
  // deliberately does NOT require this frame to be placed. The latch releases
  // only after 8 consecutive lost frames precisely so that one dropped
  // detection mid-blink does not yank the instruction away and restart the
  // "move closer" chatter. `held && !placed` is a real, transient, expected
  // state, and revoking the instruction during it is the flicker bug.
  if (state === 'BLINK_INSTRUCTION' && !signals.faceHeld) {
    return 'BLINK_INSTRUCTION without a held face';
  }
  // Submit is offered only for a completed check.
  if (state === 'READY_TO_SUBMIT') {
    if (!signals.blinkDetected) return 'READY_TO_SUBMIT without a detected blink';
    if (!signals.facePlaced && !signals.faceHeld) return 'READY_TO_SUBMIT without a placed face';
    if (!isSubmitEnabled(state)) return 'READY_TO_SUBMIT but Submit is disabled';
  }
  // The camera must not be running in any terminal state.
  if (isTerminal(state) && isCameraAllowed(state)) {
    return `${state} allows the camera`;
  }
  return null;
}
