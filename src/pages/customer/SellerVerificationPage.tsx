/**
 * Seller identity + face verification (KYC) — one live face check, one blink,
 * one submit.
 *
 * THE FLOW, AND WHY IT IS THIS SHAPE
 * ----------------------------------
 * The previous flow walked a four-pose sequence (look straight, blink, turn
 * left, turn right) with a 3·2·1 countdown per pose and a burst of frames per
 * pose. That is gone — not deprecated, gone. Its removal was not cosmetic: the
 * pose counter, the countdown and the placement chip were three independent
 * descriptions of one moment, and they disagreed (the reported symptom was a
 * liveness label sitting next to "Position your face inside the frame"). What
 * replaces them is ONE derivation (src/lib/liveFaceCheck.ts) with a total
 * precedence, so a state and its message cannot come apart.
 *
 * Security design (AGENTS.md §2 / §3):
 * - The BACKEND decides every outcome. This page NEVER submits a verdict,
 *   score, status or role — only consent, an ID document kind, a session id and
 *   raw frames. It renders whatever the backend returns and nothing more.
 * - THERE IS NO AUTOMATIC APPROVAL. `/complete` can only return
 *   MANUAL_REVIEW / UNDER_REVIEW; the similarity score and liveness verdict stay
 *   on the server for a human. The UI says "review expected within 24 hours",
 *   which is an expectation, never a promise, and never an Aadhaar or
 *   government-authentication claim.
 * - No localStorage/sessionStorage anywhere. The session is an HttpOnly cookie
 *   handled by apiRequest.
 * - Camera frames live only in memory. The blink-window ring buffer
 *   (src/lib/blinkWindow.ts) is a bounded in-memory `Map` that is cleared on
 *   submit, cancel and camera teardown, and is never written to any
 *   persistence layer.
 * - Success screens (approved / under-review / rejected) are shown ONLY from a
 *   backend response; 503 (provider disabled), 410 (session expired) and real
 *   errors get their own honest screens.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../context/ToastContext';
import { verificationService } from '../../services/verificationService';
import { ApiError } from '../../api/http';
import {
  blinkWindowSize,
  clearAllBlinkWindows,
  clearBlinkWindow,
  pushBlinkWindowFrame,
  takeBlinkWindow,
} from '../../lib/blinkWindow';
import {
  EyeBlinkGate,
  deriveLiveCheckState,
  getLiveCheckMessage,
  isCameraAllowed,
  isSubmitEnabled,
  isTerminal,
  liveCheckContradiction,
} from '../../lib/liveFaceCheck';
import type {
  LiveCheckSignals,
  LiveCheckState,
  PlacementProblem,
  ReviewStatus,
} from '../../lib/liveFaceCheck';
import type {
  CaptureStep,
  FaceFrameResponse,
  IdDocumentKind,
  VerificationState,
} from '../../types/verification';

/**
 * How long the face must be HELD before the blink is asked for.
 *
 * This is the only duration in the flow, and it is a real requirement measured
 * against real frames: `StabilityGate` advances only while a single face
 * satisfies every placement rule, and the `PlacementLatch` must then survive a
 * further asymmetric window. It is not a countdown and not a timer — no
 * `setTimeout` can advance it, and dropping frames slows it rather than
 * skipping it. Shown to the user as "Hold still N.Ns".
 */
const PLACEMENT_HOLD_SECONDS = 2;

/**
 * Translate the guide's own status vocabulary into the placement vocabulary the
 * live-check state machine reports.
 *
 * An explicit total map rather than a cast, because the two sets genuinely
 * differ and the differences carry meaning:
 *
 * - `ok` → `none`. A satisfied placement rule is not a problem, and the state
 *   machine — not the guide — decides whether anything is worth reporting.
 * - `no-frame` → `none`. Nothing has been analysed yet, so there is no face
 *   verdict to report. This is the distinction that stops the UI saying "no face
 *   detected" during every warm-up, and it must not be flattened into `no-face`.
 * - `too-small` → `too-far`. The guide measures the face box; the user-facing
 *   problem is distance. Same fact, one word of vocabulary apart.
 *
 * Every remaining status maps to the identically-named problem, and the `never`
 * arm makes a future guide status a compile error rather than a silently
 * unreported problem.
 */
function toPlacementProblem(status: FaceGuideStatus): PlacementProblem {
  switch (status) {
    case 'ok':
    case 'no-frame':
      return 'none';
    case 'no-face':
      return 'no-face';
    case 'multiple':
      return 'multiple';
    case 'too-small':
      return 'too-far';
    case 'too-close':
      return 'too-close';
    case 'outside':
      return 'outside';
    case 'cut-off':
      return 'cut-off';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/** Why the camera could not be started — mapped to honest, specific UI copy. */
type CameraFailureReason =
  | 'unsupported' // browser/context without getUserMedia (e.g. non-secure, WebView)
  | 'denied' // user blocked camera permission
  | 'not-found' // no camera device found
  | 'in-use' // another app holds the camera
  | 'black-preview' // stream opened but never rendered real frames to <video>
  | 'no-camera'
  /**
   * The live check is already over (submitted, or decided by the server), so
   * there is nothing left to record and the camera must stay closed.
   *
   * This is NOT a hardware or permission problem and must never be presented as
   * one — retrying cannot help, and telling a user their camera is "unavailable"
   * when it is working would be a lie. It gets its own reason so the UI can say
   * the real thing.
   */
  | 'check-already-finished';

/** Camera open result. Failures carry the ORIGINAL DOMException details so the
 *  UI shows the true category — never a generic "frame not ready".
 *  keepAlive=true means the stream was opened+attached but no real frame was
 *  observed yet: the stream stays LIVE and must be re-observed, never re-open. */
type CameraResult =
  | { ok: true; reused?: boolean }
  | {
      ok: false;
      reason: CameraFailureReason;
      errorName?: string; // e.g. NotAllowedError / NotFoundError / NotReadableError
      errorMessage?: string; // the browser's own message
      constraint?: string; // overconstrained setting, when the browser reports it
      keepAlive?: boolean; // stream left live — retry frame observation, do NOT re-open
    };

/** Debug-only telemetry snapshot — text values only, never frame pixels (§10). */
interface CameraTelemetry {
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  streamActive: boolean;
  trackStates: string;
  detector: 'loading' | 'running' | 'ready' | 'error';
  detectorError: string | null;
  faces: number;
  status: string;
  inGuide: boolean;
  areaPct: number;
  /** Seconds the face has been continuously well placed, against the required hold. */
  stableSec: number;
  /** The hold gate has passed, so the blink is now the correct next action. */
  captureReady: boolean;
  // §4/§5 face diagnostics (numbers only, never image data — §20): the model's
  // own detection threshold, and the face size as a fraction of the frame. These
  // are what prove a "No face detected" claim right or wrong.
  //
  // There is deliberately no per-face confidence field. The FaceLandmarker
  // applies its threshold internally and does not expose a score, so reporting
  // one would mean inventing it.
  faceThreshold: number;
  /** The last per-frame model failure, or null — the "no verdict" proof. */
  frameError: string | null;
  /**
   * The last measured eye openness (0 shut .. 1 open), or null.
   *
   * Carried IN the snapshot rather than read from its ref during render: a ref
   * read at render time is not reactive, so the panel would show the first
   * reading forever. Sampled at the panel's 2 Hz, so following a value that
   * changes every frame still costs no per-frame render.
   */
  eyeOpenness: number | null;
  faceWidthRatio: number;
  faceHeightRatio: number;
  previewSize: string; // measured preview box, e.g. "640×480" ('—' if unmeasured)
  guideSize: string; // the oval's normalized size, e.g. "42%×76%" ('—' if unmeasured)
  // Camera-lifecycle instrumentation (dev-only, §19): proves ONE stream, one
  // getUserMedia, one detection loop, and that re-renders never stop the cam.
  gumCalls: number; // getUserMedia() invocations so far
  activeStreams: number; // MediaStreams currently held
  detectionLoops: number; // active detection loops — must be 0 or 1
  renders: number; // component render counter
  trackLive: boolean; // the held stream has a live video track
  streamId: string; // short id of the held stream ('none' if no stream)
  cameraStarting: boolean; // init in-flight flag (proves no double-open)
  // Lifecycle counters (§15) — the full open/stop history at a glance.
  cameraStartAttempts: number;
  cameraSuccessCount: number;
  cameraFailureCount: number;
  cameraStopCount: number;
  streamCreatedCount: number;
  streamDestroyedCount: number;
  videoAttachCount: number;
  videoPlayCount: number;
  videoMetadataCount: number;
  // Environment + last-failure diagnostics (§3/§4/§14) — never hidden.
  secureContext: string; // 'yes' | 'no' | 'n/a'
  mediaDevicesAvailable: boolean;
  gumAvailable: boolean;
  lastError: { name: string; message: string; constraint?: string } | null;
  // Real-frame pipeline (§22): proves whether the <video> is ACTUALLY rendering.
  videoPlaying: boolean; // element present, not paused, media clock > 0
  videoCurrentTime: number; // media clock — must advance for a live stream
  realFrame: boolean; // true ONLY after rVFC fired / currentTime advanced / canvas pixels
  rvfcFired: boolean; // requestVideoFrameCallback fired this session (FIRED / waiting)
  lastStopReason: string; // who stopped the camera last (console.trace proves it)
  // ── §11 SEPARATED camera state. These three NEVER control each other and
  // NONE of them is allowed to start or stop a stream. ──
  cameraActive: boolean; // a live stream is held for the CURRENT camera session
  frameReady: boolean; // a REAL frame was presented this session (monotonic)
  /**
   * TRUE only while a detection is executing inside `evalFrame` — i.e. "a frame
   * is being analysed RIGHT NOW". It is idle between presented frames, which is
   * normal, so it must never be reported as "the loop is dead" (the panel's
   * `detection loop` row reads `detectionLoops`, not this).
   */
  detectionRunning: boolean;
  // ── The DERIVED camera lifecycle — the single truth the panel must show. ──
  cameraState: CameraLifecycleState; // closed|opening|ready|detecting|liveness|capturing|success|closing|error
  cameraMissing: string; // which ready conditions are still missing (dev only)
  /**
   * ALWAYS null. The field is kept only so a stale panel that still expects a
   * countdown shows an explicit "there is no countdown" rather than silently
   * omitting the row. There is no timer in this flow: a countdown is a promise
   * that time alone advances the check, and it does not.
   */
  countdown: number | null;
  /** The one and only liveness action. Never a pose. */
  livenessStep: string;
  verificationState: string; // the wizard phase (document / capture / matching …)
  /**
   * §12 THE ONE STATE the panel must show for the face check. `cameraState` is
   * the CAMERA's state; this is the VERIFICATION's. Reporting only the former is
   * what allowed "camera state: LIVENESS" to sit next to a placement message.
   */
  verifyState: LiveCheckState;
  /** The exact string the user is looking at, so panel and screen cannot drift. */
  verifyMessage: string;
  /** Faces the detector found in the last analysed frame. */
  faceCount: number;
  /** The momentary per-frame placement verdict. */
  facePositionValid: boolean;
  /** The LATCHED verdict — survived the hysteresis window. */
  faceHeld: boolean;
  /** A blink was MEASURED on the client. UX only; the server re-derives it. */
  blinkMeasured: boolean;
  /**
   * Whether this person's open-eye Eye Aspect Ratio baseline has been measured
   * yet. Until it is, no blink can be credited — the openness scale is relative
   * to the baseline, and guessing a baseline would let an open eye read as shut.
   */
  earBaseline: boolean;
  /** `performance.now()` when the blink completed, or null. Anchors the upload. */
  blinkAt: number | null;
  /** Frames currently held in the in-memory blink window (never persisted). */
  bufferedFrames: number;
  /** Whether the Submit button is enabled RIGHT NOW, per the same derivation. */
  submitEnabled: boolean;
  /** Any contradiction the invariant check found (dev only; must stay null). */
  verifyContradiction: string | null;
}

const cameraFailureMessage = (
  reason: CameraFailureReason,
  forDocument: boolean,
  errorName?: string,
  errorMessage?: string,
): string => {
  let base: string;
  switch (reason) {
    case 'denied':
      base = forDocument
        ? 'Camera permission is blocked — allow camera access in your browser and try again, or choose a photo from your device.'
        : 'Camera permission is blocked — allow camera access in your browser, then try again.';
      break;
    case 'not-found':
      base = forDocument
        ? 'No camera was found on this device — please choose a photo from your device instead.'
        : 'No camera was found on this device.';
      break;
    case 'in-use':
      base = 'The camera appears to be in use by another app — close that app and try again.';
      break;
    case 'black-preview':
      base = forDocument
        ? 'The camera opened but no preview is coming through (this happens with some in-app browsers). Try again in a full browser, or choose a photo from your device.'
        : 'The camera opened but no preview is coming through. Try a normal browser (Chrome/Safari) or ensure the camera is not in use by another app.';
      break;
    case 'unsupported':
      base = 'This browser does not allow camera access here — open the site in a full browser window (https or localhost) and try again.';
      break;
    case 'check-already-finished':
      // Honest and specific: nothing is wrong with the camera, and retrying
      // cannot help because there is nothing left to record. Saying "the camera
      // could not be started" here would send the user off to fix permissions
      // that are already fine.
      base =
        'Your live check is already with our review team, so the camera stays closed. Reload this page to see the current status.';
      break;
    default:
      base = forDocument
        ? 'The camera could not be started — please choose a photo from your device instead.'
        : 'The camera could not be started. Please try again.';
  }
  // Dev builds append the exact DOMException so the real cause is never hidden
  // behind generic copy (§3/§4/§14).
  if (import.meta.env.DEV && errorName) {
    return `${base} [${errorName}${errorMessage ? `: ${errorMessage}` : ''}]`;
  }
  return base;
};

/**
 * WHY THERE IS NO `faceChipLabel` FUNCTION IN THIS FILE.
 *
 * The chip text used to be produced here, by a switch that read the guide's
 * `faceStatus` directly — a SECOND, independent decision with no knowledge of
 * anything else on the screen. That is precisely how one screen could read
 *
 *     camera state: LIVENESS
 *     "Position your face inside the frame"
 *
 * at the same time: the liveness flag became true the moment a pose was
 * requested, while this switch still reported the guide's own, not-yet-analysed
 * status. Two sources of truth about one moment, and they disagreed.
 *
 * There is deliberately no text function here any more. Every word on the face
 * screen — the guide chip, the instruction block, the dev panel's `message` row
 * and the `liveness` row — is the SAME string returned by
 * `getLiveCheckMessage(deriveLiveCheckState(signals))` in
 * `src/lib/liveFaceCheck.ts`. One derivation, one message, no second condition
 * that could contradict it.
 */

/** Dev-only telemetry panel — text metrics only, never frame/face data (§10). */
const DebugPanel: React.FC<{ title: string; lines: Array<[string, string]> }> = ({ title, lines }) => {
  if (!import.meta.env.DEV) return null;
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-950/90 text-[10px] font-mono text-emerald-300 p-3 space-y-0.5 leading-relaxed overflow-x-auto">
      <p className="text-stone-400 uppercase tracking-widest text-[9px]">{title} — dev telemetry</p>
      {lines.map(([k, v]) => (
        <p key={k}>
          <span className="text-stone-500">{k}:</span> {v}
        </p>
      ))}
    </div>
  );
};

import { Button } from '../../components/common/Button';
import {
  IDLE_DOC_QUALITY,
  analyzeDocument,
} from '../../lib/cameraQuality';
import type { DocQuality } from '../../lib/cameraQuality';
/**
 * The blink is measured from REAL eye landmarks: the MediaPipe face mesh's eye
 * contour, reduced to an Eye Aspect Ratio with the same six-point formula the
 * backend uses as its authority. See the module headers for why this replaced a
 * pixel-luminance proxy.
 */
import { EyeOpennessTracker, bothEyeAspectRatios } from '../../lib/eyeAspectRatio';
/**
 * ONE vision task for the whole check.
 *
 * It used to be two: a bounding-box FaceDetector for the guide and a separate
 * FaceLandmarker for the blink. But `face_landmarker.task` already contains
 * BlazeFace (byte-identical to `blaze_face_short_range.tflite`, SHA256
 * B4578F35...), so two tasks meant BlazeFace loaded TWICE — two ~9.4 MB WASM
 * runtimes each taking its own WebGL context. The second could not get a context
 * ("the eye-landmark model could not start") and the contention starved the
 * first into reporting `faces: 0` while the camera telemetry was healthy. One
 * task fixes both, and makes it structurally impossible for face detection to
 * break because of the eye model. See the module header.
 */
import {
  MIN_FACE_CONFIDENCE,
  closeFaceLandmarker,
  detectFacesAndEyesNow,
  getFaceLandmarker,
  preloadFaceLandmarker,
} from '../../lib/faceLandmarker';
import {
  FACE_GUIDE_ASPECT,
  FACE_GUIDE_HEIGHT_FRACTION,
  StabilityGate,
  evaluateFaceGuidance,
  faceGuideRect,
} from '../../lib/faceGuide';
import type { FaceGuideStatus } from '../../lib/faceGuide';
import {
  deriveCameraLifecycle,
  illegalCameraTransition,
  isCameraFrameReady,
  missingReadyConditions,
} from '../../lib/cameraLifecycle';
import type { CameraLifecycleState } from '../../lib/cameraLifecycle';
/**
 * The placement LATCH, and the whole live-check state machine it feeds.
 *
 * It answers exactly one question — "has the face been continuously
 * well-placed for long enough" — and it is fed `valid && ready` from the real
 * frame pipeline. Two consecutive good frames earn it; eight consecutive bad
 * frames lose it. The asymmetry is deliberate: a single dropped detection during
 * the blink itself must not revoke the blink instruction and restart the
 * "move closer" chatter.
 *
 * It replaced the old pose-aware latch, and it lives beside the state machine it
 * feeds so the latch's meaning cannot be read without the states it gates.
 */
import { PlacementLatch } from '../../lib/liveFaceCheck';
import type { FaceLandmarker as MediaPipeFaceLandmarker } from '@mediapipe/tasks-vision';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  FileScan,
  Loader2,
  Lock,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Upload,
} from 'lucide-react';

/**
 * UI screens — see inline comments for each state.
 *
 * There is no `matching` phase and no `verified` phase, and their absence is
 * deliberate rather than an oversight:
 *
 * - `matching` existed because the burst was uploaded, then a SECOND request
 *   matched the frames. Now the burst upload and the hand-off to review are one
 *   user action (`submitLiveCheck`), and while that request is in flight the
 *   screen is the capture screen with a spinner — not a separate screen that
 *   could be reached without a capture.
 * - `verified` existed because the backend could approve on a similarity score.
 *   It cannot any more. `/complete` can only return MANUAL_REVIEW, so a
 *   "verified" screen would be a lie the type system is right to refuse. The
 *   approved state is `approved`, entered ONLY from a server response.
 *
 * `finishing` is the honest recovery for the one real gap this design opens: if
 * the burst reached the server but the page died before `/complete` ran, the
 * evidence is on the server and only the transition is missing. The user presses
 * one button to finish it — a write triggered by an explicit click, never an
 * automatic one on page load.
 *
 * `cameraCancelled` is a CAMERA state, not a wizard step: it is reached ONLY by
 * cancelling the live camera check and it keeps the wizard exactly where it was
 * (accepted document, document type, session id). The camera can therefore
 * never rewind the wizard (§4/§6).
 */
type Phase =
  | 'loading' // 1  initial status fetch
  | 'intro' // 2  consent before anything is started
  | 'unavailable' // 3  provider disabled → honest 503 state
  | 'document' // 4  ID photo upload (jpeg/png only)
  | 'documentProcessing' // 5  server analysing the ID photo
  | 'documentAccepted' // 6  ID verified → proceed to face capture
  | 'documentManualReview' // 7  ID needs a human review (terminal)
  | 'documentRejected' // 8  ID rejected (terminal)
  | 'cameraPermission' // 9  request camera access
  | 'capture' // 10 live check: position → blink → submit
  | 'captureFailed' // 11 the burst was not accepted → retry it
  | 'finishing' // 12 burst is on the server, hand-off to review not yet done
  | 'manualReview' // 13 UNDER REVIEW — a human decides (backend confirmed)
  | 'approved' // 14 APPROVED by an administrator (backend confirmed)
  | 'rejected' // 15 REJECTED by an administrator (terminal)
  | 'reverification' // 16 admin requested a fresh attempt cycle
  | 'expired' // 17 verification session expired → restart
  | 'error' // 18 unexpected failure → honest error + retry
  | 'cameraCancelled'; // 19 user cancelled the camera → camera OFF, wizard intact

/**
 * Verification states in which the BACKEND still accepts a brand-new identity
 * document (mirrors the 409 gate in server/src/routes/sellerVerification.js and
 * VERIFICATION_TRANSITIONS in server/src/lib/verification/constants.js). Used
 * only to decide whether "Change document" may be OFFERED — never to decide
 * whether an action is allowed. The backend still validates every request.
 */
const NEW_DOCUMENT_STATES = new Set(['NOT_STARTED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VALIDATING']);

interface SessionContext {
  verificationId: string;
  cycle: number;
  state: VerificationState | null;
  sessionId: string | null;
  /**
   * The server's liveness challenge. Exactly one step, `blink`, and the type
   * makes any other step unrepresentable — so "look left", "look right" and
   * "look straight" cannot be reintroduced here even by accident.
   */
  challenge: CaptureStep[];
  /** Steps the server has accepted. Mirrors the server, never decided locally. */
  completedSteps: CaptureStep[];
}

const MAX_ID_FILE_BYTES = 2 * 1024 * 1024; // mirrors the server's 2 MB ID cap
/**
 * Shown while the burst is uploading and the server runs its liveness model.
 *
 * It no longer asks the user to keep their face in the frame, because the
 * camera has already been released by this point — telling someone to hold
 * still for a camera that is off is worse than saying nothing. It also no
 * longer claims a per-frame duration, because there is exactly one submission
 * and the time it takes is the server's business, not a number this page
 * should invent.
 */
const INFERENCE_NOTE =
  'Sending your frames to the server, which is running its liveness and face-matching models. Your camera is already switched off. This usually takes a few seconds.';

export const SellerVerificationPage: React.FC = () => {
  const { showToast } = useToast();

  const [phase, setPhase] = useState<Phase>('loading');
  const [ctx, setCtx] = useState<SessionContext | null>(null);
  /**
   * Live mirror of `ctx` for the render-free teardown paths.
   *
   * `stopCamera` is a `useCallback` with NO dependencies on purpose: the unmount
   * cleanup effect is keyed to it, so any dependency would make every session
   * change produce a new callback and re-fire that cleanup mid-session — the
   * exact stop/restart flicker this file has spent a long time removing. The
   * cost of that discipline is that the callback cannot read `ctx` from a
   * closure, so the session id it needs to drop the right blink window comes
   * from this ref, which is always current.
   */
  const ctxRef = useRef<SessionContext | null>(null);
  ctxRef.current = ctx;

  // Document step
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docKind, setDocKind] = useState<IdDocumentKind>('COLLEGE_ID');
  const [docPreviewUrl, setDocPreviewUrl] = useState<string | null>(null);
  const [consentAgreed, setConsentAgreed] = useState(false);
  // Document camera (photograph the ID with the device camera)
  const [docCaptureOpen, setDocCaptureOpen] = useState(false);
  // LIVE mirror of docCaptureOpen for async guards — async closures capture the
  // stale state value at render time (the "Open camera" button only renders
  // while closed, so `!docCaptureOpen` in the closure is ALWAYS true and killed
  // the just-READY camera right after open). Refs are always current.
  const docCameraOpenRef = useRef(false);
  const [docCameraStarting, setDocCameraStarting] = useState(false);
  // Live guide-frame quality for the document camera (UX only — backend decides).
  const [docQuality, setDocQuality] = useState<DocQuality>(IDLE_DOC_QUALITY);
  const [autoCapturing, setAutoCapturing] = useState(false);
  // Auto-capture is opt-in: it must never surprise-close the camera seconds
  // after opening it (the recurring "2 s then blank" complaint).
  const [docAutoCaptureEnabled, setDocAutoCaptureEnabled] = useState(false);
  const docGoodSinceRef = useRef<number | null>(null);
  const docAutoCaptureFiredRef = useRef(false);
  // Cooldown so a false-positive auto-capture cannot loop (open → fire → close).
  const docAutoCaptureCooldownUntilRef = useRef(0);
  // In-flight lock: openDocCamera must never run twice concurrently — the
  // health monitor can request a reopen while an open is still cascading, and
  // two opens on one <video> fight each other (stream flickering on/off).
  const docOpeningRef = useRef(false);
  // Budget for a ONE-SHOT automatic reopen after a mid-use stream death lives in
  // autoRecoveryUsedRef (shared with the face camera, §13) — a per-flow copy let
  // the two cameras restart each other in a loop.

  // ── document lifecycle (§12) ───────────────────────────────────────────────
  // The furthest verification stage the BACKEND has confirmed, read ONLY from
  // real responses (uploadDocument → state, getStatus/startSession → state,
  // face step result → state). It is NOT persisted and it authorises nothing;
  // its single job is to keep the UI from offering an action the server would
  // refuse with a 409 (i.e. "Change document" after the document is accepted).
  const [serverVerificationState, setServerVerificationState] = useState('');
  const noteServerState = useCallback((state: string | null | undefined) => {
    if (typeof state === 'string' && state) setServerVerificationState(state);
  }, []);

  // Capture / flow state
  const [analyzing, setAnalyzing] = useState(false);
  const [lastError, setLastError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  // Live face-frame guidance (UX only) + blink cue state.
  const [blinkDetected, setBlinkDetected] = useState(false);

  /**
   * Per-person EAR → openness baseline tracker.
   *
   * Holds the rolling window of this user's own open-eye Eye Aspect Ratio, so
   * the "eyes are shut" threshold is a fraction of THEIR baseline rather than a
   * global constant that would be wrong for half the users. Reset per attempt.
   */
  const earOpennessRef = useRef<EyeOpennessTracker>(new EyeOpennessTracker());
  /**
   * The last measured eye openness (0 shut .. 1 wide open) for the dev panel.
   *
   * A REF, not state, and that is load-bearing. This is written on every frame
   * that produces a measurement — 30 to 60 times a second. As React state it
   * re-rendered the whole page at the camera's frame rate, which is exactly the
   * kind of churn that makes a live preview stutter and, worse, lets React swap
   * DOM nodes underneath the detection loop. The dev panel samples it at 2 Hz
   * through the telemetry snapshot, so nothing needs a render per frame.
   *
   * Plain 0..1 only. It is never a landmark, a coordinate or a pixel.
   */
  const eyeOpennessRef = useRef<number | null>(null);
  /**
   * A real failure of the on-device face model, surfaced to the user.
   *
   * This is deliberately NOT a fallback trigger. There is no weaker measurement
   * to fall back to: the old pixel-luminance proxy is gone, so if the model
   * cannot be loaded then no face is detected, no face is guided and no blink
   * can be measured. The honest response is to say the check could not start and
   * offer a retry, not to quietly downgrade the evidence.
   */
  const landmarkerErrorRef = useRef<string | null>(null);
  const [landmarkerError, setLandmarkerError] = useState<string | null>(null);
  /**
   * The RESOLVED vision model, or null while it is still loading.
   *
   * One model serves face detection, the guide and the blink measurement, so
   * there is no second task to fall back on and no way for one of those to fail
   * because the other did.
   *
   * The per-frame path reads this ref and does NOT await the loader. That is
   * deliberate and load-bearing: the WASM bundle is ~9.4 MB plus the mesh
   * weights, so awaiting it inside the frame callback would suspend every frame
   * until the load finished, and then resume all of them in one burst against
   * stale timestamps — freezing the page at exactly the moment the user is
   * holding still for the blink. A frame that arrives before the model is ready
   * produces no verdict at all, which is honest: nothing is claimed about a
   * face or eyes that were not measured.
   */
  const landmarkerRef = useRef<MediaPipeFaceLandmarker | null>(null);
  /**
   * Start (or join) the model load and keep `landmarkerRef` in step.
   *
   * Safe to call from anywhere and as often as needed: `getFaceLandmarker()`
   * is a lazy singleton, so every call joins the SAME in-flight promise rather
   * than starting a second load — which is what guarantees a single WASM runtime
   * and a single WebGL context. A failure is reported once, and never cached, so
   * the Retry button genuinely retries.
   */
  const attachLandmarker = useCallback(() => {
    if (landmarkerRef.current) return;
    void getFaceLandmarker()
      .then((instance) => {
        landmarkerRef.current = instance;
        // A timestamp already spent on a previous model instance would make the
        // very first real detection on THIS instance look like a repeat.
        lastDetectTsRef.current = 0;
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'face verification model unavailable';
        // The ref and the single UI state move together, so the derived
        // lifecycle and the screen can never report different failures.
        landmarkerErrorRef.current = message;
        detectorErrorRef.current = message;
        setLandmarkerError(message);
        // §7: the failure is reported, not hidden. No landmark or frame data is
        // in this log, and no internal model path is shown to the seller — the
        // detail is for the console, the screen gets a plain retry.
        console.error('[SellerVerification] face verification model failed to load', err);
      });
  }, []);

  // ── THE BLINK GATE ───────────────────────────────────────────────────────
  // `EyeBlinkGate` is the ONLY thing in the client that can declare a blink
  // happened, and it does so only on a measured
  // EYES_OPEN → EYES_CLOSED → EYES_OPEN transition with a realistic closed
  // duration. It is not driven by a timer, a frame count, a setTimeout, or the
  // mere presence of a face — see src/lib/liveFaceCheck.ts.
  //
  // What it consumes is a normalised 0..1 openness derived from real eye
  // landmark geometry (see `EyeOpennessTracker`), so "closed" means the lids
  // actually met, not that a rectangle of pixels got brighter.
  const eyeGateRef = useRef<EyeBlinkGate>(new EyeBlinkGate());
  /**
   * `performance.now()` at the instant the blink completed, or null.
   *
   * The blink is over by the time the browser reports it, so the frames that
   * actually contain the closure are already in the past. This is the anchor
   * the upload window is built around; without it the server would receive only
   * post-blink frames and find no blink in them.
   */
  const blinkAtRef = useRef<number | null>(null);
  /** Throttle for the ring buffer: 8 Hz (see the evalFrame call site). */
  const lastBufferedAtRef = useRef(0);
  /**
   * SERIALISER for the ring buffer. `toBlob` is async, so two overlapping
   * conversions would race on the same canvas and could interleave, producing a
   * frame whose pixels belong to a different instant than its timestamp claims.
   * One at a time, and the timestamp is taken when the CONVERSION starts.
   */
  const bufferBusyRef = useRef(false);

  // ── live face-detection pipeline ────────────────────────────────────────────
  // React copies of per-frame detector state, updated at ~10 Hz by the unified
  // detection loop. Refs hold the per-frame truth (validity gates the
  // countdown); the loop effect below owns the refs' mutation.
  // Starts as 'no-frame', NOT 'no-face': until the detector has actually run
  // there is no face verdict to report.
  // The model's verdict and the stability progress live in REFS ONLY.
  //
  // They used to be mirrored into React state as well (`faceStatus`,
  // `faceCount`, `stabilityProgress`) and read by the chip — two representations
  // of one fact, updated from different places, which is precisely how the chip
  // could disagree with the lifecycle. The derived stage reads the refs, so the
  // mirrors were dead weight: kept, they would be a second source of truth that
  // nothing consults. `detectorLoading` is the same story (`detectorLoadingRef`
  // is the one the loop and telemetry use).
  //
  // There is exactly ONE model, so there is exactly ONE error state. It used to
  // be two — `detectorError` and `landmarkerError` — each with its own full-screen
  // overlay, both of which could appear at once and compete for the same screen.
  // `landmarkerError` is now that single state; `detectorErrorRef` remains as the
  // ref the derived lifecycle and telemetry read.
  const [cameraTelemetry, setCameraTelemetry] = useState<CameraTelemetry | null>(null);
  /**
   * RENDER HEARTBEAT ONLY — never read, never a copy of anything.
   *
   * The verification stage is derived from refs, and refs do not schedule
   * renders, so this counter exists purely to make the derivation re-run. It
   * must never be turned back into a place to store a face value: the moment it
   * holds one it becomes a second source of truth, which is exactly the defect
   * this page used to ship.
   */
  const [, setFrameTick] = useState(0);
  /**
   * The hold gate, constructed with the SAME constant the UI reports the hold
   * progress against. `StabilityGate`'s own default happens to be 2000 ms, but
   * relying on that coincidence is how the "Hold still 2.0s" line and the
   * actual gate would silently drift apart if either were ever retuned.
   */
  const stabilityGateRef = useRef<StabilityGate>(
    new StabilityGate(() => performance.now(), 600),
  );
  /**
   * PLACEMENT LATCH — the single precondition for asking the user to blink.
   *
   * It is fed `valid && stable`, so it is a fact about the DETECTOR and not a
   * fact about when a step was requested. That was the original bug: the
   * lifecycle used to trust a flag the code set the instant the camera opened,
   * which is why the screen could report a liveness stage while honestly asking
   * the user to position their face.
   *
   * The latch is deliberately ASYMMETRIC — earned quickly, lost slowly — so a
   * single dropped detection frame during the blink itself cannot retract the
   * instruction and restart the "move closer" chatter.
   */
  const positionLatchRef = useRef<PlacementLatch>(new PlacementLatch());
  /** True once the latch has passed — the honest "the face is HELD". */
  const positioningPassedRef = useRef(false);
  const detectionLoopStartedRef = useRef(false);
  const detectionRunningRef = useRef(false);
  const detectionCancelRef = useRef(false);
  const detectorErrorRef = useRef<string | null>(null);
  const detectorLoadingRef = useRef(false);
  /**
   * The last timestamp handed to the vision task. MediaPipe rejects a repeat,
   * and the frame handler skips the call rather than letting the task throw once
   * per frame — which is how a "no face" claim can be a timestamp bug rather
   * than a measurement.
   */
  const lastDetectTsRef = useRef(0);
  /**
   * The last PER-FRAME failure, or null.
   *
   * This exists because the frame handler used to let a throw escape: the loop
   * kept running and every ref but `faceCountRef` was still being updated, so a
   * frame that died before the count was assigned left the panel reading a stale
   * `faces: 0` with nothing anywhere saying the detector had not actually run.
   * A recorded error is what makes "no face" distinguishable from "no verdict".
   */
  const frameErrorRef = useRef<string | null>(null);
  // Dev-only 1 Hz throttle for the per-frame guide diagnostics (spec §4).
  const lastGuideDebugAtRef = useRef(0);
  const faceValidRef = useRef(false);
  const faceStatusRef = useRef<FaceGuideStatus>('no-frame');
  const faceCountRef = useRef(0);
  const faceAreaRef = useRef(0);
  // The face box as a fraction of the frame, so a "No face detected" claim can be
  // proven or disproven from the panel instead of guessed at (spec §4).
  // NUMBERS ONLY, never frame/face pixels (§20).
  const faceRatioRef = useRef({ w: 0, h: 0 });

  /**
   * HELD — the placement latch's output, as a signal.
   *
   * `faceValidRef` is the momentary per-frame verdict; this is the latched one
   * that has survived the asymmetric hysteresis window. Keeping them as two
   * named signals (rather than one field that changed meaning) is what lets the
   * state machine distinguish "your face is in the right place" (FACE_POSITIONED
   * → "hold still") from "your face has been steady long enough" (the blink
   * instruction). Collapsing them is what let "hold still" and "blink" appear
   * at the same time.
   */
  const faceHeldRef = useRef(false);

  /**
   * THE BACKEND'S REVIEW DECISION, as a derivation input.
   *
   * This is the only input that can produce UNDER_REVIEW / APPROVED / REJECTED,
   * and it is never set optimistically: it is written from a real server
   * response (status fetch, /face result, /complete result) and from nothing
   * else. A reload re-reads it from the database, which is why a reloaded page
   * under review does not restart the camera or ask for another blink.
   */
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(null);
  const reviewStatusRef = useRef<ReviewStatus>(null);
  reviewStatusRef.current = reviewStatus;
  /**
   * When the SERVER recorded entry to review, from `/status`.
   *
   * Read from the database rather than from a `Date.now()` taken when Submit was
   * pressed, because the review clock is the server's: a page opened tomorrow
   * must show the original submission time, and a clock the client controls
   * could show anything at all. A null value simply omits the line — it is
   * never substituted with a guess.
   */
  const [serverSubmittedAt, setServerSubmittedAt] = useState<string | null>(null);

  /** Mirrors for the derivation, read from the hot path without re-rendering. */
  const submittingLiveRef = useRef(false);
  const submittedLiveRef = useRef(false);
  /** Placement-hold progress 0..1, scaled to seconds only when rendering text. */
  const placementProgressRef = useRef(0);

  // ── Camera flip / device switching support ──
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceIndex, setActiveDeviceIndex] = useState(0);
  const activeDeviceIndexRef = useRef(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);


  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The element the guide overlay's percentages resolve against. Detector boxes
  // are mapped through THIS box's real pixels. The loop used to pass a made-up
  // 4×3 "container"; because the preview really is `aspect-[4/3]` that happened
  // to be numerically equivalent, but it silently broke the moment the
  // container aspect was anything else (portrait phone, aspect-video) — the
  // normalized coordinates were then stretched and the guide compared against a
  // rectangle the CSS never drew. Measured, never assumed (spec §4/§5).
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const previewSizeRef = useRef<{ w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // ── camera lifecycle guards: single stream + single init guarantee (§1/§2/§6) ──
  const cameraStartingRef = useRef(false); // one getUserMedia() CALL in flight
  const cameraOpenRef = useRef<Promise<CameraResult> | null>(null); // one open CASCADE
  const cameraSessionRef = useRef(0); // bumped on every stop → invalidates stale opens
  const activeStreamIdsRef = useRef<Set<string>>(new Set()); // dev: held streams
  const gumCallCountRef = useRef(0); // dev: getUserMedia() call count
  const detectionLoopCountRef = useRef(0); // dev: active detection loops (0|1)
  const renderCountRef = useRef(0); // dev: component render counter
  // Lifecycle counters (§15): every open/stop is counted and shown in the panel.
  const cameraStartAttemptsRef = useRef(0);
  const cameraSuccessCountRef = useRef(0);
  const cameraFailureCountRef = useRef(0);
  const cameraStopCountRef = useRef(0);
  const streamCreatedCountRef = useRef(0);
  const streamDestroyedCountRef = useRef(0);
  const videoAttachCountRef = useRef(0);
  const videoPlayCountRef = useRef(0);
  const videoMetadataCountRef = useRef(0);
  const lastCameraErrorRef = useRef<{ name: string; message: string; constraint?: string } | null>(null);
  // Throttle helpers — telemetry/analyzer state is only set when it changes.
  const lastTelemetryJsonRef = useRef('');
  const lastDocQualitySigRef = useRef('');
  // Real-frame pipeline (§21): true ONLY after rVFC / currentTime / canvas proof.
  const realFrameReceivedRef = useRef(false);
  // rVFC fired at least once this session (panel row §22: FIRED / waiting).
  const rvfcFiredRef = useRef(false);
  // The exact <video> node a stream was attached to — detects React remounts
  // that would leave the stream on a stale, disconnected node (§3).
  const attachedVideoRef = useRef<HTMLVideoElement | null>(null);
  // Who stopped the camera last (shown in the panel + console.trace).
  const lastStopReasonRef = useRef<string>('—');
  // Detaches the video event loggers when the stream stops (no leaks).
  const videoEventLoggerCleanupRef = useRef<(() => void) | null>(null);
  // Live mirror of `phase` for the render-free camera loops. Reading state via a
  // ref keeps face/step/verification updates OUT of the camera effect deps
  // (§4/§9) — a step change can therefore never stop or restart the camera.
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  // ── §11 STATE SEPARATION ──────────────────────────────────────────────────
  // A live stream is held for the CURRENT camera session. Flips ON when the
  // stream is opened+attached, OFF only in stopCamera(). Nothing else.
  const [cameraActive, setCameraActive] = useState(false);
  // A REAL video frame was presented this session (§10). Monotonic within a
  // session: a failed detection frame NEVER sets it back to false.
  const [frameReady, setFrameReady] = useState(false);
  // Ref mirrors for the loops — the loops never read React state.
  const cameraActiveRef = useRef(false);
  const frameReadyRef = useRef(false);
  // Cancels THE ONE detection loop and THE ONE health-monitor chain (§16).
  const detectionStopRef = useRef<(() => void) | null>(null);
  const healthStopRef = useRef<(() => void) | null>(null);
  // §13: at most ONE automatic recovery per camera session, plus a cooldown —
  // a dead track must never trigger an automatic restart LOOP.
  const autoRecoveryUsedRef = useRef(false);
  const lastDeathAtRef = useRef(0);
  // Dev: count component renders — proves re-renders never restart the camera.
  renderCountRef.current += 1;
  // The live <video> is rendering real frames for this session (§1/§10). This is
  // a DERIVED read-only value: it can no longer be flipped by any effect, so no
  // state change can tear the camera down.
  const cameraReady = cameraActive && frameReady;
  // Honest message when a started stream dies/freezes mid-use (the "blank" case).
  const [cameraIssue, setCameraIssue] = useState<string | null>(null);

  useEffect(() => {
    if (typeof navigator?.mediaDevices?.enumerateDevices === 'function') {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          const v = devices.filter((d) => d.kind === 'videoinput');
          if (v.length > 0) setVideoDevices(v);
        })
        .catch((err) => console.warn('[SellerCamera] enumerateDevices failed', err));
    }
  }, [cameraActive]);

  /**
   * Ref mirrors of the volatile verification values, so the 500 ms telemetry
   * sampler can read the CURRENT value without listing them as effect
   * dependencies (which would restart the interval and churn renders, §18).
   * Read-only for the sampler; the lifecycle itself still uses the real signals.
   */
  const analyzingRef = useRef(analyzing);
  const cameraIssueRef = useRef(cameraIssue);
  // `blinkDetected` is React state, and the telemetry interval must not re-run
  // on every state change, so it is mirrored here like its siblings.
  const blinkDetectedRef = useRef(blinkDetected);
  useEffect(() => {
    analyzingRef.current = analyzing;
    cameraIssueRef.current = cameraIssue;
    blinkDetectedRef.current = blinkDetected;
  }, [analyzing, cameraIssue, blinkDetected]);

  /**
   * THE SINGLE DERIVATION, callable from anywhere in the component.
   *
   * Both the render path and the 2 Hz telemetry snapshot call this, so the panel
   * and the screen are guaranteed to report the same state from the same
   * evidence. Each used to compute its own version, and the telemetry copy
   * passed a different flag into the lifecycle — which is how the panel came to
   * print a liveness stage while the chip printed a placement instruction.
   *
   * `reviewState` is passed in rather than read from a ref because it is React
   * state owned by the parent render: it comes from the BACKEND, and the backend
   * decision must outrank anything the camera pipeline believes. Because it is a
   * parameter rather than a closure over mutable state, every caller is forced to
   * pass the current value — there is no way to accidentally derive a stage from
   * a stale review state.
   */
  const deriveLiveNow = (
    frameReady: boolean,
    detectionLoopActive: boolean,
    reviewState: ReviewStatus,
  ): {
    state: LiveCheckState;
    message: string;
    signals: LiveCheckSignals;
    contradiction: string | null;
  } => {
    const signals: LiveCheckSignals = {
      cameraStarting: cameraStartingRef.current,
      cameraReady: frameReady,
      loopActive: detectionLoopActive,
      frameAnalysed: faceStatusRef.current !== 'no-frame',
      faceCount: faceCountRef.current,
      facePlaced: faceValidRef.current,
      faceHeld: faceHeldRef.current,
      blinkInstructed: faceHeldRef.current,
      blinkDetected: blinkDetectedRef.current,
      submitting: submittingLiveRef.current,
      submitted: submittedLiveRef.current,
      review: reviewState,
      error: !!cameraIssueRef.current || !!detectorErrorRef.current,
    };
    const state = deriveLiveCheckState(signals);
    // The placement problem is a REFINEMENT of the message, never a state of
    // its own. Keeping it out of the state set is what guarantees the 14 states
    // stay closed and the "positioning" messages cannot leak into a later stage.
    const message = getLiveCheckMessage(state, {
      problem: toPlacementProblem(faceStatusRef.current),
      holdSeconds: placementProgressRef.current * PLACEMENT_HOLD_SECONDS,
    });
    return {
      state,
      message,
      signals,
      contradiction: liveCheckContradiction(state, message, signals),
    };
  };

  /**
   * The same derivation, with the three non-ref inputs supplied from refs.
   *
   * This exists so the ENFORCEMENT paths — the ones that decide whether
   * `getUserMedia` may run at all — consult the identical state machine the
   * screen renders from, instead of re-deriving a "has it been submitted?"
   * boolean of their own. A second such boolean is precisely the class of bug
   * this rewrite exists to remove: it would be a second source of truth about
   * whether the live check is over, and it would drift.
   */
  const deriveLiveNowFromRefs = (): ReturnType<typeof deriveLiveNow> =>
    deriveLiveNow(
      frameReadyRef.current || realFrameReceivedRef.current,
      detectionLoopCountRef.current === 1,
      reviewStatusRef.current,
    );

  /**
   * THE CAMERA GATE.
   *
   * Every path that could open a stream asks this first. It is the enforcement
   * of the rule "the camera must not start after Cancel, Reload, Submit,
   * APPROVED or UNDER_REVIEW" — and it is enforced against the state machine
   * rather than against a hand-maintained list of phases, so adding a terminal
   * state to `liveFaceCheck.ts` cannot leave a camera path behind.
   *
   * It is a refusal with a visible reason, never a silent no-op: a user who
   * reaches it is told the check is already with the review team.
   */
  const cameraIsForbidden = (): boolean => !isCameraAllowed(deriveLiveNowFromRefs().state);

  /**
   * The ONLY place a stream is stopped (§3/§14/§16). Every caller must say WHY
   * so the dev panel and the console trace prove who killed the stream.
   *
   * Contract:
   * - NEVER reached from an effect keyed to face / frame / progress / step /
   *   verification state (§4/§9). Only: Cancel, success, an explicit session
   *   boundary, a one-shot auto-recovery, or real unmount (§3/§14/§15).
   * - IDEMPOTENT. A stop with no live stream still ends the session id (so an
   *   in-flight getUserMedia is discarded, §17) but performs no state churn —
   *   which is what used to flip cameraReady and re-run a camera effect.
   */
  const stopCamera = useCallback((reason: string) => {
    // A stop ALWAYS ends the session id, so a getUserMedia still resolving from
    // this session discards its late stream instead of attaching to a dead
    // session (§17 async race).
    cameraSessionRef.current += 1;
    cameraOpenRef.current = null;
    // Releasing the camera also ends the blink window. Those frames were
    // captured FROM this stream; once it is gone they can never be part of a
    // legitimate upload, so keeping them would be retaining face images for
    // frames that can no longer be sent. Doing it here rather than at each call
    // site means no future teardown path can forget.
    //
    // `ctxRef` is used instead of the `ctx` state because this callback has no
    // dependencies by design — adding `ctx` would make every session change
    // produce a new `stopCamera`, and the unmount cleanup is keyed to it.
    clearBlinkWindow(ctxRef.current?.sessionId ?? null);

    const stream = streamRef.current;
    if (!stream) {
      console.log('[SellerCamera] stop requested with no live stream — no-op', reason);
      return;
    }
    cameraStopCountRef.current += 1;
    lastStopReasonRef.current = reason;
    console.warn('[SellerCamera] STOP CAMERA', reason, { streamId: stream.id });
    console.trace('[SellerCamera] CAMERA STOP CALLED (caller stack)');

    // 1) Halt the ONE detection loop FIRST (§15) so nothing reads a dead stream.
    detectionStopRef.current?.();
    detectionStopRef.current = null;
    // 2) Cancel the ONE health-monitor chain so a stale patrol can never kill the
    //    NEXT session's camera. The old cleanup only cleared a timer, leaving an
    //    immortal self-rescheduling rVFC chain that repeatedly stopped a healthy
    //    camera — the ON → OFF → ON → OFF flicker.
    healthStopRef.current?.();
    healthStopRef.current = null;
    // 3) Detach our monitors, then explicitly release the element so a stopped
    //    stream can never linger or re-attach on a later render.
    const el = videoRef.current;
    if (el && el.srcObject === stream) el.srcObject = null;
    videoEventLoggerCleanupRef.current?.();
    videoEventLoggerCleanupRef.current = null;
    for (const track of stream.getTracks()) {
      console.warn('[SellerCamera] stopping track', track.id, track.kind, track.readyState, reason);
      track.onended = null;
      track.onmute = null;
      track.stop();
    }
    activeStreamIdsRef.current.delete(stream.id);
    streamDestroyedCountRef.current += 1;
    streamRef.current = null;
    attachedVideoRef.current = null;
    // A stop ends the session: the real-frame proof resets and must be earned
    // again by the new stream.
    realFrameReceivedRef.current = false;
    rvfcFiredRef.current = false;
    frameReadyRef.current = false;
    cameraActiveRef.current = false;
    setCameraStream(null);
    setFrameReady(false);
    setCameraActive(false);
  }, []);

  /**
   * §13 The automatic-recovery budget. It is refreshed ONLY by an explicit USER
   * action (Enable Camera / Retry Camera / Start Over) — never by the recovery
   * itself, and never by a plain stop. Otherwise a flapping device could
   * recover, die, and recover again in a tight STOP → START loop, which is
   * exactly the bug being fixed here.
   */
  const grantRecoveryBudget = useCallback(() => {
    autoRecoveryUsedRef.current = false;
    lastDeathAtRef.current = 0;
  }, []);

  /**
   * Reload the on-device face model after an honest load failure.
   *
   * This only clears the failure and lets the loop load it again — it never
   * touches the camera, so a retry cannot produce a second MediaStream. A failed
   * load is never cached, so the next attempt is a real one.
   */
  const retryDetector = useCallback(() => {
    detectorErrorRef.current = null;
    frameErrorRef.current = null;
    landmarkerErrorRef.current = null;
    setLandmarkerError(null);
    landmarkerRef.current = null;
    void closeFaceLandmarker();
    attachLandmarker();
  }, [attachLandmarker]);

  // TRUE unmount only. Deps are stable so this cleanup can NEVER run on a
  // mid-session state change — the previous cleanup was keyed to
  // `docPreviewUrl` and stopped the camera on unrelated updates (a
  // stop/start render-loop source).
  useEffect(() => {
    return () => {
      stopCamera('component-unmount');
      // Release the detection loop + WASM task so nothing outlives the page
      // or leaks streams/callbacks (spec §12). The detector is a MODULE-level
      // singleton, so closing it here (and ONLY here) is what keeps a genuine
      // unmount from leaking the WASM task without paying a reload mid-session.
      detectionStopRef.current?.();
      detectionStopRef.current = null;
      healthStopRef.current?.();
      healthStopRef.current = null;
      // Drop every buffered face frame. The blink window is an in-memory
      // biometric burst, and "the component went away" is the end of its
      // retention window — leaving it in the module map would keep a burst of
      // face JPEGs alive in the tab for as long as the tab is open, which is
      // exactly the unnecessary retention this flow is meant to avoid. Cleared
      // here, on submit, on cancel, and on camera teardown.
      clearAllBlinkWindows();
      // The face model is released on a genuine unmount only. It is a MODULE-level
      // singleton holding ~9.4 MB of WASM plus the mesh weights, and a real
      // unmount is the end of its retention window. A mid-session stop
      // deliberately does NOT close it, because the blink prompt is asked for
      // after the camera is already live and re-loading the model per
      // cancel/retry would be its own stall.
      void closeFaceLandmarker();
      landmarkerRef.current = null;
    };
  }, [stopCamera]);

  /**
   * Rule 2 — STABLE VIDEO ATTACHMENT.
   * Callback ref attaches the active MediaStream whenever the <video> DOM element mounts.
   * Empty dependencies ensure the callback is referentially stable and NEVER invoked on re-renders.
   */
  const attachVideoRef = useCallback((node: HTMLVideoElement | null) => {
    if (!node) return;
    videoRef.current = node;
    const stream = streamRef.current;
    if (stream && node.srcObject !== stream) {
      node.srcObject = stream;
      videoAttachCountRef.current += 1;
      node.muted = true;
      node.autoplay = true;
      node.playsInline = true;
      node.play().catch((error) => {
        console.warn('[SellerCamera] callback ref video.play() failed', error);
      });
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current || cameraStream;
    if (!video || !stream) return;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
      videoAttachCountRef.current += 1;
    }

    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;

    if (video.paused) {
      video.play().catch((error) => {
        console.warn('[SellerCamera] video.play() failed', error);
      });
    }
  }, [cameraStream]);

  // Revoke the replaced/unmounted object URL exactly when it changes/unmounts.
  useEffect(() => {
    return () => {
      if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
    };
  }, [docPreviewUrl]);

  /**
   * Document camera live guide: samples the video at ~6 fps, runs the pure
   * quality analyzer (sharpness / edges / exposure) on the guide-window crop,
   * and paints the green/red frame. UX ONLY — the backend is the authority.
   */
  useEffect(() => {
    if (!(docCaptureOpen && phase === 'document') || !streamRef.current) {
      setDocQuality(IDLE_DOC_QUALITY);
      return;
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const AW = 320;
    const AH = 202;
    canvas.width = AW;
    canvas.height = AH;
    const winW = Math.round(AW * 0.66);
    const winH = Math.round(winW / 1.586); // ID-card aspect
    const interval = window.setInterval(() => {
      const video = videoRef.current;
      // Analysis starts ONLY after the camera is proven live (cameraReady) —
      // never on a speculative/black stream. The analyzer never kills the
      // camera on a bad frame; it only reports quality (§14).
      if (!cameraReady || !video || video.readyState < 2 || video.videoWidth < 2) {
        setDocQuality(IDLE_DOC_QUALITY);
        return;
      }
      // object-cover draw (mirrors the CSS on the <video> element).
      const scale = Math.max(AW / video.videoWidth, AH / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      ctx.drawImage(video, (AW - dw) / 2, (AH - dh) / 2, dw, dh);
      const x = Math.round((AW - winW) / 2);
      const y = Math.round((AH - winH) / 2);
      const img = ctx.getImageData(x, y, winW, winH);
      // faceGuard is armed ONLY with auto-capture — manual capture must not be
      // blocked by a face in the frame (the user decides; the backend validates).
      const quality = analyzeDocument({ data: img.data, width: winW, height: winH }, docAutoCaptureEnabled);
      // Re-render only when the verdict/quality actually changes (§18) — the
      // numeric fields are quantized so a stable scene stops re-rendering.
      const signature = `${quality.verdict}|${quality.good}|${quality.hint}|${Math.round(quality.luma)}|${Math.round(
        quality.sharpness,
      )}|${quality.edgeDensity.toFixed(3)}`;
      if (signature !== lastDocQualitySigRef.current) {
        lastDocQualitySigRef.current = signature;
        setDocQuality(quality);
      }
    }, 400);
    return () => window.clearInterval(interval);
  }, [docCaptureOpen, phase, docCameraStarting, docAutoCaptureEnabled, cameraReady]);

  /** Auto-capture once the document has been good for ~0.7 s (Aadhaar-style). */
  useEffect(() => {
    if (
      docCaptureOpen &&
      phase === 'document' &&
      docQuality.good &&
      docAutoCaptureEnabled &&
      streamRef.current
    ) {
      if (docGoodSinceRef.current === null) docGoodSinceRef.current = Date.now();
      if (
        Date.now() - docGoodSinceRef.current >= 1200 &&
        !docAutoCaptureFiredRef.current &&
        !docCameraStarting &&
        !autoCapturing &&
        Date.now() > docAutoCaptureCooldownUntilRef.current
      ) {
        docAutoCaptureFiredRef.current = true;
        // Never auto-fire again for 15 s — a false positive must not close the
        // camera right after the user opens it (the "blank after 2 s" loop).
        docAutoCaptureCooldownUntilRef.current = Date.now() + 15000;
        setAutoCapturing(true);
        void captureDocPhoto().finally(() => setAutoCapturing(false));
      }
    } else {
      docGoodSinceRef.current = null;
    }
  }, [docQuality, docCaptureOpen, phase, docCameraStarting, autoCapturing, docAutoCaptureEnabled]);

  /**
   * THE single face-detection loop (spec §4/§5/§6/§7/§15/§16).
   *
   * LIFECYCLE CONTRACT (this is the fix — read it before changing anything):
   *   - The loop is bound to the CAMERA SESSION (`cameraActive` only). It is NOT
   *     keyed to `phase`, `cameraReady`, `faceStatus`, `stabilityProgress`,
   *     `currentStep` or any verification state, so none of those can stop it.
   *     The old deps were `[phase, cameraReady]`, so every step change tore the
   *     loop down and reloaded the MediaPipe model over the network.
   *   - It only READS the existing MediaStream. It NEVER calls getUserMedia,
   *     never stops a track, never touches `srcObject`, never recreates <video>.
   *   - Exactly one loop can ever exist: `detectionStopRef` holds the cancel
   *     closure, and both the effect cleanup and stopCamera() call it (it is
   *     idempotent), so there is no path that spawns a second loop.
   *   - Cancelling the loop NEVER closes the detector. The detector is not camera
   *     lifecycle; closing it per-step was the multi-second freeze that read as
   *     flicker. It is closed only on real unmount.
   *   - Per-frame face analysis only runs while `phaseRef.current === 'capture'`
   *     — the loop itself lives for the whole camera session.
   *   - IT HEALS INSTEAD OF DYING. This effect used to `return` early when the
   *     <video> node or the stream was not there yet, and the loop used to
   *     cancel itself for good when React handed it a different node. Since the
   *     effect only re-runs on `cameraActive`, either case left a WORKING camera
   *     with a PERMANENTLY DEAD detection loop — the exact "stream ON / track
   *     LIVE / frame ready YES / detection loop idle" contradiction. The loop now
   *     re-resolves the node every frame, re-measures the preview when the
   *     measurement is missing, and simply WAITS (still exactly one pending
   *     callback) instead of cancelling itself.
   */
  useEffect(() => {
    if (!cameraActive) return undefined;
    if (detectionStopRef.current) return undefined; // exactly one loop, ever

    detectionCancelRef.current = false;
    detectionRunningRef.current = false;
    detectionLoopStartedRef.current = true;
    detectionLoopCountRef.current = 1; // dev: exactly one loop must be active
    // Fresh per-session guidance state — touches NO camera state.
    stabilityGateRef.current.reset();
    positionLatchRef.current.reset();
    positioningPassedRef.current = false;
    faceValidRef.current = false;
    faceStatusRef.current = 'no-frame';
    faceCountRef.current = 0;
    placementProgressRef.current = 0;
    faceAreaRef.current = 0;
    // The blink evidence and the eye baseline are per-attempt, so a fresh
    // camera session starts with none of them. Touches NO camera state.
    blinkDetectedRef.current = false;
    blinkAtRef.current = null;
    eyeGateRef.current.reset();
    earOpennessRef.current.reset();
    landmarkerErrorRef.current = null;
    lastDetectTsRef.current = Math.max(lastDetectTsRef.current || 0, Math.floor(performance.now()));
    frameErrorRef.current = null;
    setBlinkDetected(false);
    eyeOpennessRef.current = null;
    setLandmarkerError(null);
    // Join the load (or an in-flight one) so the model is already running by the
    // time the placement hold finishes. Non-blocking: the loop starts now and
    // simply produces no verdict until the model lands.
    attachLandmarker();
    faceRatioRef.current = { w: 0, h: 0 };
    detectorErrorRef.current = null;

    // NOTE: there is deliberately NO eye-band canvas any more. Blink evidence now
    // comes from MediaPipe FaceLandmarker eye-landmark geometry
    // (src/lib/faceLandmarker.ts + src/lib/eyeAspectRatio.ts), so nothing here
    // samples raw pixels to guess at eye state.

    // §4/§5 Measure the REAL preview box once per resize instead of per frame:
    // a getBoundingClientRect() on every video frame would force a synchronous
    // layout 30–60×/s, and the previous hard-coded 4×3 container made every
    // normalized coordinate wrong. If the box cannot be measured we evaluate
    // nothing — a guess is never allowed to colour the guide.
    let previewObserver: ResizeObserver | null = null;
    let observedPreviewEl: HTMLElement | null = null;
    const measurePreview = () => {
      const el = previewBoxRef.current;
      if (!el || !el.isConnected) return false;
      // Created lazily: the preview box may mount AFTER this effect runs, and a
      // missing observer meant the measurement was never refreshed again.
      // Re-observed only when the element actually changes, so the callback can
      // never feed itself.
      if (el !== observedPreviewEl) {
        if (!previewObserver && typeof ResizeObserver === 'function') {
          previewObserver = new ResizeObserver(() => measurePreview());
        }
        previewObserver?.observe(el);
        observedPreviewEl = el;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) {
        previewSizeRef.current = { w: rect.width, h: rect.height };
        return true;
      }
      return false;
    };
    measurePreview();

    /**
     * RENDER HEARTBEAT — carries no values, only causes a re-render.
     *
     * The stage is derived from refs on every render, and a ref mutation does
     * not schedule one. Something has to re-render for the derivation to be
     * recomputed, or the message would freeze on its first value.
     *
     * This used to be `setFaceStatus`/`setFaceCount`/`setStabilityProgress`:
     * three states that each held a COPY of a ref. That was the duplicate truth
     * this refactor removes — the heartbeat is the opposite: it holds no copy,
     * and nothing reads it. 10 Hz (unchanged) is fast enough for the guide and
     * slow enough not to churn (§18).
     */
    const syncUi = () => setFrameTick((n) => n + 1);
    let lastUiSyncAt = 0;
    let lastRecordedValid = false;
    let lastRecordedHeld = false;
    let lastRecordedStatus: FaceGuideStatus = 'no-frame';

    /**
     * "This frame yields no verdict". The position latch is fed `false` here as
     * well, because a frame we could not analyse is not evidence that the face
     * is still placed and held. It takes POSITION_LOST_FRAMES of these to give a
     * passed position up, so a warm-up or a single dropped frame cannot retract
     * it.
     */
    let consecutiveDetectionFailures = 0;
    const markNoVerdict = () => {
      faceValidRef.current = false;
      faceStatusRef.current = 'no-frame';
      positioningPassedRef.current = positionLatchRef.current.push(false).passed;
    };

    // The element is passed in per frame, never captured for the whole session:
    // React can hand us a different <video> node, and the loop must follow it
    // instead of dying (see the lifecycle contract above).
    const evalFrame = async (video: HTMLVideoElement) => {
      if (detectionCancelRef.current || !streamRef.current || !video.isConnected) return;
      if (detectionRunningRef.current) return; // never overlap detections
      detectionRunningRef.current = true;
      try {
        // ONE model serves detection, the guide and the blink, so there is no
        // second load and no second WebGL context. `attachLandmarker()` has
        // already started (and possibly already failed) this load, so this branch
        // only runs when the loop got there first. A failure surfaces as ONE
        // honest error + Retry, and the guide is never faked with heuristics.
        if (!landmarkerRef.current && !landmarkerErrorRef.current) {
          detectorLoadingRef.current = true;
          try {
            landmarkerRef.current = await getFaceLandmarker();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // The ref and the single UI state are set together, so the derived
            // lifecycle and the screen can never report different failures.
            detectorErrorRef.current = message;
            landmarkerErrorRef.current = message;
            setLandmarkerError(message);
            console.error('[SellerVerification] face model failed to load', err);
            return;
          } finally {
            // The ref is the single record of this: the loading state was also
            // mirrored into React state purely so the old chip text could read
            // it, and that text now comes from the derived stage instead.
            detectorLoadingRef.current = false;
          }
        }
        const model = landmarkerRef.current;
        // §5 Refuse to run against a frame that is not really there. Detection on
        // a 0x0 or un-decoded video returns nothing, and reporting that as
        // "no face" is a lie about a face the user can plainly see.
        if (
          !model ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          video.videoWidth < 2 ||
          video.videoHeight < 2 ||
          video.paused
        ) {
          // No analysable frame yet during warmup or model loading — simply return without destroying active verdict
          return;
        }

        // §4/§5 Normalized coordinates: video pixels → cover-mapped → mirrored
        // → container fractions, all against the REAL measured preview box.
        // Checked BEFORE the model runs: with no measurable preview box there is
        // no coordinate system to compare against, so a detection could not be
        // judged anyway — and the blink below is gated on `evalRes.valid`, which
        // needs `size` too. Spending the model on such a frame buys nothing.
        let size = previewSizeRef.current;
        if (!size) {
          measurePreview();
          size = previewSizeRef.current;
        }
        if (!size) {
          const w = video.clientWidth || video.offsetWidth || video.videoWidth || 640;
          const h = video.clientHeight || video.offsetHeight || video.videoHeight || 480;
          size = { w, h };
          previewSizeRef.current = size;
        }

        const ts = Math.max(Math.floor(performance.now()), lastDetectTsRef.current + 1);
        lastDetectTsRef.current = ts;
        // THE single detection call. One model, one `detectForVideo`, and it
        // yields both the face geometry the guide needs and the eye mesh the
        // blink needs — so the two can no longer disagree about whether a face
        // is there.
        const frame = detectFacesAndEyesNow(model, video, ts);
        consecutiveDetectionFailures = 0;
        const boxes = frame.boxes;
        // The model ran and returned: whatever the previous frame's failure was,
        // it is over. Only a frame that actually throws sets this again.
        frameErrorRef.current = null;
        const evalRes = evaluateFaceGuidance({
          boxes,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          containerWidth: size.w,
          containerHeight: size.h,
          guide: faceGuideRect(size.w, size.h),
          // §8 The preview is CSS-mirrored with -scale-x-100, so the DISPLAY is
          // mirrored while the detector's coordinates are not. The mirror is
          // applied here, in display space, and the video handed to the model is
          // the raw frame — mirroring the model's input would make the box land
          // on the wrong side of the face.
          mirror: true,
        });
        faceCountRef.current = evalRes.count;
        faceStatusRef.current = evalRes.status;
        faceValidRef.current = evalRes.valid;
        faceAreaRef.current = evalRes.displayBox?.areaFraction ?? 0;
        // §5 Size as a RATIO OF THE FRAME — never raw pixels, because phone and
        // desktop cameras have completely different resolutions. Computed from
        // the RAW face box so it is independent of the cover crop.
        const raw = boxes[0];
        faceRatioRef.current = raw
          ? {
              w: (raw.x1 - raw.x0) / Math.max(1, video.videoWidth),
              h: (raw.y1 - raw.y0) / Math.max(1, video.videoHeight),
            }
          : { w: 0, h: 0 };
        // §4/§7 dev diagnostics, throttled to 1 Hz so they cannot flood the
        // console. Text metrics, dimensions, readiness and counts only — never a
        // frame, a landmark coordinate or anything from the ID document (§20).
        //
        // There is no "confidence" field and there never was one to report: the
        // FaceLandmarker applies `MIN_FACE_CONFIDENCE` internally and does not
        // expose a per-face score. The threshold actually IN FORCE is shown
        // instead, so a "no face" claim is provable against a real setting
        // rather than against a number nobody can produce.
        if (import.meta.env.DEV && ts - lastGuideDebugAtRef.current > 1000) {
          lastGuideDebugAtRef.current = ts;
          const b = evalRes.displayBox;
          console.debug('[FACE DEBUG] frame', {
            videoReady: video.readyState,
            video: `${video.videoWidth}×${video.videoHeight}`,
            modelReady: !!landmarkerRef.current,
            modelLoading: detectorLoadingRef.current,
            modelError: detectorErrorRef.current,
            frameError: frameErrorRef.current,
            facesDetected: evalRes.count,
            facesMeshed: frame.meshes.length,
            faceThreshold: MIN_FACE_CONFIDENCE,
            container: `${Math.round(size.w)}×${Math.round(size.h)}`,
            guide: faceGuideRect(size.w, size.h),
            boundingBox: b ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : null,
            faceCenterX: b ? Number(b.centerX.toFixed(3)) : null,
            faceCenterY: b ? Number(b.centerY.toFixed(3)) : null,
            faceWidth: b ? Number(b.width.toFixed(3)) : null,
            faceHeight: b ? Number(b.height.toFixed(3)) : null,
            clipped: b?.clipped ?? null,
            status: evalRes.status,
            timestamp: Math.round(ts),
          });
        }
        // §13 HYSTERESIS — the placement latch is the ONLY thing that can ask
        // for the blink. It is fed `valid && ready`, i.e. the face is correctly
        // placed AND has now been held for the full `PLACEMENT_HOLD_SECONDS`:
        // feeding it the raw per-frame verdict would pass after two frames
        // (~60 ms) and ask for a blink before the user had actually held still.
        // One dropped detection frame still cannot retract a passed position (the
        // latch's own lost-frame requirement), and one lucky frame still cannot
        // fake one.
        const previouslyHeld = faceHeldRef.current;
        const { progress, ready } = stabilityGateRef.current.push(evalRes.valid);
        placementProgressRef.current = progress;
        if (ready || faceHeldRef.current) {
          // Once held, maintain faceHeld as long as exactly one face is present in frame
          if (evalRes.count === 1) {
            faceHeldRef.current = true;
            positioningPassedRef.current = true;
          } else if (evalRes.count === 0 || evalRes.count > 1) {
            faceHeldRef.current = false;
            positioningPassedRef.current = false;
            stabilityGateRef.current.reset();
          }
        } else {
          positioningPassedRef.current = positionLatchRef.current.push(evalRes.valid && ready).passed;
          faceHeldRef.current = positioningPassedRef.current;
        }

        // Arm the blink gate freshly the exact moment the face is held!
        if (!previouslyHeld && faceHeldRef.current) {
          eyeGateRef.current.reset();
          earOpennessRef.current.reset();
        }

        // Start fetching the eye-landmark model the INSTANT the face is first
        // held, i.e. the moment before the blink is asked for.
        //
        // The mesh model is ~3.6 MB, so loading it on the first blink frame
        // would stall the very frames the blink itself occupies and lose it. The
        // hold is 2 s of the user holding still, which is exactly the window in
        // which a 3.6 MB download over a warm connection can complete. By the
        // time the blink prompt appears the mesh is normally already running.
        //
        // Non-blocking by design: this starts the load and returns. The per-frame
        // path reads `landmarkerRef` and skips frames until it is populated, so
        // a slow download never stalls the detection loop.
        if (faceHeldRef.current) attachLandmarker();

        // ── THE BLINK MEASUREMENT ──────────────────────────────────────
        // REAL eye-landmark geometry: the MediaPipe FaceLandmarker mesh, reduced
        // to a per-eye Eye Aspect Ratio. This tracks the real eyes rather than a
        // window of pixels near them.
        //
        // It is NOT gated on a challenge step any more. With a single-blink
        // challenge there is no "step" to be in, and the blink can happen at
        // any moment, so gating on one would mean a blink performed early is
        // silently discarded. The gate below is always listening; it simply
        // cannot be satisfied without a single valid face in front of the
        // camera, which `evalRes.valid` already requires.
        //
        // UX ONLY. The backend re-derives liveness from real eye-aspect-ratio
        // and gesture models over the uploaded burst (see
        // server/src/lib/faceVerification/), and its answer is the only one
        // that counts. Nothing here can approve or reject anyone.
        //
        // THE MEASUREMENT IS A REAL EYE ASPECT RATIO, from the MediaPipe
        // FaceLandmarker mesh — the same six-point formula the backend uses.
        //
        // It used to be the mean luminance of a horizontal pixel band across the
        // upper face box. That was a PROXY for eye state and could not tell a
        // blink from a shadow, a hand crossing the light, or a head tilt, so
        // "Blink detected ✓" was not something the system had actually
        // observed. The requirement is a real eye-state transition, and the
        // mesh provides one: the vertical aperture between the lids, divided by
        // the eye's own width, per eye, per frame.
        //
        // `frame.meshes[0]` is the mesh the model returned for the LARGEST face
        // in the frame — the same face `boxes[0]` gave the guide, because
        // `buildFaceFrame` orders both lists together. The eyes being measured
        // are therefore provably the eyes of the face being guided.
        if (faceHeldRef.current && frame.meshes[0] && evalRes.count === 1) {
          const ears = bothEyeAspectRatios(frame.meshes[0]);
          const openness = earOpennessRef.current.push(ears);
          if (openness !== null) {
            // A ref, not state: this runs on every measured frame, and a render
            // per frame is what made the live preview stutter. The dev panel
            // samples it at 2 Hz through the telemetry snapshot.
            eyeOpennessRef.current = openness;
            if (!blinkDetectedRef.current) {
              const opened = eyeGateRef.current.push(openness);
              if (opened.blink) {
                // Latch the instant so the upload window can be anchored to it.
                blinkAtRef.current = performance.now();
                blinkDetectedRef.current = true;
                setBlinkDetected(true);
              }
            }
          }

          // Keep a throttled copy of the frame for the blink-window upload only
          // once face has been held (during the blink check).
          // Once a blink is detected, capture for an additional 600ms (to capture
          // eye reopening) and then STOP buffering so the blink frames are FROZEN
          // in memory and never evicted while the user takes time to click Submit!
          if (faceHeldRef.current && ts - lastBufferedAtRef.current >= 100) {
            const isBlinkCaptured =
              blinkDetectedRef.current &&
              blinkAtRef.current !== null &&
              ts - blinkAtRef.current > 600;
            if (!isBlinkCaptured) {
              lastBufferedAtRef.current = ts;
              void captureBufferedFrame(ts);
            }
          }
        }
      } catch (err) {
        frameErrorRef.current = err instanceof Error ? err.message : String(err);
        consecutiveDetectionFailures += 1;
        // Grace period: allow up to 4 transient dropped/corrupted frames before resetting active verdict
        if (consecutiveDetectionFailures >= 5) {
          markNoVerdict();
        }
        console.warn('[SellerVerification] face analysis failed on frame', err);
      } finally {
        detectionRunningRef.current = false;
        // The heartbeat lives in `finally` so EVERY path re-renders — including
        // the early `return`s that call `markNoVerdict()` (warm-up, no
        // measurable preview box). Placed at the end of `try` it was skipped by
        // exactly the frames that changed the refs, which would have frozen the
        // chip on a stale message. Rate-limited inside `syncUi`.
        const now = performance.now();
        const currentValid = faceValidRef.current;
        const currentHeld = faceHeldRef.current;
        const currentStatus = faceStatusRef.current;
        const stateChanged =
          currentValid !== lastRecordedValid ||
          currentHeld !== lastRecordedHeld ||
          currentStatus !== lastRecordedStatus;

        if (
          (stateChanged && now - lastUiSyncAt >= 100) ||
          (currentHeld && now - lastUiSyncAt >= 300) ||
          now - lastUiSyncAt >= 1000
        ) {
          lastRecordedValid = currentValid;
          lastRecordedHeld = currentHeld;
          lastRecordedStatus = currentStatus;
          lastUiSyncAt = now;
          syncUi();
        }
      }
    };

    // ── ONE pending frame callback at a time. Never a second chain (§16) ──
    let pendingFrameCb = 0;
    // The element the pending callback was registered on, so the cancel is
    // issued to the right target even if React has since swapped the node.
    let pendingFrameEl: HTMLVideoElement | null = null;

    const cancelLoop = () => {
      if (detectionCancelRef.current) return; // idempotent
      detectionCancelRef.current = true;
      detectionLoopStartedRef.current = false;
      detectionLoopCountRef.current = 0;
      detectionRunningRef.current = false;
      if (pendingFrameCb !== 0) {
        try {
          if (pendingFrameEl && typeof pendingFrameEl.cancelVideoFrameCallback === 'function') {
            pendingFrameEl.cancelVideoFrameCallback(pendingFrameCb);
          } else {
            cancelAnimationFrame(pendingFrameCb);
          }
        } catch (err) {
          // The callback can fire between cancel and flag-set — benign, but it
          // is never swallowed silently (project rule §7).
          console.warn('[SellerCamera] cancel pending detection frame callback failed', err);
        }
        pendingFrameCb = 0;
        pendingFrameEl = null;
      }
      if (detectionStopRef.current === cancelLoop) detectionStopRef.current = null;
      // Release the preview measurement. Camera resources only — this never
      // touches the wizard (§8: camera cleanup stops tracks/timers/listeners).
      previewObserver?.disconnect();
      observedPreviewEl = null;
      previewSizeRef.current = null;
    };

    let lastLoopRunAt = 0;
    const scheduleNext = () => {
      if (detectionCancelRef.current) return;
      pendingFrameCb = requestAnimationFrame(loop);
    };
    const loop = async () => {
      if (detectionCancelRef.current) return;
      const el = videoRef.current;
      if (!streamRef.current || !el || !el.isConnected) {
        scheduleNext();
        return;
      }
      const now = performance.now();
      if (now - lastLoopRunAt < 75) {
        scheduleNext();
        return;
      }
      lastLoopRunAt = now;
      if (!previewSizeRef.current) measurePreview();
      if (phaseRef.current === 'capture' && !detectionRunningRef.current) {
        await evalFrame(el);
      }
      scheduleNext();
    };

    detectionStopRef.current = cancelLoop;
    scheduleNext();

    // Cleanup cancels ONLY the loop. It never stops a track, never calls
    // getUserMedia and never closes the detector.
    return cancelLoop;
  }, [cameraActive]);

  /** Debug-telemetry sampler for the dev-only panel (text only, spec §10). */
  useEffect(() => {
    if (
      !(phase === 'capture' ||
        phase === 'cameraPermission' ||
        phase === 'captureFailed' ||
        (phase === 'document' && docCaptureOpen))
    ) {
      setCameraTelemetry(null);
      return undefined;
    }
    const interval = window.setInterval(() => {
      const video = videoRef.current;
      const tracks = streamRef.current?.getVideoTracks() ?? [];
      const snap: CameraTelemetry = {
        readyState: video?.readyState ?? -1,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        streamActive: !!streamRef.current && tracks.some((t) => t.readyState === 'live'),
        trackStates: tracks.map((t) => t.readyState).join(',') || 'none',
        // ONE task serves detection, the guide and the blink, so there is a
        // single readiness to report — and no way for face detection to read
        // "broken" because an eye model failed.
        detector: detectorErrorRef.current
          ? 'error'
          : detectorLoadingRef.current
            ? 'loading'
            : landmarkerRef.current
              ? 'ready'
              : 'loading',
        detectorError: detectorErrorRef.current,
        faces: faceCountRef.current,
        status: faceStatusRef.current,
        inGuide: faceStatusRef.current === 'ok',
        areaPct: faceAreaRef.current * 100,
        stableSec: placementProgressRef.current * PLACEMENT_HOLD_SECONDS,
        captureReady: placementProgressRef.current >= 1,
        // §4/§5 — the threshold the model is actually applying, plus the last
        // per-frame failure. Together these are the proof that "No face
        // detected" is a real measurement and not a broken model, a bad
        // timestamp or a stale count left behind by a frame that threw.
        faceThreshold: MIN_FACE_CONFIDENCE,
        frameError: frameErrorRef.current,
        eyeOpenness: eyeOpennessRef.current,
        faceWidthRatio: faceRatioRef.current.w,
        faceHeightRatio: faceRatioRef.current.h,
        previewSize: previewSizeRef.current
          ? `${Math.round(previewSizeRef.current.w)}×${Math.round(previewSizeRef.current.h)}`
          : '—',
        guideSize: previewSizeRef.current
          ? (() => {
              const g = faceGuideRect(previewSizeRef.current.w, previewSizeRef.current.h);
              return `${Math.round((g.x1 - g.x0) * 100)}%×${Math.round((g.y1 - g.y0) * 100)}%`;
            })()
          : '—',
        // Camera-lifecycle instrumentation: prove ONE stream / one init.
        gumCalls: gumCallCountRef.current,
        activeStreams: activeStreamIdsRef.current.size,
        detectionLoops: detectionLoopCountRef.current,
        renders: renderCountRef.current,
        trackLive: tracks.some((t) => t.readyState === 'live'),
        streamId: streamRef.current?.id.slice(0, 8) ?? 'none',
        cameraStarting: cameraStartingRef.current,
        // Lifecycle counters (§15) — the full open/stop history at a glance.
        cameraStartAttempts: cameraStartAttemptsRef.current,
        cameraSuccessCount: cameraSuccessCountRef.current,
        cameraFailureCount: cameraFailureCountRef.current,
        cameraStopCount: cameraStopCountRef.current,
        streamCreatedCount: streamCreatedCountRef.current,
        streamDestroyedCount: streamDestroyedCountRef.current,
        videoAttachCount: videoAttachCountRef.current,
        videoPlayCount: videoPlayCountRef.current,
        videoMetadataCount: videoMetadataCountRef.current,
        // Environment + last failure (§3/§4/§14) — the true cause is never hidden.
        secureContext:
          typeof window.isSecureContext === 'boolean' ? (window.isSecureContext ? 'yes' : 'no') : 'n/a',
        mediaDevicesAvailable: !!navigator?.mediaDevices,
        gumAvailable: typeof navigator?.mediaDevices?.getUserMedia === 'function',
        lastError: lastCameraErrorRef.current,
        // Real-frame pipeline (§22): is the <video> ACTUALLY rendering?
        videoPlaying: !!video && !video.paused && video.currentTime > 0,
        videoCurrentTime: video?.currentTime ?? 0,
        realFrame: realFrameReceivedRef.current,
        rvfcFired: rvfcFiredRef.current,
        lastStopReason: lastStopReasonRef.current,
        // §11 separated state — proves they are independent and that none of
        // them is wired to the stream.
        cameraActive: cameraActiveRef.current,
        frameReady: frameReadyRef.current,
        detectionRunning: detectionRunningRef.current,
        // The derived lifecycle + the phase context the panel must report.
        cameraState: deriveCameraLifecycle({
          hasStream: !!streamRef.current,
          trackLive: tracks.some((t) => t.readyState === 'live'),
          videoAttached: !!video && !!streamRef.current && video.srcObject === streamRef.current,
          readyState: video?.readyState ?? 0,
          videoWidth: video?.videoWidth ?? 0,
          videoHeight: video?.videoHeight ?? 0,
          frameProof: frameReadyRef.current || realFrameReceivedRef.current,
          starting: cameraStartingRef.current || cameraOpenRef.current !== null,
          closing: false,
          detectionLoopActive: detectionLoopCountRef.current === 1,
          // The camera lifecycle no longer has a "liveness is counting" input:
          // there is no pose timer to count down, so a face being detected can
          // no longer be reported as a liveness stage. It is asked whether a
          // blink was actually MEASURED, which is the only liveness evidence the
          // client holds.
          livenessCounting: blinkDetectedRef.current,
          analyzing: analyzingRef.current,
          success: false,
          issue: !!cameraIssueRef.current || !!detectorErrorRef.current,
        }),
        cameraMissing: (() => {
          const s = {
            hasStream: !!streamRef.current,
            trackLive: tracks.some((t) => t.readyState === 'live'),
            videoAttached: !!video && !!streamRef.current && video.srcObject === streamRef.current,
            readyState: video?.readyState ?? 0,
            videoWidth: video?.videoWidth ?? 0,
            videoHeight: video?.videoHeight ?? 0,
            frameProof: frameReadyRef.current || realFrameReceivedRef.current,
          };
          return import.meta.env.DEV ? missingReadyConditions(s).join(',') || 'none' : '—';
        })(),
        countdown: null, // the countdown is gone: no pose, no timer, no fake progress
        livenessStep: 'blink', // the one and only liveness action in this flow
        verificationState: phase,
        // §12 THE verification state, from the SAME derivation the screen uses.
        // `cameraState` above describes the camera; these describe the face
        // check, and the panel must never show one without the other.
        ...(() => {
          const d = deriveLiveNow(
            isCameraFrameReady({
              hasStream: !!streamRef.current,
              trackLive: tracks.some((t) => t.readyState === 'live'),
              videoAttached: !!video && !!streamRef.current && video.srcObject === streamRef.current,
              readyState: video?.readyState ?? 0,
              videoWidth: video?.videoWidth ?? 0,
              videoHeight: video?.videoHeight ?? 0,
              frameProof: frameReadyRef.current || realFrameReceivedRef.current,
            }),
            detectionLoopCountRef.current === 1,
            // Read through a ref so the interval does not have to re-subscribe
            // every time the backend review state changes, while still seeing
            // the current value. Never a cached render-time copy.
            reviewStatusRef.current,
          );
          return {
            verifyState: d.state,
            verifyMessage: d.message,
            faceCount: d.signals.faceCount,
            facePositionValid: d.signals.facePlaced,
            faceHeld: d.signals.faceHeld,
            blinkMeasured: d.signals.blinkDetected,
            earBaseline: earOpennessRef.current.baselineEstablished,
            blinkAt: blinkAtRef.current,
            bufferedFrames: blinkWindowSize(ctxRef.current?.sessionId ?? null),
            submitEnabled: isSubmitEnabled(d.state),
            verifyContradiction: import.meta.env.DEV ? d.contradiction : null,
          };
        })(),
      };
      // Re-render only when the snapshot actually changes (§18) — this is what
      // kills the render churn that made the panel report hundreds of renders.
      const json = JSON.stringify(snap);
      if (json !== lastTelemetryJsonRef.current) {
        lastTelemetryJsonRef.current = json;
        setCameraTelemetry(snap);
      }
    }, 500);
    return () => window.clearInterval(interval);
  }, [phase, docCaptureOpen]);

  /**
   * Camera health monitor (spec §12/§13/§16).
   *
   * LIFECYCLE CONTRACT:
   *   - Bound to the CAMERA SESSION (`cameraActive` only). Face status, frame
   *     readiness, progress and step changes are read through refs, so NO
   *     verification state can re-run or tear down this effect.
   *   - EXACTLY ONE patrol chain, and the chain is REALLY cancelled on cleanup
   *     via cancelVideoFrameCallback. The previous cleanup only cleared its
   *     timer, so every re-run leaked another self-rescheduling
   *     requestVideoFrameCallback chain. Those immortal chains outlived the
   *     session, re-armed their own kill timers and repeatedly stopped a
   *     perfectly healthy camera — that WAS the ON → OFF → ON → OFF flicker.
   *   - A provably alive camera is NEVER killed.
   *   - Automatic recovery is a ONE-SHOT per session with a cooldown (§13).
   *     There is no `track.onended → startCamera()` anywhere.
   */
  useEffect(() => {
    if (!cameraActive) return undefined;
    if (healthStopRef.current) return undefined; // one chain, ever
    const video = videoRef.current;
    const streamAtStart = streamRef.current;
    if (!video || !streamAtStart) return undefined;

    // Is a camera expected right now? Read LIVE — never a dependency (§4/§9).
    const cameraExpected = () =>
      phaseRef.current === 'capture' || (phaseRef.current === 'document' && docCameraOpenRef.current);

    let cancelled = false;
    let killTimer: number | undefined;
    let lastFrameAt = performance.now();
    let warnLogged = false;
    let pendingFrameCb = 0;

    /** A camera is provably alive when the SESSION's video track is live AND the
     *  <video> element is connected, showing that exact stream, with decoded
     *  dimensions. We must NEVER kill that — some webviews stay silent on
     *  requestVideoFrameCallback while rendering fine. */
    const cameraProvablyAlive = () => {
      const tracksLive = streamAtStart.getVideoTracks().some((t) => t.readyState === 'live');
      const el = videoRef.current;
      const elementHealthy =
        !!el &&
        el.isConnected &&
        el.srcObject === streamAtStart &&
        el.readyState >= 2 &&
        el.videoWidth >= 2 &&
        el.videoHeight >= 2;
      return tracksLive && elementHealthy;
    };

    const stopPatrol = () => {
      if (cancelled) return; // idempotent
      cancelled = true;
      if (killTimer !== undefined) window.clearTimeout(killTimer);
      killTimer = undefined;
      if (pendingFrameCb !== 0) {
        try {
          if (typeof video.cancelVideoFrameCallback === 'function') {
            video.cancelVideoFrameCallback(pendingFrameCb);
          } else {
            cancelAnimationFrame(pendingFrameCb);
          }
        } catch (err) {
          console.warn('[SellerCamera] cancel pending health frame callback failed', err);
        }
        pendingFrameCb = 0;
      }
      if (healthStopRef.current === stopPatrol) healthStopRef.current = null;
    };

    const handleDeath = () => {
      if (cancelled) return;
      // Never kill or stop a camera whose hardware tracks are still LIVE!
      const anyTrackLive = streamAtStart.getVideoTracks().some((t) => t.readyState === 'live');
      if (anyTrackLive) {
        console.warn('[SellerCamera] handleDeath ignored: video track is still LIVE. Ensuring video is playing.');
        const el = videoRef.current;
        if (el && el.paused) {
          el.play().catch((err) => console.warn('[SellerCamera] resume video play failed', err));
        }
        return;
      }

      const now = performance.now();
      // §13 cooldown: a flapping device must never be restarted in a fast loop.
      if (now - lastDeathAtRef.current < 5000) {
        console.warn('[SellerCamera] preview-died within the 5s cooldown — ignoring (no restart loop)');
        return;
      }
      lastDeathAtRef.current = now;
      console.warn('[SellerCamera] VIDEO TRACK ENDED / preview stopped mid-use', {
        streamId: streamAtStart.id,
        readyState: video.readyState,
        width: video.videoWidth,
        height: video.videoHeight,
        tracks: streamAtStart.getTracks().map((tr) => ({ label: tr.label, state: tr.readyState })),
      });
      // The patrol ends with the session it was watching.
      stopPatrol();

      // ONE controlled recovery, never an automatic restart loop (§13).
      if (!autoRecoveryUsedRef.current) {
        autoRecoveryUsedRef.current = true;
        console.warn('[SellerCamera] one-shot automatic recovery (no loop from here)');
        stopCamera('auto-recovery');
        if (phaseRef.current === 'document' && !docOpeningRef.current) {
          // Webview/OEM rear cameras are the flaky ones — try the front camera
          // ONCE per session, then require explicit user action.
          void openDocCamera(true, true);
        }
        return;
      }

      stopCamera('camera-failure-mid-use');
      if (phaseRef.current === 'document') {
        setCameraIssue(
          'The camera preview stopped (the stream froze or ended). Tap Retry Camera, or upload a photo from your device instead.',
        );
      } else {
        // Honest, recoverable dead-end: the camera is stopped, so send the user
        // back to the permission screen where a NEW single stream can be opened.
        setCameraIssue('The camera preview stopped while capturing. Open the camera again to retry.');
        setLastError('The camera preview stopped while capturing.');
        setPhase('cameraPermission');
      }
    };

    const startKillTimer = () => {
      if (cancelled) return;
      if (killTimer !== undefined) window.clearTimeout(killTimer);
      killTimer = window.setTimeout(() => {
        if (cancelled) return;
        if (streamRef.current !== streamAtStart) return; // a different session now
        const anyTrackLive = streamAtStart.getVideoTracks().some((t) => t.readyState === 'live');
        if (anyTrackLive || cameraProvablyAlive() || realFrameReceivedRef.current) {
          const el = videoRef.current;
          if (el && el.paused) {
            el.play().catch(() => {});
          }
          if (!warnLogged && anyTrackLive && !cameraProvablyAlive()) {
            warnLogged = true;
            console.warn('[SellerCamera] rVFC silent but track alive — camera kept on');
          }
          startKillTimer();
          return;
        }
        handleDeath();
      }, 5000);
    };

    healthStopRef.current = stopPatrol;

    // Primary path: requestVideoFrameCallback fires only when a real frame is
    // rendered — the reliable way to spot a frozen/blank preview. Some live
    // streams report currentTime=0, so we deliberately do NOT use currentTime.
    if (typeof video.requestVideoFrameCallback === 'function') {
      let lastKillResetAt = 0;
      const frameLoop: VideoFrameRequestCallback = () => {
        if (cancelled) return;
        if (!video.isConnected || streamRef.current !== streamAtStart) return;
        lastFrameAt = performance.now();
        const now = performance.now();
        if (now - lastKillResetAt >= 2000) {
          lastKillResetAt = now;
          startKillTimer();
        }
        pendingFrameCb = video.requestVideoFrameCallback(frameLoop);
      };
      pendingFrameCb = video.requestVideoFrameCallback(frameLoop);
      startKillTimer();
      return stopPatrol;
    }

    // Fallback (older browsers): structural checks with tolerance —
    // never currentTime. Only die when the camera is NOT provably alive.
    let badCount = 0;
    const timer = window.setInterval(() => {
      if (cancelled || streamRef.current !== streamAtStart) {
        window.clearInterval(timer);
        return;
      }
      const anyTrackLive = streamAtStart.getVideoTracks().some((t) => t.readyState === 'live');
      if (anyTrackLive || cameraProvablyAlive()) {
        badCount = 0;
        const el = videoRef.current;
        if (el && el.paused) {
          el.play().catch(() => {});
        }
        return;
      }
      badCount += 1;
      if (badCount >= 5) {
        window.clearInterval(timer);
        handleDeath();
      }
    }, 1000);
    const stopIntervalPatrol = () => {
      window.clearInterval(timer);
      stopPatrol();
    };
    if (healthStopRef.current === stopPatrol) healthStopRef.current = stopIntervalPatrol;
    return stopIntervalPatrol;
  }, [cameraActive]);

  /** Honest environment/API error mapping (§2-7: never swallow, never fake). */
  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      if (err.status === 503) {
        setPhase('unavailable');
        return;
      }
      if (err.status === 410) {
        setPhase('expired');
        return;
      }
      if (err.status === 429) {
        setPhase('rejected');
        setLastError('Too many failed attempts. Please contact support.');
        return;
      }
      setLastError(err.message);
      setPhase('error');
      return;
    }
    setLastError('Something went wrong. Please try again.');
    setPhase('error');
  }, []);

  /**
   * FINISH THE SUBMISSION — the recovery for a burst that reached the server
   * without the hand-off to review.
   *
   * The server still holds the frames and the verification is still in
   * `LIVENESS_CHECK`, so the only thing missing is the transition. This is a
   * single explicit click, not a write fired by page load: a page that opens
   * must never change anyone's verification state on its own.
   *
   * It cannot approve anyone. `/complete` can only return MANUAL_REVIEW, and
   * that is asserted below — a different answer is reported as an error rather
   * than rendered as a status the user did not earn.
   */
  const finishSubmission = async (): Promise<void> => {
    if (submittingLiveRef.current) return;
    const sessionId = ctxRef.current?.sessionId ?? null;
    if (!sessionId) {
      setLastError('Your verification session has expired. Please restart the check.');
      setPhase('expired');
      return;
    }
    submittingLiveRef.current = true;
    setAnalyzing(true);
    setLastError('');
    try {
      const done = await verificationService.complete(sessionId);
      noteServerState(done.state);
      if (done.state !== 'MANUAL_REVIEW') {
        setLastError('The server returned an unexpected result. Please reload to see your status.');
        setPhase('error');
        return;
      }
      submittedLiveRef.current = true;
      setReviewStatus('UNDER_REVIEW');
      setPhase('manualReview');
    } catch (err) {
      handleError(err);
    } finally {
      submittingLiveRef.current = false;
      setAnalyzing(false);
    }
  };

  /** Start (or reuse) a short-lived verification session. */
  const ensureSession = useCallback(async (): Promise<SessionContext> => {
    const started = await verificationService.startSession();
    noteServerState(started.verification.state);
    const next: SessionContext = {
      verificationId: started.verification.verificationId,
      cycle: started.verification.cycle,
      state: started.verification.state,
      sessionId: started.session.id,
      challenge: started.session.challenge,
      completedSteps: [],
    };
    setCtx(next);
    return next;
  }, [noteServerState]);

  // ── boot: honest resume from the backend's real state ─────────────────────
  const init = useCallback(async () => {
    setPhase('loading');
    setLastError('');
    try {
      const status = await verificationService.getStatus();
      if (!status.provider.configured) {
        setPhase('unavailable');
        return;
      }
      if (!status.verification) {
        setPhase('intro');
        return;
      }
      const { state } = status.verification;
      noteServerState(state);
      setServerSubmittedAt(status.verification.submittedAt);

      // ── THE RELOAD GUARANTEE ───────────────────────────────────────────
      // Every terminal outcome is read from the DATABASE, and each one sets
      // `reviewStatus` FIRST. That is the only input to the live-check state
      // machine which can produce UNDER_REVIEW / APPROVED / REJECTED, and
      // `isCameraAllowed` is false for all three — so a page loaded while under
      // review cannot open the camera, cannot ask for another blink, and cannot
      // show a Submit button. There is no code path from these branches to
      // `getUserMedia`, which is the property being claimed.
      if (state === 'VERIFIED') {
        // APPROVED — and by an ADMIN, not by a score.
        //
        // `VERIFIED` is no longer reachable from `/complete`: that route can only
        // write `MANUAL_REVIEW`. The only writer of `VERIFIED` is
        // `POST /admin/seller-verifications/:id/approve`, which is admin-gated and
        // also calls `grantSellerAccess` so `seller_profiles.verification_status`
        // is written in the same transaction. So this screen is reporting a human
        // decision the server already made, not inferring approval from a document
        // check — which is why it is safe to render.
        //
        // It still grants nothing by itself. The seller area's own routes are
        // gated by `requireApprovedSeller` (role AND approved profile), so if the
        // two writes ever disagreed, that gate would 403 truthfully instead of
        // trusting this page.
        setReviewStatus('APPROVED');
        setPhase('approved');
        return;
      }
      if (state === 'MANUAL_REVIEW') {
        setReviewStatus('UNDER_REVIEW');
        setPhase('manualReview');
        return;
      }
      if (state === 'REJECTED') {
        setReviewStatus('REJECTED');
        setPhase('rejected');
        setLastError(
          status.verification.rejectionReason ??
            'Your verification was not approved. Please contact support to discuss it.',
        );
        return;
      }
      if (state === 'REVERIFICATION_REQUIRED') {
        setPhase('reverification');
        return;
      }
      if (state === 'NOT_STARTED') {
        setPhase('intro');
        return;
      }
      // DOCUMENT_UPLOADED / DOCUMENT_VALIDATING — the college ID from
      // BecomeSellerPage is already uploaded. Skip the document phase and resume
      // directly at the face check. The backend uses the existing college ID
      // as the reference document.
      if (state === 'DOCUMENT_UPLOADED' || state === 'DOCUMENT_VALIDATING') {
        setPhase('cameraPermission');
        return;
      }

      // DOCUMENT_VERIFIED / FACE_CAPTURE_REQUIRED / FACE_PROCESSING / LIVENESS_CHECK —
      // resume the live part with the real session, or open a new one.
      const resumed: SessionContext = {
        verificationId: status.verification.verificationId,
        cycle: status.verification.cycle,
        state,
        sessionId: status.session?.id ?? null,
        challenge: status.session?.challenge ?? [],
        completedSteps: status.session?.completedSteps ?? [],
      };
      setCtx(resumed);

      if (status.session && status.session.challenge.length > 0) {
        const pending = status.session.challenge.filter(
          (s) => !(status.session?.completedSteps ?? []).includes(s),
        );
        if (pending.length === 0) {
          // The server holds an accepted burst and the hand-off never happened.
          // The camera is NOT opened and no blink is asked for: the honest move
          // is one button that asks the server to finish, not a re-capture.
          setPhase('finishing');
          return;
        }
        setPhase('cameraPermission');
        return;
      }

      const started = await ensureSession();
      if (started.state === 'NOT_STARTED') {
        setPhase('document');
        return;
      }
      setPhase('cameraPermission');
    } catch (err) {
      handleError(err);
    }
  }, [ensureSession, handleError, noteServerState]);

  useEffect(() => {
    void init();
  }, [init]);

  // ── consent ────────────────────────────────────────────────────────────────
  const handleConsent = async () => {
    if (!consentAgreed) {
      showToast('Please read and accept the consent before continuing.', 'error');
      return;
    }
    setIsBusy(true);
    try {
      preloadFaceLandmarker();
      const started = await ensureSession();
      if (started.state === 'NOT_STARTED') {
        setPhase('document');
      } else {
        setPhase('cameraPermission');
      }
    } catch (err) {
      handleError(err);
    } finally {
      setIsBusy(false);
    }
  };

  // ── document upload ────────────────────────────────────────────────────────
  const handleDocPick = (file: File | null) => {
    if (!file) {
      setDocFile(null);
      setDocPreviewUrl(null);
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      showToast('Please choose a JPG or PNG photo of your ID.', 'error');
      return;
    }
    if (file.size > MAX_ID_FILE_BYTES) {
      showToast('The ID photo must be 2 MB or smaller.', 'error');
      return;
    }
    setDocFile(file);
    if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
    setDocPreviewUrl(URL.createObjectURL(file));
  };

  const submitDocument = async () => {
    if (!docFile) {
      showToast('Choose a photo of your ID card first.', 'error');
      return;
    }
    setIsBusy(true);
    setPhase('documentProcessing');
    try {
      const bytes = await docFile.arrayBuffer();
      const res = await verificationService.uploadDocument(docKind, bytes);
      noteServerState(res.state);
      if (res.state === 'DOCUMENT_VERIFIED') {
        setPhase('documentAccepted');
      } else if (res.state === 'MANUAL_REVIEW') {
        setPhase('documentManualReview');
      } else {
        setPhase('documentRejected');
      }
    } catch (err) {
      setPhase('document');
      handleError(err);
    } finally {
      setIsBusy(false);
    }
  };

  const beginFaceCapture = async () => {
    setIsBusy(true);
    try {
      // Start the ~9.4 MB detector WASM download NOW, in parallel with the
      // session call and the user's camera permission click, so the first
      // analysed frame does not stall the main thread (the "1-second black
      // flicker" on open). Pre-warm only — the camera lifecycle is untouched.
      preloadFaceLandmarker();
      // Explicit session boundary: never carry a live stream into a new session.
      stopCamera('verification-restart');
      await ensureSession();
      setPhase('cameraPermission');
    } catch (err) {
      handleError(err);
    } finally {
      setIsBusy(false);
    }
  };

  // ── camera ─────────────────────────────────────────────────────────────────
  /**
   * Wait until the attached <video> has actually decoded a frame —
   * readyState >= HAVE_CURRENT_DATA with real dimensions. This is the only
   * signal we trust here, and it is deliberately lenient:
   *   - A decoded frame at readyState 2 IS a live preview even if the scene is
   *     dark or a webview samples slowly, so we NEVER kill on low luminance
   *     (the old 900 ms canvas-luma probe made the camera flicker on/off in
   *     webviews: open -> "dead" -> next shape -> open -> "dead" ...).
   *   - 'dead' means the element NEVER decoded a frame within the budget, i.e.
   *     the preview is genuinely absent/black and the caller falls back or
   *     errors honestly.
   * A live-but-dark preview is judged later by the document analyzer (which
   * reads real pixels) and by the user — not by a boot-time luma canary.
   */
  /**
   * Spec §1/§9: wait for the video to actually DECODE a frame — readyState ≥
   * HAVE_CURRENT_DATA with real dimensions. The `loadedmetadata` event alone
   * can fire at readyState 1 (metadata only), which is why this also re-checks
   * `canplay`/`playing` and the readyState directly: metadata ≠ real frames.
   */
  const waitForMetadata = (video: HTMLVideoElement, timeoutMs = 8000): Promise<boolean> =>
    new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        resolve(ok);
      };
      const finishWhenDecoded = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) finish(true);
      };
      const onMeta = () => finishWhenDecoded();
      const onCanPlay = () => finishWhenDecoded();
      const onPlaying = () => finishWhenDecoded();
      const onError = () => finish(false);
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('error', onError);
      finishWhenDecoded(); // already decoded between attach and here?
    });

  /**
   * REAL frame verification (§5-§9): `video.play()` resolving does NOT prove
   * frames are rendering. This is satisfied by ANY of:
   *   (1) requestVideoFrameCallback fired   — a real video frame was presented
   *   (2) media clock advanced while rs≥2   — frames are being presented
   *   (3) canvas drawImage captured pixels  — actual decoded pixels exist
   * It NEVER stops/restarts the stream; on timeout it reports the failing
   * evidence while the MediaStream stays LIVE (spec §16/§17) — the caller
   * retries OBSERVATION, never getUserMedia.
   */
  const observeRealFrames = (
    attached: HTMLVideoElement,
    timeoutMs = 15000,
  ): Promise<{ ok: boolean; reason: string }> =>
    new Promise((resolve) => {
      const started = Date.now();
      let done = false;
      let pendingCb = 0;
      let rvfcFired = false;
      let canvasSampled = false;
      let canvasOk = false;
      let mediaClockAdvanced = false;
      let lastTime = attached.currentTime;
      let loggedElementChange = false;

      const finish = (ok: boolean, reason: string) => {
        if (done) return;
        done = true;
        window.clearInterval(timer);
        window.clearTimeout(hard);
        if (pendingCb !== 0 && typeof attached.cancelVideoFrameCallback === 'function') {
          try {
            attached.cancelVideoFrameCallback(pendingCb);
          } catch (err) {
            // The callback often fires between finish() and cancel — benign, but
            // never swallowed silently (project rule §7).
            console.warn('[SellerCamera] cancelVideoFrameCallback failed', err);
          }
        }
        resolve({ ok, reason });
      };
      const hard = window.setTimeout(() => {
        finish(false, `no real frame within ${Math.round(timeoutMs / 1000)}s (rVFC ${rvfcFired ? 'fired' : 'waiting'}, clock ${mediaClockAdvanced ? 'moved' : 'stuck'}, pixels ${canvasOk ? 'yes' : 'no'})`);
      }, timeoutMs);

      const timer = window.setInterval(() => {
        // Observe the LIVE element: if React recreated the <video> node, seamlessly
        // bind the stream to the newly mounted node so frames can render immediately.
        let currentTarget = attached;
        const live = videoRef.current;
        if (live && live !== attached && live.isConnected) {
          if (!loggedElementChange) {
            loggedElementChange = true;
            console.warn('[SellerCamera] VIDEO ELEMENT CHANGED after attach — synchronizing live element', {
              attached,
              live,
              attachedConnected: attached.isConnected,
              liveConnected: live.isConnected,
            });
          }
          if (live.srcObject !== streamRef.current && streamRef.current) {
            live.srcObject = streamRef.current;
            live.autoplay = true;
            live.muted = true;
            live.playsInline = true;
            live.play().catch(() => {});
          }
          attached = live;
          currentTarget = live;
        }

        if (!currentTarget.isConnected) return; // detached → keep waiting, never kill

        const framePresent =
          attached.readyState >= 2 && attached.videoWidth > 0 && attached.videoHeight > 0;

        // Proof (2): media clock advancing while a frame is present.
        if (framePresent && attached.currentTime !== lastTime) {
          mediaClockAdvanced = true;
          lastTime = attached.currentTime;
        } else if (framePresent) {
          lastTime = attached.currentTime;
        }

        // Proof (3): canvas pixel probe — a tiny decode of the actual frame.
        if (framePresent && !canvasSampled) {
          canvasSampled = true;
          try {
            const c = document.createElement('canvas');
            const w = Math.min(attached.videoWidth, 96);
            const h = Math.min(attached.videoHeight, 96);
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(attached, 0, 0, w, h);
              const data = ctx.getImageData(0, 0, w, h).data;
              let lit = 0;
              for (let i = 0; i < data.length; i += 16) {
                if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) lit += 1;
              }
              canvasOk = lit >= 1;
              console.log('[SellerCamera] canvas frame probe', { lit, of: Math.ceil(data.length / 16) });
            }
          } catch (err) {
            console.warn('[SellerCamera] canvas probe unavailable', err);
          }
        }

        if (rvfcFired || mediaClockAdvanced || canvasOk || framePresent) {
          realFrameReceivedRef.current = true;
          finish(true, 'real frame verified');
        }
      }, 200);

      // Proof (1) — primary when the browser supports it: fires once a real
      // video frame is presented to the element.
      if (typeof attached.requestVideoFrameCallback === 'function') {
        pendingCb = attached.requestVideoFrameCallback((now, meta) => {
          rvfcFired = true;
          rvfcFiredRef.current = true;
          realFrameReceivedRef.current = true;
          console.log('[SellerCamera] REAL VIDEO FRAME', {
            now,
            mediaTime: (meta as { mediaTime?: number })?.mediaTime ?? null,
            currentTime: attached.currentTime,
            readyState: attached.readyState,
            width: attached.videoWidth,
            height: attached.videoHeight,
            elapsedMs: Date.now() - started,
          });
          finish(true, 'requestVideoFrameCallback fired');
        });
      }
    });

  /**
   * Map a getUserMedia DOMException to our UI reason while KEEPING the exact
   * name/message/constraint — the panel and dev toast show the true category,
   * never a generic "frame not ready" (§3/§4/§14).
   */
  const mapGumError = (err: unknown): { reason: CameraFailureReason; name: string; message: string; constraint?: string } => {
    const name =
      err instanceof DOMException ? err.name : (err as { name?: string })?.name ?? 'UnknownError';
    const message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    const constraint = (err as { constraint?: string })?.constraint;
    let reason: CameraFailureReason;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') reason = 'denied';
    else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError')
      reason = 'not-found';
    else if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') reason = 'in-use';
    else if (name === 'SecurityError' || name === 'TypeError') reason = 'unsupported';
    else reason = 'no-camera';
    return { reason, name, message, constraint };
  };

  /**
   * THE open cascade: getUserMedia → one live stream → attach → metadata →
   * play() → non-zero dimensions → real-frame proof. It NEVER stops a stream,
   * and a keep-alive failure leaves the stream ALIVE for the caller to
   * re-observe (§16/§17).
   */
  const openCameraStream = async (
    facingMode: 'user' | 'environment',
    purpose: 'face' | 'doc',
    customDeviceId?: string,
  ): Promise<CameraResult> => {
    const mediaDevices = navigator.mediaDevices;
    const hasGum = typeof mediaDevices?.getUserMedia === 'function';

    cameraStartingRef.current = true;
    cameraStartAttemptsRef.current += 1;
    // Stale-open guard (§17): any stop bumps cameraSessionRef; an open still
    // awaiting discards its late stream instead of attaching to a dead session.
    const sessionId = ++cameraSessionRef.current;

    /** Stop + forget a failed/superseded stream. */
    const discard = (s: MediaStream) => {
      s.getTracks().forEach((t) => t.stop());
      if (streamRef.current === s) streamRef.current = null;
      activeStreamIdsRef.current.delete(s.id);
      streamDestroyedCountRef.current += 1;
    };

    /** §11: mark the stream as HELD for this session. From here the camera is
     *  ON and nothing but stopCamera() may take it off. */
    const markActive = () => {
      if (cameraActiveRef.current) return;
      cameraActiveRef.current = true;
      setCameraActive(true);
    };
    /** §10: a REAL frame was presented. Monotonic within the session — a failed
     *  detection frame NEVER sets this back to false. */
    const markFrameReady = () => {
      realFrameReceivedRef.current = true;
      if (frameReadyRef.current) return;
      frameReadyRef.current = true;
      setFrameReady(true);
    };

    // Environment + request diagnostics (§3/§4) — printed once per start so the
    // console proves exactly what the browser context allows.
    console.log('[SellerCamera] REQUESTING CAMERA', {
      purpose,
      facingMode,
      customDeviceId: customDeviceId ?? 'default',
      location: window.location.href,
      secureContext: window.isSecureContext,
      mediaDevices: !!mediaDevices,
      getUserMedia: hasGum,
      sessionId,
    });

    try {
      if (!mediaDevices || !hasGum) {
        lastCameraErrorRef.current = {
          name: 'MissingGetUserMedia',
          message: 'navigator.mediaDevices.getUserMedia is unavailable in this browser/context',
        };
        cameraFailureCountRef.current += 1;
        console.error('[SellerCamera] getUserMedia unavailable', { mediaDevices: !!mediaDevices, hasGum });
        return {
          ok: false,
          reason: 'unsupported',
          errorName: 'MissingGetUserMedia',
          errorMessage: 'navigator.mediaDevices.getUserMedia is not available',
        };
      }

      let stream: MediaStream;
      try {
        const videoConstraints: MediaTrackConstraints = customDeviceId
          ? { deviceId: { ideal: customDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } };
        stream = await mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch (err) {
        const mapped = mapGumError(err);
        lastCameraErrorRef.current = { name: mapped.name, message: mapped.message, constraint: mapped.constraint };
        cameraFailureCountRef.current += 1;
        console.error('[SellerCamera] getUserMedia FAILED', mapped);
        return {
          ok: false,
          reason: mapped.reason,
          errorName: mapped.name,
          errorMessage: mapped.message,
          constraint: mapped.constraint,
        };
      }

      gumCallCountRef.current += 1;
      streamCreatedCountRef.current += 1;
      activeStreamIdsRef.current.add(stream.id);
      console.log('[SellerCamera] stream', stream.id);

      // Check if the opened track is a virtual camera driver (e.g. Smart Connect Camera, OBS)
      // that produces black frames when disconnected. Now that camera permission is granted,
      // enumerateDevices() will return full device labels. If a physical camera exists, auto-switch to it.
      const initialTrack = stream.getVideoTracks()[0];
      const initialLabel = initialTrack?.label || '';
      const isVirtual = (lbl: string) => /smart\s*connect|virtual|obs|droidcam|v4l2loopback/i.test(lbl);

      if (!customDeviceId && isVirtual(initialLabel)) {
        console.warn('[SellerCamera] Default camera is a virtual driver (' + initialLabel + '). Checking for physical hardware webcam...');
        try {
          const allDevs = await mediaDevices.enumerateDevices();
          const vInputs = allDevs.filter((d) => d.kind === 'videoinput');
          const physicalCam = vInputs.find((d) => d.label && !isVirtual(d.label));
          if (physicalCam && physicalCam.deviceId) {
            console.warn('[SellerCamera] Auto-switching from virtual camera to physical hardware camera:', physicalCam.label);
            stream.getTracks().forEach((t) => t.stop());
            activeStreamIdsRef.current.delete(stream.id);
            stream = await mediaDevices.getUserMedia({
              video: { deviceId: { exact: physicalCam.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false,
            });
            activeStreamIdsRef.current.add(stream.id);
          }
        } catch (switchErr) {
          console.warn('[SellerCamera] Auto-switch to physical camera failed; keeping current stream', switchErr);
        }
      }

      console.log('[SellerCamera] getUserMedia SUCCESS', {
        streamId: stream.id,
        track: stream.getVideoTracks().map((t) => ({
          id: t.id,
          label: t.label,
          readyState: t.readyState,
          enabled: t.enabled,
          muted: t.muted,
          settings: (() => {
            try {
              return t.getSettings();
            } catch (e) {
              console.warn('[SellerCamera] getSettings() unavailable', e);
              return {};
            }
          })(),
        })),
      });

      if (sessionId !== cameraSessionRef.current) {
        // A stop (cancel/navigate/remount) superseded this open mid-flight.
        console.warn('[SellerCamera] discarding stale (superseded) stream', stream.id);
        discard(stream);
        return { ok: false, reason: 'no-camera' };
      }

      // §12 track monitoring — diagnostics ONLY. There is deliberately NO
      // `track.onended = () => startCamera()` anywhere in this file: that pattern
      // is what produces an endless STOP → START → STOP → START flicker. Real
      // recovery is a one-shot, cooled-down, user-observable action (§13).
      stream.getVideoTracks().forEach((track) => {
        const label = track.label || 'video';
        console.log('[SellerCamera] track', track.readyState, track.enabled);
        track.onmute = () => {
          console.warn('[SellerCamera] track MUTED (no auto-restart)', { stream: stream.id, label });
        };
        track.onended = () => {
          console.warn('[SellerCamera] VIDEO TRACK ENDED', {
            stream: stream.id,
            label,
            state: track.readyState,
            sessionId,
          });
          // Report the WHY; the health monitor decides once whether to recover.
          // Nothing restarts the camera from here.
          if (stream.getVideoTracks().every((t) => t.readyState !== 'live')) {
            activeStreamIdsRef.current.delete(stream.id);
          }
        };
      });

      streamRef.current = stream;
      // The <video> must actually be a LIVE, CONNECTED DOM node — a detached
      // node can fire loadedmetadata and resolve play() yet never paint a
      // pixel (§3/§10). Wait briefly for DOM insertion and log diagnostics.
      let el = videoRef.current;
      if (!el || !el.isConnected) {
        console.warn('[SellerCamera] video element not mounted/connected yet — waiting for DOM insertion', { el });
        for (let i = 0; i < 30 && (!el || !el.isConnected); i++) {
          el = videoRef.current ?? el;
          if (el && el.isConnected) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        console.log('[SellerCamera] video connection wait done', { isConnected: el?.isConnected ?? false, element: el });
      }
      attachedVideoRef.current = el;
      if (!el || !el.isConnected) {
        // Stream stays LIVE (§16/§17) and is now the ACTIVE session: the
        // <video>-stability effect attaches it as soon as the node mounts.
        markActive();
        console.error('[SellerCamera] VIDEO ELEMENT NEVER IN THE DOM — stream kept alive', stream.id);
        lastCameraErrorRef.current = { name: 'NoVideoElement', message: 'the <video> element was not mounted in DOM' };
        cameraFailureCountRef.current += 1;
        return {
          ok: false,
          reason: 'black-preview',
          keepAlive: true,
          errorName: 'NoVideoElement',
          errorMessage: '<video> not mounted in DOM — frames cannot render',
        };
      }
      if (!el.isConnected) {
        // Stream stays LIVE and is the ACTIVE session; the <video>-stability
        // effect will attach it when the node is actually in the DOM (§7).
        markActive();
        lastCameraErrorRef.current = {
          name: 'VideoNotConnected',
          message: 'the <video> element never entered the DOM',
        };
        cameraFailureCountRef.current += 1;
        console.error('[SellerCamera] VIDEO ELEMENT NEVER IN THE DOM — frames cannot render (root cause)', {
          el,
          videoRef: videoRef.current,
        });
        return {
          ok: false,
          reason: 'black-preview',
          keepAlive: true,
          errorName: 'VideoNotConnected',
          errorMessage: '<video> never entered the DOM — frames cannot render',
        };
      }

      // Point-1 diagnostic: the exact element + its real layout (§1/§10/§11/§12).
      console.log('[SellerCamera] VIDEO ELEMENT', el);
      const cs = getComputedStyle(el);
      console.log('[SellerCamera] VIDEO STYLE', {
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        width: cs.width,
        height: cs.height,
        position: cs.position,
        zIndex: cs.zIndex,
        objectFit: cs.objectFit,
      });
      console.log('[SellerCamera] VIDEO RECT', el.getBoundingClientRect());
      console.log('[SellerCamera] VIDEO STATE', {
        isConnected: el.isConnected,
        paused: el.paused,
        readyState: el.readyState,
        currentTime: el.currentTime,
        srcObject: !!el.srcObject,
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
      });

      // Force the correct media attributes before attaching (§4) — never controls.
      el.autoplay = true;
      el.muted = true;
      el.playsInline = true;

      // Video pipeline events — fired once per element, removed on stop (§20).
      videoEventLoggerCleanupRef.current?.();
      const logVideoEvent = (e: Event) => {
        console.log('[SellerCamera] VIDEO EVENT', e.type, {
          readyState: el.readyState,
          currentTime: el.currentTime,
          width: el.videoWidth,
          height: el.videoHeight,
          paused: el.paused,
          stream: stream.id,
        });
      };
      const eventTypes = ['loadedmetadata', 'canplay', 'playing', 'stalled', 'waiting', 'error'] as const;
      eventTypes.forEach((t) => el.addEventListener(t, logVideoEvent));

      videoEventLoggerCleanupRef.current = () => {
        eventTypes.forEach((t) => el.removeEventListener(t, logVideoEvent));
      };

      el.srcObject = stream;
      streamRef.current = stream;
      setCameraStream(stream);
      videoAttachCountRef.current += 1;
      // §8 EXACT ORDER: stream held → srcObject → play() → dimensions →
      // frameReady. The session becomes ACTIVE only now that the stream is
      // attached, so the <video>-stability effect can never race this attach
      // and re-assign srcObject (which would restart decoding).
      markActive();
      console.log('[SellerCamera] stream attached to <video>', {
        stream: stream.id,
        sessionId,
        isConnected: el.isConnected,
      });

      // Kickstart decoding immediately
      try {
        await el.play();
        videoPlayCountRef.current += 1;
      } catch (earlyPlayErr) {
        console.debug('[SellerCamera] early video.play kickstart waiting for metadata', earlyPlayErr);
      }

      // Spec §1: metadata → real dimensions + readyState ≥ HAVE_CURRENT_DATA → play().
      const metaReady = await waitForMetadata(el);
      if (sessionId !== cameraSessionRef.current) {
        discard(stream);
        return { ok: false, reason: 'no-camera' };
      }
      if (metaReady) videoMetadataCountRef.current += 1;
      console.log('[SellerCamera] metadata', {
        readyState: el.readyState,
        dims: [el.videoWidth, el.videoHeight],
        metaReady,
        currentTime: el.currentTime,
      });

      if (!metaReady) {
        // No decoded frame within the patience budget. The stream is OPEN and
        // attached — keep it ALIVE; the caller retries observation (§16/§17).
        lastCameraErrorRef.current = {
          name: 'NoDecodedFrame',
          message: 'the stream opened, was attached, but the <video> never decoded a frame — stream kept alive',
        };
        cameraFailureCountRef.current += 1;
        console.error('[SellerCamera] stream opened but frame never decoded (stream KEPT ALIVE)', {
          readyState: el.readyState,
          dims: [el.videoWidth, el.videoHeight],
          currentTime: el.currentTime,
          isConnected: el.isConnected,
        });
        return {
          ok: false,
          reason: 'black-preview',
          keepAlive: true,
          errorName: 'NoDecodedFrame',
          errorMessage: 'attach ok, play ok, but the <video> never decoded a frame',
        };
      }

      try {
        await el.play();
        videoPlayCountRef.current += 1;
        console.log('[SellerCamera] video.play SUCCESS', { stream: stream.id, sessionId });
      } catch (err) {
        // play() refusal with a live attached stream — the stream stays ALIVE;
        // the caller can retry play/observation (§16/§17). Never discard here.
        const mapped = mapGumError(err);
        lastCameraErrorRef.current = { name: mapped.name, message: mapped.message };
        cameraFailureCountRef.current += 1;
        console.error('[SellerCamera] video.play FAILED (stream KEPT ALIVE)', mapped);
        return {
          ok: false,
          reason: mapped.reason,
          keepAlive: true,
          errorName: mapped.name,
          errorMessage: mapped.message,
        };
      }

      if (sessionId !== cameraSessionRef.current) {
        discard(stream);
        return { ok: false, reason: 'no-camera' };
      }

      // REAL frame check — play() alone proves nothing (§5-§9). The stream
      // stays live throughout; on timeout we report the failing evidence and
      // let the caller retry OBSERVATION, never getUserMedia (§16/§17).
      const frameReport = await observeRealFrames(el, 15000);
      if (sessionId !== cameraSessionRef.current) {
        discard(stream);
        return { ok: false, reason: 'no-camera' };
      }
      if (!frameReport.ok) {
        lastCameraErrorRef.current = {
          name: 'NoRenderedFrame',
          message: `stream opened + attached + play() ok, but no real frame after 15s (${frameReport.reason}). Stream KEPT ALIVE — retry observation, never re-open.`,
        };
        cameraFailureCountRef.current += 1;
        console.error('[SellerCamera] no real frame rendered — stream KEPT ALIVE', {
          readyState: el.readyState,
          dims: [el.videoWidth, el.videoHeight],
          currentTime: el.currentTime,
          isConnected: el.isConnected,
          report: frameReport,
        });
        return {
          ok: false,
          reason: 'black-preview',
          keepAlive: true,
          errorName: 'NoRenderedFrame',
          errorMessage: frameReport.reason,
        };
      }

      // Verified: live track + decoded + play() + a REAL rendered frame.
      markFrameReady();
      cameraSuccessCountRef.current += 1;
      console.log('[SellerCamera] camera READY', {
        stream: stream.id,
        readyState: el.readyState,
        dims: [el.videoWidth, el.videoHeight],
        currentTime: el.currentTime,
        frameProof: frameReport.reason,
      });
      return { ok: true };
    } finally {
      cameraStartingRef.current = false;
    }
  };

  /**
   * THE single camera controller (§1/§2/§6/§8/§17).
   *
   * Guarantees, in order:
   *   1. A LIVE stream is already held → REUSE it. No getUserMedia, ever.
   *   2. An open is already in flight → JOIN it. Extra callers (double-click,
   *      a health-monitor retry racing the button) share ONE promise instead of
   *      forcing a second getUserMedia.
   *   3. Otherwise run exactly ONE open cascade.
   * It contains no dependency on face / frame / progress state, so a state
   * change can never re-enter it.
   */
  const startCamera = async (
    facingMode: 'user' | 'environment',
    purpose: 'face' | 'doc',
    customDeviceId?: string,
  ): Promise<CameraResult> => {
    // ══ THE GATE ══════════════════════════════════════════════════════════
    // Every path that could bring a camera up goes through this function, so
    // this is the one place the "camera must not run once the check is over"
    // rule can be enforced for real. It runs BEFORE the reuse branch and before
    // any counter, flag or session id is touched, so a refused open leaves no
    // trace and no half-started camera for a later retry to inherit.
    //
    // Consulted against the SAME derivation the screen renders from, so a
    // terminal state added to `liveFaceCheck.ts` cannot leave a camera path
    // behind. A reload under review, a post-submit retry, and a stale
    // "Enable Camera" button are all refused here rather than in three
    // separate places that could each be forgotten.
    if (cameraIsForbidden()) {
      console.warn('[SellerCamera] REFUSED — the live check is already finished', {
        purpose,
        derivedState: deriveLiveNowFromRefs().state,
      });
      return {
        ok: false,
        reason: 'check-already-finished',
        errorName: 'CheckAlreadyFinished',
        errorMessage: 'the live check is already submitted or decided by the server',
      };
    }

    const live = streamRef.current;
    if (live && live.getVideoTracks().some((t) => t.readyState === 'live') && !customDeviceId) {
      // Reuse, never a second capture (§6).
      const el = videoRef.current;
      if (el) {
        attachedVideoRef.current = el;
        if (el.srcObject !== live) {
          el.autoplay = true;
          el.muted = true;
          el.playsInline = true;
          el.srcObject = live;
          videoAttachCountRef.current += 1;
        }
        setCameraStream(live);
        if (el.paused) {
          void el.play().catch((err) => console.warn('[SellerCamera] resume play failed', err));
        }
      }
      if (!cameraActiveRef.current) {
        cameraActiveRef.current = true;
        setCameraActive(true);
      }
      console.log('[SellerCamera] reusing the live stream (no new getUserMedia)', live.id);
      if (!realFrameReceivedRef.current) {
        let checkEl = videoRef.current;
        for (let i = 0; i < 15 && (!checkEl || checkEl.readyState < 2 || checkEl.videoWidth < 2); i++) {
          checkEl = videoRef.current;
          if (checkEl && (checkEl.readyState >= 2 || checkEl.videoWidth >= 2)) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (checkEl && (checkEl.readyState >= 2 || checkEl.videoWidth >= 2)) {
          realFrameReceivedRef.current = true;
          frameReadyRef.current = true;
          setFrameReady(true);
          return { ok: true, reused: true };
        }
        // §8 honest: a live stream with no proven frame is NOT a ready camera.
        return {
          ok: false,
          reason: 'black-preview',
          keepAlive: true,
          errorName: 'NoFrameProofYet',
          errorMessage: 'the stream is open but no real frame has been proven yet',
        };
      }
      return { ok: true, reused: true };
    }

    // One open cascade at a time — extra callers JOIN it (§2, §89).
    if (cameraOpenRef.current) {
      console.log('[SellerCamera] start joined the in-flight open (no new getUserMedia)');
      return cameraOpenRef.current;
    }
    const run = openCameraStream(facingMode, purpose, customDeviceId).finally(() => {
      if (cameraOpenRef.current === run) cameraOpenRef.current = null;
      cameraStartingRef.current = false;
    });
    cameraOpenRef.current = run;
    return run;
  };

  const getPreferredDeviceId = async (): Promise<string | undefined> => {
    if (typeof navigator?.mediaDevices?.enumerateDevices !== 'function') return undefined;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      if (videoInputs.length <= 1) return undefined;
      // Skip virtual camera drivers that emit black/blank frames when disconnected (e.g. Smart Connect, OBS)
      const isVirtual = (label: string) => /smart\s*connect|virtual|obs|droidcam|v4l2loopback/i.test(label);
      const realCam = videoInputs.find((d) => d.label && !isVirtual(d.label));
      if (realCam) {
        console.warn('[SellerCamera] Auto-selecting physical hardware camera:', realCam.label);
        return realCam.deviceId;
      }
    } catch (err) {
      console.warn('[SellerCamera] getPreferredDeviceId failed', err);
    }
    return undefined;
  };

  const enableCamera = async (overrideFacingMode?: 'user' | 'environment', customDeviceId?: string) => {
    setLastError('');
    setCameraIssue(null);
    grantRecoveryBudget(); // explicit user action → fresh one-shot budget (§13)
    preloadFaceLandmarker();
    const mode = overrideFacingMode ?? facingMode;
    let targetDeviceId = customDeviceId;
    if (!targetDeviceId) {
      targetDeviceId = await getPreferredDeviceId();
    }
    const res = await startCamera(mode, 'face', targetDeviceId);
    if (res.ok) {
      resetLiveAttempt();
      setLastError('');
      setPhase('capture');
      return;
    }
    if (res.keepAlive) {
      setCameraIssue(
        cameraFailureMessage('black-preview', false, res.errorName, res.errorMessage),
      );
      return;
    }
    if (res.reason === 'check-already-finished') {
      console.warn('[VerifyFlow] camera gate refused an open — re-reading the server status');
      await init();
      return;
    }
    setLastError(cameraFailureMessage(res.reason, false, res.errorName, res.errorMessage));
    setPhase('error');
  };

  /** Flip / switch camera: toggles front/rear camera or cycles through connected devices. */
  const flipCamera = async () => {
    grantRecoveryBudget();
    stopCamera('user-flip-camera');

    let v: MediaDeviceInfo[] = [];
    if (typeof navigator?.mediaDevices?.enumerateDevices === 'function') {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        v = all.filter((d) => d.kind === 'videoinput');
        if (v.length > 0) setVideoDevices(v);
      } catch (err) {
        console.warn('[SellerCamera] enumerateDevices in flipCamera failed', err);
      }
    }
    if (v.length === 0) v = videoDevices;

    if (v.length > 1) {
      const nextIdx = (activeDeviceIndexRef.current + 1) % v.length;
      activeDeviceIndexRef.current = nextIdx;
      setActiveDeviceIndex(nextIdx);
      const nextDevice = v[nextIdx];
      console.warn('[SellerCamera] flip camera: switching to device', {
        index: nextIdx,
        total: v.length,
        label: nextDevice.label || nextDevice.deviceId,
      });
      await enableCamera(facingMode, nextDevice.deviceId);
    } else {
      const nextMode = facingMode === 'user' ? 'environment' : 'user';
      setFacingMode(nextMode);
      console.warn('[SellerCamera] flip camera: toggling facingMode to', nextMode);
      await enableCamera(nextMode);
    }
  };

  /**
   * Re-observe the ALREADY-OPEN stream for real frames (§16/§17). This is the
   * ONLY retry for a keep-alive stream: it never calls getUserMedia again,
   * never stops tracks, never replaces the video. If the session collapsed,
   * it falls back to a genuine user-initiated open.
   */
  const retryFrameObservation = async () => {
    const stream = streamRef.current;
    if (!stream) {
      // The session truly collapsed — a genuine user-initiated open is the
      // only honest path (no stream exists to keep alive). Read the LIVE phase:
      // an async closure would capture a stale value (rule §7/§17).
      if (phaseRef.current === 'document') void openDocCamera();
      else void enableCamera();
      return;
    }
    if (phaseRef.current === 'document' && !docCameraOpenRef.current) {
      // The mid-open close raced this retry — the stream is superseded.
      stopCamera('doc-camera-closed-while-opening');
      return;
    }
    // §13 an explicit Retry is a user action → it refreshes the one-shot budget.
    grantRecoveryBudget();
    // Stream is live but the <video> may not be committed yet — wait for it,
    // and NEVER re-open just because the element lags the stream (§17).
    let el = videoRef.current;
    if (!el || !el.isConnected) {
      for (let i = 0; i < 25 && (!el || !el.isConnected); i++) {
        el = videoRef.current;
        if (el?.isConnected) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!el || !el.isConnected) {
      console.error('[SellerCamera] retry: stream alive but no connected <video>', { el, stream: stream.id });
      setCameraIssue(
        'The stream is open but the video element is not ready yet. Tap Retry Camera once the camera stays open.',
      );
      return;
    }
    if (el.srcObject !== stream) {
      el.srcObject = stream;
      el.muted = true;
    }
    setCameraStream(stream);
    if (el.paused) {
      try {
        await el.play();
        videoPlayCountRef.current += 1;
      } catch (err) {
        const mapped = mapGumError(err);
        setCameraIssue(
          cameraFailureMessage(mapped.reason, phase === 'document', mapped.name, mapped.message),
        );
        return;
      }
    }
    console.log('[SellerCamera] retry frame observation — stream kept alive, no new getUserMedia', {
      stream: stream.id,
      el,
    });
    lastCameraErrorRef.current = null;
    setCameraIssue(null);
    const report = await observeRealFrames(el, 15000);
    if (report.ok) {
      // §10/§11: proof earned → frameReady flips ON and stays ON. A failed
      // observation below never flips it back, and never stops the stream.
      realFrameReceivedRef.current = true;
      frameReadyRef.current = true;
      setFrameReady(true);
      if (!cameraActiveRef.current) {
        cameraActiveRef.current = true;
        setCameraActive(true);
      }
      cameraSuccessCountRef.current += 1;
      if (phaseRef.current === 'document') {
        showToast('Live camera confirmed — you can capture the ID now.', 'success');
        return;
      }
      // Face flow: continue exactly like a successful enableCamera — a fresh
      // attempt with no inherited evidence.
      resetLiveAttempt();
      setLastError('');
      setPhase('capture');
      return;
    }
    // §10 a failed observation is a FACE/CAMERA-PROOF failure, not a lifecycle
    // event: the stream stays ON and frameReady is NOT reset. The honest Retry
    // re-observes this same stream — it never calls getUserMedia.
    setCameraIssue(
      cameraFailureMessage('black-preview', phaseRef.current === 'document', 'NoRenderedFrame', report.reason),
    );
  };

  // ── document camera (photograph the ID) ────────────────────────────────────
  const clearDocFile = useCallback(() => {
    if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
    setDocPreviewUrl(null);
    setDocFile(null);
  }, [docPreviewUrl]);

  const openDocCamera = async (preferUser = false, viaMonitor = false) => {
    // Re-entry lock: never run two opens concurrently on one <video>.
    if (docOpeningRef.current) return;
    docOpeningRef.current = true;
    try {
      // A USER-initiated open refreshes the one-shot auto-recovery budget
      // (§13). The monitor's own reopen (viaMonitor) must NOT reset it, or a
      // flapping device would reopen forever ("camera off and on" loop).
      if (!viaMonitor) grantRecoveryBudget();
      // Explicit session boundary: the previous stream is released BEFORE the
      // new one is opened, so there can never be two live streams at once.
      stopCamera('open-doc-camera');
      setDocCaptureOpen(true);
      docCameraOpenRef.current = true;
      setDocCameraStarting(true);
      setCameraIssue(null);
      docAutoCaptureFiredRef.current = false;
      docGoodSinceRef.current = null;
      setDocQuality(IDLE_DOC_QUALITY);
      setAutoCapturing(false);
      // Let the <video> element in the document phase mount, then attach the stream.
      await new Promise((resolve) => setTimeout(resolve, 0));
      let res = await startCamera(preferUser ? 'user' : 'environment', 'doc');
      // A real hardware-level failure (no device / in use) may be resolved by
      // the OTHER physical camera — try it ONCE. `startCamera` itself refuses a
      // second getUserMedia whenever a live stream is already held, so this can
      // never produce two concurrent streams. Permission and context errors are
      // NOT retried (they won't change per camera).
      if (!res.ok && (res.reason === 'not-found' || res.reason === 'in-use' || res.reason === 'no-camera')) {
        res = await startCamera(preferUser ? 'environment' : 'user', 'doc');
      }
      // The LIVE mirror, not the stale closure: a real user close (Cancel /
      // Choose from device) flips the ref; an open merely COMPLETING must not
      // look "closed" to us. This was the whole "camera READY → instant STOP"
      // race — the closure `docCaptureOpen` was `false` from the button render.
      if (!docCameraOpenRef.current) {
        // The user actually closed the camera while this open was in flight.
        stopCamera('doc-camera-closed-while-opening');
        return;
      }
      if (!res.ok) {
        if (res.reason === 'check-already-finished') {
          // The gate refused. Nothing was opened, so there is no stream to
          // release — just leave the camera closed and say the real reason. A
          // toast (not the error screen) because this is not a failure: it is
          // the flow correctly declining to run again.
          closeDocCamera('doc-camera-gate-refused');
          showToast(cameraFailureMessage(res.reason, true, res.errorName, res.errorMessage), 'error');
          return;
        }
        if (res.keepAlive) {
          // Stream is attached and alive but no real frame rendered → keep
          // the camera shell open AND keep the stream ON; the overlay's Retry
          // re-observes the SAME live stream instead of re-opening (§16/§17).
          setCameraIssue(cameraFailureMessage(res.reason, true, res.errorName, res.errorMessage));
        } else {
          // A hard failure (denied / unsupported / no device) — release the
          // stream so the camera light is genuinely off, then report honestly.
          closeDocCamera('doc-camera-open-failed');
          showToast(cameraFailureMessage(res.reason, true, res.errorName, res.errorMessage), 'error');
        }
      }
    } finally {
      setDocCameraStarting(false);
      docOpeningRef.current = false;
    }
  };

  const closeDocCamera = (why = 'doc-camera-user-close') => {
    stopCamera(why);
    setDocCaptureOpen(false);
    docCameraOpenRef.current = false;
    setDocCameraStarting(false);
  };

  /** Snapshot the live camera as a JPEG, downscaled and kept under the 2 MB cap. */
  const captureDocPhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraReady) {
      showToast('Camera is still starting — wait for the live preview, then capture.', 'error');
      return;
    }
    const maxW = 1280;
    const maxH = 960;
    const srcW = video.videoWidth || maxW;
    const srcH = video.videoHeight || maxH;
    const scale = Math.min(1, maxW / srcW, maxH / srcH);
    canvas.width = Math.max(2, Math.round(srcW * scale));
    canvas.height = Math.max(2, Math.round(srcH * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      showToast('Could not process the captured photo. Please try again.', 'error');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    let quality = 0.85;
    let blob: Blob | null = null;
    do {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size > MAX_ID_FILE_BYTES) quality -= 0.1;
    } while (blob && blob.size > MAX_ID_FILE_BYTES && quality >= 0.4);

    if (!blob || blob.size > MAX_ID_FILE_BYTES) {
      showToast('The captured photo is too large — please retake or choose from your device.', 'error');
      return;
    }
    const file = new File([blob], 'id-photo.jpg', { type: 'image/jpeg' });
    if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
    setDocPreviewUrl(URL.createObjectURL(file));
    setDocFile(file);
    closeDocCamera('doc-camera-captured');
    showToast('ID photo captured — review it, then upload and verify.');
  };

  // ── capture ────────────────────────────────────────────────────────────────
  /**
   * Capture the CURRENT video frame (spec §8): canvas sized from the video's
   * REAL intrinsic dimensions (never CSS size), full-frame drawImage, JPEG.
   * The frame is downscaled to ≤ 960 px on the long side and the JPEG quality
   * backs off if needed so it stays well under the server's 800 KB/frame cap.
   */
  let grabCanvas: HTMLCanvasElement | null = null;
  const grabFrame = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) {
        resolve(null);
        return;
      }
      if (!grabCanvas && typeof document !== 'undefined') {
        grabCanvas = document.createElement('canvas');
      }
      if (!grabCanvas) {
        resolve(null);
        return;
      }
      const srcW = video.videoWidth;
      const srcH = video.videoHeight;
      const maxDim = 640; // 640px JPEG is ~40-80 KB, way below 800 KB cap, and encodes in 3ms
      const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
      const targetW = Math.max(2, Math.round(srcW * scale));
      const targetH = Math.max(2, Math.round(srcH * scale));
      if (grabCanvas.width !== targetW || grabCanvas.height !== targetH) {
        grabCanvas.width = targetW;
        grabCanvas.height = targetH;
      }
      const context = grabCanvas.getContext('2d');
      if (!context) {
        resolve(null);
        return;
      }
      context.drawImage(video, 0, 0, targetW, targetH);
      grabCanvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.75);
    });

  /**
   * Buffer one throttled frame of the live preview for the blink-window upload.
   *
   * This reuses the EXISTING `grabFrame` (real intrinsic dimensions, ≤960 px
   * long side, quality backed off under the server's 800 KB cap) rather than
   * adding a second, different capture path — so the bytes uploaded on submit
   * are produced by exactly the same code that always produced them, and cannot
   * drift from what the liveness models were tuned for.
   *
   * Errors are logged and swallowed ON PURPOSE, with the reason stated: this is
   * a speculative buffer. A single failed conversion must not take down the
   * detection loop that is still doing its real job, and there is genuinely
   * nothing the user can do about a canvas encoding failure. The submit path
   * independently refuses to proceed if the buffer turned out to be unusable,
   * so a failure here degrades to "Submit is unavailable", never to a wrong
   * upload.
   */
  const captureBufferedFrame = async (at: number): Promise<void> => {
    if (bufferBusyRef.current) return;
    // The session id is read from the REF, not from a `ctx` closure. The
    // detection loop's effect is deliberately not keyed on the session, so the
    // closure it captured could be from a render before a session change — and
    // frames would then be written into the previous session's window, where
    // `takeBlinkWindow` would never look for them. A ref is always current, so
    // this is correct regardless of when the loop started.
    const sessionId = ctxRef.current?.sessionId ?? null;
    if (!sessionId) return;
    bufferBusyRef.current = true;
    try {
      const blob = await grabFrame();
      if (blob) pushBlinkWindowFrame(sessionId, blob, at);
    } catch (err) {
      console.warn('[SellerVerification] buffered frame capture failed', err);
    } finally {
      bufferBusyRef.current = false;
    }
  };

  /**
   * Reset every per-attempt detector, so a NEW attempt must re-prove everything
   * from scratch: position, hold, and blink.
   *
   * Called when the camera is (re)opened for a fresh attempt and when an attempt
   * is abandoned. `faceStatusRef` returns to 'no-frame' rather than 'no-face',
   * because until the detector has actually run there is no face verdict to
   * report — that distinction is what stops the UI claiming "no face detected"
   * during every warm-up.
   */
  const resetLiveAttempt = (): void => {
    stabilityGateRef.current.reset();
    // A new attempt must re-prove its position from scratch. Nothing about
    // "the camera is open" or "a burst was requested" is evidence of a position.
    positionLatchRef.current.reset();
    positioningPassedRef.current = false;
    faceValidRef.current = false;
    faceStatusRef.current = 'no-frame';
    placementProgressRef.current = 0;
    faceHeldRef.current = false;
    // The blink is per-attempt evidence, and the instant it happened is the
    // anchor for the upload window — both must go, or a second attempt would
    // inherit the first attempt's blink and its frames.
    blinkDetectedRef.current = false;
    blinkAtRef.current = null;
    setBlinkDetected(false);
    eyeGateRef.current.reset();
    // The EAR baseline is a property of ONE person's eyes in ONE attempt. A
    // second attempt must re-measure it: carrying a baseline over would make the
    // openness scale wrong, and an inherited baseline that happens to be low
    // would make an open eye look shut.
    earOpennessRef.current.reset();
    eyeOpennessRef.current = null;
    landmarkerErrorRef.current = null;
    setLandmarkerError(null);
  };

  /**
   * SUBMIT THE LIVE CHECK.
   *
   * The order of operations is the whole design, and each step exists to stop a
   * specific way this could be wrong:
   *
   *  1. **Lock first.** `submittingLiveRef` is set synchronously, before the
   *     first `await`. A double-click fires two handlers in the same tick, so a
   *     check that happened after an `await` would let both through and the user
   *     would be uploaded twice (§89, duplicate-request rule).
   *  2. **Verify the evidence is really there.** If the ring buffer cannot
   *     produce a window containing the blink, the submit is REFUSED with an
   *     honest message and the flow resets. Uploading post-blink frames instead
   *     would produce a server-side liveness failure the user can neither cause
   *     nor diagnose.
   *  3. **Release the camera before the long upload.** The live check is over
   *     the moment Submit is pressed; keeping an 8.99 MB-backed pipeline and a
   *     live MediaStream running through a multi-second round trip is pure
   *     risk, and the teardown also stops the buffer growing mid-upload.
   *  4. **Upload the burst, `final` on the last frame.** The backend analyses
   *     the burst for the blink and returns its own verdict.
   *  5. **Only then call `/complete`.** Completion never decides the outcome; it
   *     hands the case to a human. The response is asserted to be
   *     MANUAL_REVIEW / UNDER_REVIEW, and the UI is driven from the server's
   *     status, not from what we hoped it would say.
   *  6. **Release the camera only once the case is safe.** The camera is stopped
   *     when the burst is ACCEPTED, not when the request is sent — a rejected
   *     burst is a frame-quality result the user can fix by blinking again, and
   *     killing the stream first would leave them a "Try Again" button with no
   *     camera behind it and a wizard that has to be unwound to get one.
   */
  const submitLiveCheck = async (): Promise<void> => {
    // (1) Synchronous lock. No await has happened yet, so this is airtight.
    if (submittingLiveRef.current) return;
    // The session id is read BEFORE the first await from a ref, so it is the
    // session the frames were actually captured in — not one a re-render might
    // have swapped in while the user was reaching for the button.
    const sessionId = ctxRef.current?.sessionId ?? null;
    if (!sessionId) {
      setLastError('Your verification session has expired. Please restart the check.');
      setPhase('expired');
      return;
    }

    // (2) The evidence must exist BEFORE anything is torn down.
    const burst = takeBlinkWindow(sessionId, blinkAtRef.current);
    if (burst.length < 2) {
      setLastError(
        'We could not find the frames covering your blink. Please try the live check again.',
      );
      setPhase('captureFailed');
      // Honest failure, not a silent retry: the frames are gone, and pretending
      // otherwise would upload frames with no blink in them.
      resetLiveAttempt();
      clearBlinkWindow(sessionId);
      return;
    }

    submittingLiveRef.current = true;
    setAnalyzing(true);
    setLastError('');

    // Stop camera immediately: frames are already extracted in memory!
    // This turns off camera hardware, stops the requestAnimationFrame FaceLandmarker
    // loop, drops CPU/GPU usage to zero, and completely eliminates frame stutter/flicker!
    stopCamera('live-check-submitting');

    // The buffered frames are now referenced by `burst`, so the window can be
    // released immediately.
    clearBlinkWindow(sessionId);

    try {
      // (3) Send intermediate frames in parallel to reduce network latency
      const intermediate = burst.slice(0, -1);
      const lastBlob = burst[burst.length - 1];

      await Promise.all(
        intermediate.map(async (blob) => {
          const bytes = await blob.arrayBuffer();
          return verificationService.sendFrame(sessionId, 'blink', bytes, false);
        }),
      );

      // (4) Send the final frame which triggers server liveness check
      const finalBytes = await lastBlob.arrayBuffer();
      const res = await verificationService.sendFrame(sessionId, 'blink', finalBytes, true);

      if ('state' in res && !handleBlinkResult(res)) {
        return; // the server said no; the retry screen is already up
      }

      // (5) Hand to review.
      const done = await verificationService.complete(sessionId);
      noteServerState(done.state);
      // The type makes VERIFIED/REJECTED unrepresentable. This guard is the
      // runtime half: if the backend ever reintroduced an automatic outcome,
      // the page must not silently render a status the user did not decide.
      if (done.state !== 'MANUAL_REVIEW') {
        setLastError('The server returned an unexpected result. Please reload to see your status.');
        setPhase('error');
        return;
      }
      submittedLiveRef.current = true;
      setReviewStatus('UNDER_REVIEW');
      setPhase('manualReview');
    } catch (err) {
      handleError(err);
    } finally {
      submittingLiveRef.current = false;
      setAnalyzing(false);
    }
  };

  /**
   * What the backend said about the blink burst.
   *
   * Returns TRUE only when the burst was accepted, so the caller knows whether
   * to continue to `/complete` or to leave the retry screen up. That
   * distinction is the whole point: continuing past a rejection would ask the
   * server to complete a step it has not accepted, which it correctly refuses
   * with a 409.
   *
   * The camera stays ON for a merely-FAILED capture: the user can simply blink
   * again, and stopping the stream there was an off/on flicker source. It is
   * only turned off for outcomes that genuinely end the attempt.
   */
  const handleBlinkResult = (res: FaceFrameResponse): boolean => {
    if (!('state' in res)) return false;
    noteServerState(res.state);

    if (res.state === 'REJECTED') {
      stopCamera('attempts-exhausted');
      setLastError(res.message ?? 'Too many failed attempts. Please contact support.');
      setPhase('rejected');
      return false;
    }
    if (res.state === 'FACE_CAPTURE_REQUIRED' && res.stepFailed) {
      const retriesLeft = res.retriesLeft ?? 0;
      if (retriesLeft <= 0) {
        stopCamera('attempts-exhausted');
        setLastError('Too many failed attempts. Please contact support.');
        setPhase('rejected');
        return false;
      }
      setLastError(res.message ?? 'That capture was not accepted. Please blink once more.');
      setPhase('captureFailed');
      // The blink the server rejected is no longer evidence, and neither are the
      // frames around it — they belong to an attempt the server has closed. The
      // camera stays live so the retry needs nothing but another blink.
      resetLiveAttempt();
      clearBlinkWindow(ctxRef.current?.sessionId ?? null);
      return false;
    }
    if (res.state === 'LIVENESS_CHECK') {
      // The burst was accepted. The outcome is decided by the review step.
      setCtx((prev) =>
        prev && !prev.completedSteps.includes('blink') ? { ...prev, completedSteps: ['blink'] } : prev,
      );
    }
    // Only the accepted-final-frame shape falls through to here. Every other
    // shape returned above with `false`, so the caller stops.
    return res.state === 'LIVENESS_CHECK';
  };

  // ── restart helpers ────────────────────────────────────────────────────────
  const restartCapture = async () => {
    setIsBusy(true);
    try {
      // Explicit session end BEFORE re-entering the camera shell - a leftover
      // live stream would trigger a second getUserMedia and stream flicker.
      stopCamera('restart-session');
      // A new session id means a new frame window, so the OLD window must be
      // dropped here or those frames sit in memory for the life of the tab. The
      // blink goes with it: `ensureSession` may hand back a challenge the server
      // has not seen a burst for, and an inherited blink would submit instantly
      // against frames from an attempt the server has closed.
      clearBlinkWindow(ctxRef.current?.sessionId ?? null);
      resetLiveAttempt();
      grantRecoveryBudget(); // the user asked to start over (§13)
      const started = await ensureSession();
      if (started.state === 'NOT_STARTED') setPhase('document');
      else setPhase('cameraPermission');
    } catch (err) {
      handleError(err);
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * §3/§6 CAMERA CANCEL — this closes the CAMERA and nothing else.
   *
   * It deliberately does NOT touch the wizard: the accepted document, the
   * document type, the preview, the session id and the challenge progress all
   * survive, so the user resumes the SAME face step instead of being pushed
   * back to the first screen and made to upload the ID again. The previous
   * implementation called `setPhase('intro')` here, which is exactly what
   * rewound the whole wizard on cancel.
   *
   * The blink evidence is also cleared: a cancel ends the ATTEMPT, so leaving a
   * measured blink in place would let the user resume and immediately submit a
   * blink that happened before they cancelled — with frames the camera had not
   * even been running for. The in-memory frame window goes with it.
   */
  const cancelCameraVerification = () => {
    if (import.meta.env.DEV) {
      console.warn('[VerifyFlow] CAMERA CANCEL — camera only, wizard preserved', {
        phase: phaseRef.current,
        serverState: serverVerificationState,
        hasUploadedDocument: Boolean(docFile),
        hasPreview: Boolean(docPreviewUrl),
        docKind,
        sessionId: ctx?.sessionId ?? null,
        completedSteps: ctx?.completedSteps ?? [],
      });
    }
    stopCamera('user-cancel');
    clearBlinkWindow(ctxRef.current?.sessionId ?? null);
    resetLiveAttempt();
    setAnalyzing(false);
    setLastError('');
    setCameraIssue(null);
    // The document step stays done; the camera is simply OFF until the user
    // retries. Nothing here can rewind the wizard (§6).
    setPhase('cameraCancelled');
  };

  /**
   * §14 RETRY after a cancel. Deliberately inert: the camera stays OFF until the
   * user explicitly enables it, no getUserMedia runs here and NO new session is
   * created — the existing session id and completed poses are reused, so a
   * cancel/retry cycle costs the user nothing.
   */
  const retryCameraVerification = () => {
    if (import.meta.env.DEV) {
      console.warn('[VerifyFlow] RETRY CAMERA CHECK — camera stays OFF until the user enables it', {
        serverState: serverVerificationState,
        hasUploadedDocument: Boolean(docFile),
        sessionId: ctx?.sessionId ?? null,
        completedSteps: ctx?.completedSteps ?? [],
      });
    }
    setPhase('cameraPermission');
  };

  /**
   * §11/§12 CHANGE DOCUMENT — the ONE action allowed to discard the uploaded
   * document. It is a WIZARD action (an explicit session end), never a camera
   * one, so the camera is released first and the document state is then cleared.
   *
   * It is only OFFERED while the backend still accepts a new document. Once the
   * document is accepted the server answers 409 ("A document cannot be uploaded
   * at this stage"), so pretending otherwise would strand the user on a dead
   * screen.
   */
  const changeDocument = () => {
    if (!NEW_DOCUMENT_STATES.has(serverVerificationState)) {
      showToast(
        'Your ID document has already been accepted for this verification. Contact support if it needs to be changed.',
        'error',
      );
      return;
    }
    if (import.meta.env.DEV) {
      console.warn('[VerifyFlow] CHANGE DOCUMENT — the only path that clears the document', {
        serverState: serverVerificationState,
        hadDocument: Boolean(docFile),
      });
    }
    stopCamera('change-document'); // release any camera before the wizard moves
    grantRecoveryBudget(); // explicit user action → fresh one-shot budget (§13)
    setDocCaptureOpen(false);
    docCameraOpenRef.current = false;
    clearDocFile();
    // Face-check progress is meaningless against a different document, so the
    // whole per-attempt evidence is discarded — including the blink, which was
    // measured against the old document's framing.
    resetLiveAttempt();
    clearBlinkWindow(ctxRef.current?.sessionId ?? null);
    setAnalyzing(false);
    setLastError('');
    setPhase('document');
  };

  // ══ CAMERA LIFECYCLE — DERIVED, never stored ═══════════════════════════════
  // One source of truth built ONLY from real signals (stream / track / attached
  // element / decoded frame / proven real frame / loop / liveness / capture).
  // Because it is computed on every render, the impossible screen the camera
  // used to show — live picture + LIVE track + 1280×720 frame + one
  // getUserMedia call, while the UI said "Waiting for the camera…" and the
  // panel said the loop was idle — cannot be represented any more: with a
  // proven frame the state is never 'opening', and without one it never is
  // 'ready'. See src/lib/cameraLifecycle.ts.
  const liveVideo = videoRef.current;
  const liveTracks = streamRef.current?.getVideoTracks() ?? [];
  const cameraSignals = {
    hasStream: !!streamRef.current,
    trackLive: liveTracks.some((t) => t.readyState === 'live'),
    videoAttached: !!liveVideo && !!streamRef.current && liveVideo.srcObject === streamRef.current,
    readyState: liveVideo?.readyState ?? 0,
    videoWidth: liveVideo?.videoWidth ?? 0,
    videoHeight: liveVideo?.videoHeight ?? 0,
    frameProof: frameReadyRef.current || realFrameReceivedRef.current,
    starting: cameraStartingRef.current || cameraOpenRef.current !== null,
    closing: lastStopReasonRef.current !== '—' && !!streamRef.current && !cameraActiveRef.current,
    detectionLoopActive: detectionLoopCountRef.current === 1,
    /**
     * The camera lifecycle no longer has a "liveness is counting" input. There
     * is no pose timer to count down, so a face merely being detected can never
     * be reported as a liveness stage any more. It is asked whether a blink was
     * actually MEASURED, which is the only liveness evidence the client holds.
     */
    livenessCounting: blinkDetected,
    analyzing,
    // "Success" for the camera means THE LIVE CHECK IS OVER — nothing more is
    // coming from this stream. That is true once the server has recorded a
    // review decision (`reviewStatus`) or once our own submit was accepted
    // (`submittedLiveRef`), and false while a retryable problem is on screen.
    // Deliberately NOT `phase === 'manualReview'`: the camera lifecycle is
    // derived from signals, and a wizard phase is neither a signal nor
    // available to the telemetry sampler.
    success: reviewStatus !== null || submittedLiveRef.current,
    issue: !!cameraIssue || !!landmarkerError,
  };
  const cameraState: CameraLifecycleState = deriveCameraLifecycle(cameraSignals);
  const cameraFrameReady = isCameraFrameReady(cameraSignals);
  const cameraMissing = missingReadyConditions(cameraSignals);

  // Dev-only transition trace: names the state AND the signal responsible, so an
  // unexpected regression can never be a mystery. Derivation cannot "attempt" an
  // invalid transition, but a real one (a track that ended) must still be
  // visible rather than hidden.
  const lastCameraStateRef = useRef<CameraLifecycleState | ''>('');
  if (import.meta.env.DEV && lastCameraStateRef.current !== cameraState) {
    const previous = lastCameraStateRef.current;
    lastCameraStateRef.current = cameraState;
    // Name the cause honestly: a stop is only ever requested by an explicit user
    // action, an explicit session boundary, a one-shot recovery, a success or a
    // real unmount — so 'user' is accurate; anything else stays 'unknown' and
    // is reported rather than hidden.
    const cause: 'user' | 'success' | 'error' | 'unknown' = cameraIssue
      ? 'error'
      : cameraSignals.success
        ? 'success'
        : cameraSignals.closing
          ? 'user'
          : 'unknown';
    const illegal = previous ? illegalCameraTransition(previous, cameraState, cause) : null;
    console.log(
      `[SellerCamera] STATE TRANSITION ${previous || '(none)'} → ${cameraState}`,
      {
        illegal: illegal ?? false,
        ...(illegal ? { reason: illegal } : {}),
        cause,
        stream: streamRef.current ? 'held' : 'none',
        track: liveTracks.map((t) => t.readyState).join(',') || 'none',
        attached: cameraSignals.videoAttached,
        readyState: cameraSignals.readyState,
        video: `${cameraSignals.videoWidth}×${cameraSignals.videoHeight}`,
        currentTime: liveVideo ? Number(liveVideo.currentTime.toFixed(2)) : 0,
        frameProof: cameraSignals.frameProof,
        detectionLoop: cameraSignals.detectionLoopActive,
        missing: cameraMissing,
      },
    );
  }

  // ══ THE LIVE CHECK STATE — the ONE state the face UI is allowed to read ═══
  // Everything below is DERIVED from the same real signals on every render:
  // one state, one message, one colour. There is no stored state and no second
  // condition, so the contradiction this screen used to ship (a liveness label
  // next to "Position your face inside the frame") is no longer representable
  // rather than merely unlikely. See src/lib/liveFaceCheck.ts.
  const {
    state: liveState,
    message: liveMessage,
    contradiction: verificationFault,
  } = deriveLiveNow(cameraFrameReady, cameraSignals.detectionLoopActive, reviewStatus);
  // Every gating decision reads these predicates, never a re-test of the
  // signals. A button that re-derived its own condition would be a second
  // source of truth — which is the bug, not the fix.
  const submitEnabled = isSubmitEnabled(liveState);
  const cameraMayRun = isCameraAllowed(liveState);
  const liveCheckFinished = isTerminal(liveState);

  // §19 dev trace: the full picture on every state change, so a surprise can
  // never be a mystery. NUMBERS AND STATE NAMES ONLY — never frame data (§20).
  const lastVerifyStateRef = useRef<LiveCheckState | ''>('');
  if (import.meta.env.DEV && lastVerifyStateRef.current !== liveState) {
    const previous = lastVerifyStateRef.current;
    lastVerifyStateRef.current = liveState;
    if (previous) {
      console.log(`[VERIFY TRANSITION] ${previous} → ${liveState}`);
    }
    console.log('[VERIFY STATE]', {
      state: liveState,
      cameraState,
      faceDetected: faceCountRef.current === 1 && faceStatusRef.current !== 'no-frame',
      faceCount: faceCountRef.current,
      facePositioned: faceValidRef.current,
      faceHeld: faceHeldRef.current,
      holdProgress: `${(placementProgressRef.current * PLACEMENT_HOLD_SECONDS).toFixed(1)}s`,
      blinkMeasured: blinkDetected,
      // Numbers and instants only. No frame bytes, no face pixels, no scores.
      bufferedFrames: blinkWindowSize(ctxRef.current?.sessionId ?? null),
      submitEnabled,
      message: liveMessage,
      contradiction: verificationFault ?? false,
      ...(verificationFault ? { contradictionReason: verificationFault } : {}),
    });
  }

  // Throttled camera trace diagnostics (Rule 20)
  const lastCameraTraceAtRef = useRef(0);
  if (cameraActive) {
    const now = performance.now();
    if (now - lastCameraTraceAtRef.current > 2000) {
      lastCameraTraceAtRef.current = now;
      console.warn('[CAMERA TRACE] RENDER', {
        cameraOpen: cameraActive,
        cameraStatus: cameraState,
        wizardStep: phase,
      });
      console.warn('[CAMERA TRACE] STREAM', {
        streamId: streamRef.current?.id,
        tracks: streamRef.current?.getTracks().map((t) => ({
          kind: t.kind,
          readyState: t.readyState,
        })),
      });
      console.warn('[CAMERA TRACE] VIDEO', {
        readyState: liveVideo?.readyState,
        paused: liveVideo?.paused,
        currentTime: liveVideo?.currentTime,
        videoWidth: liveVideo?.videoWidth,
        videoHeight: liveVideo?.videoHeight,
        hasSrcObject: !!liveVideo?.srcObject,
      });
    }
  }

  // ══ screen shells ═══════════════════════════════════════════════════════════
  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">{children}</div>
  );

  const Header: React.FC<{ title: string; sub: string }> = ({ title, sub }) => (
    <div className="text-center space-y-3">
      <div className="w-16 h-16 rounded-3xl bg-cream-100 flex items-center justify-center text-burgundy mx-auto shadow-soft">
        <ScanFace className="w-8 h-8" />
      </div>
      <span className="text-xs font-bold uppercase tracking-widest text-burgundy block">
        Seller Identity Verification
      </span>
      <h1 className="text-3xl sm:text-4xl font-serif font-extrabold text-stone-900">{title}</h1>
      <p className="text-sm text-stone-600 max-w-xl mx-auto leading-relaxed">{sub}</p>
    </div>
  );

  const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
    children,
    className = '',
  }) => (
    <div className={`bg-white rounded-3xl p-8 sm:p-10 border border-cream-200 shadow-soft ${className}`}>
      {children}
    </div>
  );

  // ── 1 loading ──────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <Shell>
        <Header title="Loading your verification" sub="Checking the current status with the server…" />
        <div className="flex justify-center py-10">
          <Loader2 className="w-8 h-8 animate-spin text-burgundy" />
        </div>
      </Shell>
    );
  }

  // ── 3 unavailable ──────────────────────────────────────────────────────────
  if (phase === 'unavailable') {
    return (
      <Shell>
        <Header
          title="Verification is temporarily unavailable"
          sub="The identity-verification service is not configured on the server right now."
        />
        <Card className="text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="text-sm text-stone-600 max-w-md mx-auto leading-relaxed">
            K-Shop never fakes a verification result. Please try again later — your information
            stays safe and nothing has been submitted.
          </p>
          <Button variant="outline" onClick={() => void init()}>
            Try Again
          </Button>
        </Card>
      </Shell>
    );
  }

  // ── 2 intro / consent ──────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <Shell>
        <Header
          title="Verify your identity"
          sub="One short, secure check — face recognition runs on K-Shop's server, not in your browser."
        />
        <Card className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            {[
              { icon: <FileScan className="w-5 h-5" />, label: '1. ID photo', desc: 'JPG or PNG of your college / government ID' },
              { icon: <Camera className="w-5 h-5" />, label: '2. Live face check', desc: 'One clear look and one blink with your camera (~20 seconds)' },
              { icon: <ShieldCheck className="w-5 h-5" />, label: '3. Human review', desc: 'An administrator reviews your check against the document' },
            ].map((s) => (
              <div key={s.label} className="p-4 rounded-2xl bg-cream-50 border border-cream-200">
                <div className="text-burgundy flex justify-center mb-2">{s.icon}</div>
                <p className="font-serif font-bold text-sm text-stone-900">{s.label}</p>
                <p className="text-[11px] text-stone-500 mt-1 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-800 space-y-1 leading-relaxed">
              <p className="font-bold">Privacy promise</p>
              <p>
                Frames are analysed and then discarded by the server — they are never stored, logged
                or shared. Only the final decision (verified / pending review / not verified) is kept
                on your account.
              </p>
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consentAgreed}
              onChange={(e) => setConsentAgreed(e.target.checked)}
              className="mt-1 w-4 h-4 accent-burgundy rounded"
            />
            <span className="text-xs text-stone-600 leading-relaxed">
              I consent to K-Shop running identity verification on my ID document and a short live
              face capture, and to store the outcome (not the biometrics) for compliance purposes.
            </span>
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              isLoading={isBusy}
              onClick={() => void handleConsent()}
            >
              I Consent — Start Verification
            </Button>
            <Link to="/become-seller" className="flex-1">
              <Button variant="outline" size="lg" className="w-full">
                Back
              </Button>
            </Link>
          </div>
        </Card>
      </Shell>
    );
  }

  // ── 4/5 document ───────────────────────────────────────────────────────────
  if (phase === 'document' || phase === 'documentProcessing') {
    return (
      <Shell>
        <Header
          title="Upload your ID photo"
          sub="A clear, well-lit photo of your ID card with your face and name visible."
        />
        <Card className="space-y-5">
          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
              Document type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 'COLLEGE_ID', label: 'College ID' },
                  { value: 'GOVERNMENT_ID', label: 'Government ID' },
                  { value: 'OTHER', label: 'Other ID' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDocKind(opt.value)}
                  className={`py-2 text-[11px] rounded-xl border font-semibold transition-colors ${
                    docKind === opt.value
                      ? 'bg-burgundy text-white border-burgundy'
                      : 'bg-cream-50 border-stone-200 text-stone-700 hover:border-burgundy/50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
              ID photo
            </label>
            {docCaptureOpen ? (
              <div className="space-y-4">
                <div className="relative rounded-2xl overflow-hidden bg-stone-900 aspect-[4/3]">
                  {docCameraStarting && (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 text-white z-20">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="text-xs">Starting camera…</span>
                    </div>
                  )}
                  {autoCapturing && (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-white z-20">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="text-sm font-semibold">ID captured — holding…</span>
                    </div>
                  )}
                  <video ref={attachVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  {cameraReady && (
                    <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-emerald-500/90 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full shadow-md">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Camera live
                    </div>
                  )}
                  {/* Aadhaar-style guide frame: green when clear & in-frame, red otherwise */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <div
                      className={`w-[66%] aspect-[1.586/1] rounded-2xl border-4 transition-all duration-200 ${
                        docQuality.good
                          ? 'border-emerald-400 shadow-[0_0_28px_rgba(52,211,153,0.55)]'
                          : 'border-rosered-500 shadow-[0_0_28px_rgba(244,63,94,0.4)]'
                      }`}
                    />
                  </div>
                  {/* live status chip */}
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                    <div
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold shadow-md ${
                        docQuality.good ? 'bg-emerald-500/90 text-white' : 'bg-rosered-600/90 text-white'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          docQuality.good ? 'bg-white' : 'bg-white/70'
                        } animate-pulse`}
                      />
                      {docQuality.hint}
                    </div>
                  </div>
                  {cameraIssue && (
                    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
                      <AlertTriangle className="w-8 h-8 text-amber-400" />
                      <p className="text-xs text-white leading-relaxed max-w-sm">{cameraIssue}</p>
                      <div className="flex gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          isLoading={docCameraStarting}
                          onClick={() => void (cameraActive ? retryFrameObservation() : openDocCamera())}
                        >
                          <RefreshCw className="w-4 h-4" /> Retry Camera
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => closeDocCamera('doc-camera-user-close')}>
                          <Upload className="w-4 h-4" /> Choose from device
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                {/* dev-only live telemetry — text metrics, never frame data (§10) */}
                {cameraTelemetry && (
                  <DebugPanel
                    title="doc camera"
                    lines={[
                      ['stream', cameraTelemetry.streamActive ? 'ON' : 'OFF'],
                      ['session', cameraTelemetry.cameraActive ? 'ACTIVE' : 'inactive'],
                      [
                        'track',
                        `${cameraTelemetry.trackLive ? 'LIVE' : 'ENDED'}${cameraTelemetry.streamId !== 'none' ? ` · ${cameraTelemetry.streamId}` : ''} · ${cameraTelemetry.trackStates}`,
                      ],
                      ['frame ready', cameraTelemetry.frameReady ? 'YES' : 'no'],
                      ['detection loop', cameraTelemetry.detectionLoops === 1 ? 'ACTIVE' : 'IDLE'],
                      ['detection frame', cameraTelemetry.detectionRunning ? 'RUNNING' : 'between frames'],
                      ['camera state', cameraTelemetry.cameraState.toUpperCase()],
                      ['video', `rs ${cameraTelemetry.readyState} · ${cameraTelemetry.videoWidth}×${cameraTelemetry.videoHeight}`],
                      ['getUserMedia calls', String(cameraTelemetry.gumCalls)],
                      ['active streams', String(cameraTelemetry.activeStreams)],
                      ['detect loops', String(cameraTelemetry.detectionLoops)],
                      ['renders', String(cameraTelemetry.renders)],
                      ['attempt/succ/fail', `${cameraTelemetry.cameraStartAttempts}/${cameraTelemetry.cameraSuccessCount}/${cameraTelemetry.cameraFailureCount}`],
                      ['stops', String(cameraTelemetry.cameraStopCount)],
                      ['stream cr/dst', `${cameraTelemetry.streamCreatedCount}/${cameraTelemetry.streamDestroyedCount}`],
                      ['attach/play/meta', `${cameraTelemetry.videoAttachCount}/${cameraTelemetry.videoPlayCount}/${cameraTelemetry.videoMetadataCount}`],
                      ['video playing', cameraTelemetry.videoPlaying ? 'YES' : 'NO'],
                      ['currentTime', `${cameraTelemetry.videoCurrentTime.toFixed(2)}s`],
                      ['real frame', cameraTelemetry.realFrame ? 'YES' : 'NO'],
                      ['rVFC', cameraTelemetry.rvfcFired ? 'FIRED' : 'waiting'],
                      ['last stop', cameraTelemetry.lastStopReason],
                      ['ctx', `${cameraTelemetry.secureContext} · md ${cameraTelemetry.mediaDevicesAvailable ? 'Y' : 'N'} · gum ${cameraTelemetry.gumAvailable ? 'Y' : 'N'}`],
                      [
                        'last error',
                        cameraTelemetry.lastError
                          ? `${cameraTelemetry.lastError.name}${cameraTelemetry.lastError.constraint ? ` (${cameraTelemetry.lastError.constraint})` : ''}: ${cameraTelemetry.lastError.message}`
                          : '—',
                      ],
                      ['verdict', docQuality.verdict],
                      ['luma', docQuality.luma.toFixed(0)],
                      ['sharpness', docQuality.sharpness.toFixed(0)],
                      ['edge', docQuality.edgeDensity.toFixed(3)],
                      ['skin-guard', docAutoCaptureEnabled ? 'ON (auto armed)' : 'OFF (manual capture)'],
                      ['auto-capture', docAutoCaptureEnabled ? 'armed' : 'off'],
                    ]}
                  />
                )}
                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    size="lg"
                    className="flex-1"
                    isLoading={docCameraStarting || autoCapturing}
                    disabled={!docQuality.good || !cameraReady}
                    onClick={() => void captureDocPhoto()}
                    leftIcon={<Camera className="w-5 h-5" />}
                  >
                    {docCameraStarting
                      ? 'Starting camera…'
                      : !cameraReady
                        ? 'Waiting for live video…'
                        : docQuality.good
                          ? 'Capture ID Photo'
                          : docQuality.verdict === 'dark'
                            ? 'Too dark — improve lighting'
                            : docQuality.verdict === 'bright'
                              ? 'Too bright — reduce glare'
                              : docQuality.verdict === 'blurry'
                                ? 'Hold the camera steady'
                                : docQuality.verdict === 'partial'
                                  ? 'Fit the whole card in the frame'
                                  : 'Point the camera at the ID card'}
                  </Button>
                  <Button variant="outline" size="lg" onClick={() => closeDocCamera('doc-camera-user-close')} disabled={docCameraStarting}>
                    Cancel
                  </Button>
                </div>
                <p className="text-[11px] text-stone-500">
                  Line the card up inside the frame. It turns <span className={docQuality.good ? 'text-emerald-600 font-semibold' : 'text-rosered-600 font-semibold'}>green</span>{' '}
                  when the card is sharp and fills the frame — then press <b>Capture ID Photo</b>. The
                  photo is processed on this device and only uploaded when you submit it.
                </p>
                <label className="flex items-start gap-2 text-[11px] text-stone-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={docAutoCaptureEnabled}
                    onChange={(e) => setDocAutoCaptureEnabled(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-burgundy rounded"
                  />
                  <span>
                    Auto-capture when the frame stays green (optional) — the camera only closes after
                    it captures a good photo.
                  </span>
                </label>
                <canvas ref={canvasRef} className="hidden" />
              </div>
            ) : docFile ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-xl border border-cream-200 bg-cream-50">
                  {docPreviewUrl ? (
                    <img
                      src={docPreviewUrl}
                      alt="ID photo preview"
                      className="w-20 h-20 rounded-lg border border-stone-200 object-cover bg-white"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-lg border border-stone-200 bg-white flex items-center justify-center shrink-0">
                      <FileScan className="w-7 h-7 text-burgundy" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-stone-800 break-all">{docFile.name}</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">
                      {(docFile.size / 1024).toFixed(0)} KB · {docFile.type}
                    </p>
                    <p className="text-[11px] text-red-600 font-bold mt-1.5">
                      PDFs are not accepted — export your ID as a JPG or PNG photo.
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={clearDocFile} leftIcon={<RefreshCw className="w-4 h-4" />}>
                  Change photo
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void openDocCamera()}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border border-dashed border-stone-300 bg-cream-50 cursor-pointer hover:border-burgundy transition-colors"
                  >
                    <Camera className="w-5 h-5 text-burgundy" />
                    <span className="text-xs text-stone-600 font-semibold">Take a photo</span>
                    <span className="text-[10px] text-stone-400">Use your camera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => document.getElementById('verif-doc-input')?.click()}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border border-dashed border-stone-300 bg-cream-50 cursor-pointer hover:border-burgundy transition-colors"
                  >
                    <Upload className="w-5 h-5 text-stone-400" />
                    <span className="text-xs text-stone-600 font-semibold">Choose from device</span>
                    <span className="text-[10px] text-stone-400">JPG or PNG, up to 2 MB</span>
                  </button>
                </div>
                <input
                  id="verif-doc-input"
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    e.target.value = '';
                    handleDocPick(file);
                  }}
                />
              </>
            )}
          </div>

          {!docCaptureOpen && (
            <p className="text-[11px] text-stone-500">
              Your document is stored privately on the server and only used for this verification.
            </p>
          )}

          {!docCaptureOpen && (
            <div className="flex gap-3">
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                isLoading={isBusy || phase === 'documentProcessing'}
                onClick={() => void submitDocument()}
              >
                {phase === 'documentProcessing' ? 'Analysing your ID…' : 'Upload & Verify'}
              </Button>
              <Button variant="outline" size="lg" onClick={() => setPhase('intro')}>
                Back
              </Button>
            </div>
          )}

          {phase === 'documentProcessing' && (
            <div className="flex items-start gap-2 text-xs text-stone-500">
              <Clock className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                The server is checking the photo for readability, clarity and a single visible face.
                This takes a few seconds.
              </span>
            </div>
          )}
        </Card>
      </Shell>
    );
  }

  // ── 6 document accepted ────────────────────────────────────────────────────
  if (phase === 'documentAccepted') {
    return (
      <Shell>
        <Header
          title="ID document accepted"
          sub="Your document is verified. One step left — the live face check."
        />
        <Card className="space-y-5 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <p className="text-sm text-stone-600 max-w-md mx-auto leading-relaxed">
            Next you will look at the camera and blink once, so the server can send a short burst of
            frames for a reviewer to compare against the document. Nothing is sent until you press
            Submit. Your camera feed never leaves your browser except as compressed frames sent
            straight to the verification endpoint.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="min-w-[220px]"
            isLoading={isBusy}
            onClick={() => void beginFaceCapture()}
          >
            Continue to Live Face Check
          </Button>
        </Card>
      </Shell>
    );
  }

  // ── 7/8 document terminal ──────────────────────────────────────────────────
  if (phase === 'documentManualReview' || phase === 'documentRejected') {
    const rejected = phase === 'documentRejected';
    return (
      <Shell>
        <Header
          title={rejected ? 'Document not accepted' : 'Document under review'}
          sub={
            rejected
              ? 'We could not verify that photo.'
              : 'A human reviewer will check your document shortly.'
          }
        />
        <Card className="space-y-5 text-center">
          {rejected ? (
            <AlertTriangle className="w-12 h-12 text-rosered mx-auto" />
          ) : (
            <Clock className="w-12 h-12 text-amber-500 mx-auto" />
          )}
          <p className="text-sm text-stone-600 max-w-md mx-auto leading-relaxed">
            {rejected
              ? 'The server could not verify the photo — it may be blurry, too dark, show no single clear face, or be an unsupported document. You can try another photo, or contact support for help.'
              : 'The server could not make a confident decision from your document, so it was sent to our review team instead of being rejected. No action is needed from you right now.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {rejected && (
              <Button variant="primary" onClick={() => setPhase('document')}>
                Try Another Photo
              </Button>
            )}
            <Link to="/support">
              <Button variant="outline">Contact Support</Button>
            </Link>
          </div>
        </Card>
      </Shell>
    );
  }

  // ── 9/10/11/19 camera + capture + failed + cancelled ──────────────────────
  // `cameraCancelled` shares this shell ON PURPOSE: the <video> node, the
  // preview box and the dev panel stay mounted across a cancel, so cancelling
  // cannot remount (and therefore cannot re-open) the camera.
  //
  // `cameraMayRun` is part of the condition, not a decorative read. If the
  // derived state says the live check is over, this whole shell — including the
  // "Enable Camera" button and the video element — is not rendered at all, so
  // there is nothing on screen that could ask for a camera. The gate in
  // `startCamera` is the second, independent half: it refuses the open even if
  // this render were somehow reached.
  if (
    cameraMayRun &&
    (phase === 'cameraPermission' ||
      phase === 'capture' ||
      phase === 'captureFailed' ||
      phase === 'cameraCancelled')
  ) {
    /**
     * Aadhaar-style indicator: GREEN as soon as a single face is detected & well-placed
     * inside the oval guide, and RED until face is placed.
     */
    const faceGuideGood = !landmarkerError && (faceValidRef.current || faceHeldRef.current);
    // ONE source for the words: the message the derivation produced. No
    // `faceChipLabel` exists, and that is the point — it was an independent
    // decision that read the guide status directly, which is how a liveness
    // state could be captioned "Position your face inside the frame".
    const faceChipText = liveMessage;
    return (
      <Shell>
        <Header
          title={phase === 'captureFailed' ? 'Capture not accepted' : 'Live face check'}
          sub={
            phase === 'captureFailed'
              ? 'The server could not accept that capture. Please retry with good lighting.'
              : 'Your ID document is already uploaded and accepted ✓ — this camera is only a short LIVE face check to confirm you match that ID photo.'
          }
        />
        <Card className="space-y-5">
          {/*
            THE PROGRESS BAR IS THE STAGES THAT ARE ACTUALLY COMPLETE.

            There is no "Pose 2 of 4" counter, because there is no pose sequence.
            What remains is a fixed three-stage list — position, blink, submit —
            and the bar is driven by the ONE derived state, so a bar that reads
            100% while the chip says "blink" is not constructible.

            The stages after the current one are shown as pending rather than
            hidden: the user is told up front that there is a submit step, so
            "blink detected ✓" is not read as "you are finished".
          */}
          <div className="flex items-center justify-between text-[11px] text-stone-500">
            <span className="font-semibold uppercase tracking-wide text-burgundy">
              Live face check
            </span>
            <span>
              {liveCheckFinished
                ? 'submitted'
                : submitEnabled
                  ? 'ready to submit'
                  : faceHeldRef.current
                    ? 'blink next'
                    : 'position your face'}
            </span>
          </div>
          <div className="h-1.5 bg-cream-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-burgundy transition-all duration-500"
              style={{
                width: `${
                  liveCheckFinished
                    ? 100
                    : blinkDetected
                      ? 66
                      : faceHeldRef.current
                        ? 33
                        : 0
                }%`,
              }}
            />
          </div>

          {/* video preview (mirrored). previewBoxRef is the element the guide's
              percentages resolve against — the detection loop maps detector
              coordinates through its measured size. */}
          <div ref={previewBoxRef} className="relative rounded-2xl overflow-hidden bg-stone-900 aspect-[4/3]">
            <video
              ref={attachVideoRef}
              onPlaying={() => {
                frameReadyRef.current = true;
                realFrameReceivedRef.current = true;
                setFrameReady(true);
                if (phaseRef.current === 'cameraPermission') {
                  resetLiveAttempt();
                  setLastError('');
                  setCameraIssue(null);
                  setPhase('capture');
                }
              }}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full h-full object-cover block ${facingMode === 'user' ? '-scale-x-100' : ''}`}
            />
            {/* Flip / Switch Camera button — allows user to cycle cameras or switch front/rear */}
            {(phase === 'capture' || phase === 'cameraPermission') && (
              <button
                type="button"
                onClick={() => void flipCamera()}
                title="Flip / Switch Camera (front / back / external)"
                className="absolute top-3 left-3 z-30 flex items-center gap-1.5 bg-black/60 hover:bg-black/85 text-white text-[11px] font-semibold px-3 py-1.5 rounded-full shadow-lg backdrop-blur-md transition-all active:scale-95 cursor-pointer border border-white/20"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Flip Camera</span>
              </button>
            )}
            {cameraFrameReady && (
              <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-emerald-500/90 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full shadow-md">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Camera live
              </div>
            )}
            {/* Show starting overlay ONLY when a stream is genuinely not yet opened or not attached */}
            {(phase === 'capture' || phase === 'cameraPermission') &&
              cameraState === 'opening' &&
              !streamRef.current &&
              !cameraIssue && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-white z-20">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-xs">Starting camera…</span>
                  {import.meta.env.DEV && cameraMissing.length > 0 && (
                    <span className="text-[10px] opacity-70 font-mono">waiting for: {cameraMissing.join(', ')}</span>
                  )}
                </div>
              )}
            {cameraState === 'closed' && phase === 'cameraPermission' && !cameraIssue && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                <CameraOff className="w-8 h-8 opacity-70" />
                <p className="text-xs opacity-80">Camera is off — enable it to begin the face check</p>
              </div>
            )}
            {/* Honest "camera is off" state after a cancel — the camera really is
                released, and the document behind it is untouched. */}
            {phase === 'cameraCancelled' && cameraState === 'closed' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
                <CameraOff className="w-8 h-8 opacity-70" />
                <p className="text-xs opacity-80">Camera is off</p>
              </div>
            )}
            {/*
              THE BLINK PROMPT.

              This is the only instruction in the flow beyond positioning, and it
              is shown ONLY in the two states where a blink is actually the
              correct next action. It is a pure function of the derived state, so
              it cannot appear while the chip below is asking the user to move,
              and it cannot linger after the blink is measured.

              There is no countdown and no timer anywhere near it. A "blink in 3…"
              pill would assert that time alone advances liveness, and it does
              not: the blink must be MEASURED, and the gate is listening the
              whole time.
            */}
            {(liveState === 'BLINK_INSTRUCTION' || liveState === 'BLINK_DETECTED' || liveState === 'READY_TO_SUBMIT') && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                <div
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold shadow-md ${
                    liveState === 'BLINK_DETECTED' || liveState === 'READY_TO_SUBMIT'
                      ? 'bg-emerald-500/95 text-white'
                      : 'bg-amber-400/95 text-stone-900 animate-pulse'
                  }`}
                >
                  {liveState === 'BLINK_DETECTED' || liveState === 'READY_TO_SUBMIT' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" /> Blink detected ✓ Ready to submit
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-stone-900" /> Blink your eyes to verify
                    </>
                  )}
                </div>
              </div>
            )}
            {analyzing && (
              <div className="absolute inset-0 flex items-center justify-center px-6 pointer-events-none">
                <div className="bg-black/70 backdrop-blur-sm rounded-2xl px-5 py-4 flex flex-col items-center gap-2 text-center shadow-xl">
                  <Loader2 className="w-7 h-7 animate-spin text-cream-100" />
                  <p className="text-xs text-cream-100 leading-relaxed max-w-sm">{INFERENCE_NOTE}</p>
                </div>
              </div>
            )}

            {/* The face guide. Sized from the SAME constants the guide maths uses
                (FACE_GUIDE_HEIGHT_FRACTION / FACE_GUIDE_ASPECT), so the shape
                the user sees and the shape the detector is compared against can
                never drift apart.

                Geometry, honestly: a 4:3 preview is 0.75 as wide as it is tall,
                so a guide that is 60% of the WIDTH is necessarily about 80% of
                the HEIGHT — the two requirements are the same requirement. A
                strictly portrait oval cannot satisfy both, so this is a
                heavily-rounded rectangle at 1.03:1, which lands at ~59% width ×
                76% height in a 4:3 preview. It is deliberately MODERATE: small
                enough to read as a target, large enough that a real face at a
                normal webcam distance falls inside it. */}
            {cameraActive && phase === 'capture' && !analyzing && (
              <>
                {/* Aadhaar-style Oval Guide:
                    Hardware-accelerated SVG cutout with zero 9999px box-shadow overhead.
                    Inside the oval is 100% transparent direct view of the camera feed.
                    Outside is darkened with a crisp semi-transparent backdrop. */}
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none z-10"
                  viewBox="0 0 400 300"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <mask id="face-oval-cutout">
                      <rect x="0" y="0" width="400" height="300" fill="white" />
                      <ellipse cx="200" cy="150" rx="120" ry="114" fill="black" />
                    </mask>
                  </defs>
                  <rect
                    x="0"
                    y="0"
                    width="400"
                    height="300"
                    fill="rgba(15, 10, 12, 0.65)"
                    mask="url(#face-oval-cutout)"
                  />
                  <ellipse
                    cx="200"
                    cy="150"
                    rx="120"
                    ry="114"
                    fill="none"
                    stroke={faceGuideGood ? '#34d399' : '#f43f5e'}
                    strokeWidth="3.5"
                    className="transition-colors duration-200"
                  />
                </svg>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold shadow-md whitespace-nowrap ${
                      faceGuideGood ? 'bg-emerald-500/90 text-white' : 'bg-rosered-600/90 text-white'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${faceGuideGood ? 'bg-white' : 'bg-white/70'} animate-pulse`}
                    />
                    {faceChipText}
                  </div>
                </div>
              </>
            )}

            {/*
              THE ONE honest failure state.

              There is exactly one on-device model, so there is exactly one failure
              to report. It used to be two overlays — one for the bounding-box
              detector, one for the eye-landmark model — that could both appear,
              both covered the camera, and both described a "detector problem"
              that was really a second-runtime problem.

              The copy is deliberately free of model names, file paths and stack
              traces (§20): the seller gets a plain sentence and two buttons, and
              the technical reason goes to the console. Nothing has been
              submitted, and the camera is left open so a retry does not need
              camera permission again.
            */}
            {landmarkerError && phase === 'capture' && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
                <AlertTriangle className="w-8 h-8 text-amber-400" />
                <p className="text-xs text-white leading-relaxed max-w-sm">
                  We couldn&apos;t start live face verification. Please retry. Nothing has been
                  submitted, and this is not a problem with your camera or your ID.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      // Clears every model-error ref and the UI state together,
                      // releases the failed instance, and rejoins the loader. A
                      // failed load is never cached and the singleton joins an
                      // in-flight load rather than starting a second one, so this
                      // is a genuine retry that cannot open a second camera or a
                      // second WebGL context.
                      retryDetector();
                    }}
                  >
                    <RefreshCw className="w-4 h-4" /> Retry verification
                  </Button>
                  <Button variant="outline" size="sm" onClick={cancelCameraVerification}>
                    Cancel camera check
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/*
            THE INSTRUCTION — ONE source, the SAME string the chip shows.

            There is no pose title and no second ternary chain. The block reads
            the derived message verbatim, so the large text and the chip on the
            video cannot say different things. A `disabled` Submit sits directly
            below, gated on the same `isSubmitEnabled(liveState)` the state
            machine defines, so "before blink: disabled / after blink: enabled"
            is a property of the derivation rather than of this markup.
          */}
          {phase === 'capture' && !liveCheckFinished && (
            <div className="p-4 rounded-2xl bg-burgundy text-white text-center space-y-3">
              <p className="text-sm font-bold">{liveMessage}</p>
              <p className="text-[11px] opacity-80">
                {liveState === 'BLINK_INSTRUCTION'
                  ? 'Blink once, then press Submit. Nothing is sent until you do.'
                  : liveState === 'BLINK_DETECTED'
                    ? 'That blink was measured. Press Submit to send it for review.'
                    : liveState === 'READY_TO_SUBMIT'
                      ? 'Press Submit to send your live check for review.'
                      : 'We need one clear view of your face, then one blink. Nothing is recorded until you press Submit.'}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="lg"
                  className="flex-1"
                  disabled={!submitEnabled || analyzing}
                  onClick={() => void submitLiveCheck()}
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" /> Sending to the server…
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" /> Submit live check
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  type="button"
                  onClick={() => void flipCamera()}
                  title="Flip camera (front / back / external)"
                  className="bg-white/10 hover:bg-white/20 text-white border-white/30 text-xs px-3.5 flex items-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4" /> Flip
                </Button>
              </div>
              {blinkDetected && (
                <p className="text-[10px] opacity-70 leading-relaxed">
                  Your camera is released as soon as the server accepts the frames, and a human
                  reviewer makes the final decision — no automatic score approves or rejects anyone
                  here. Review is expected within 24 hours.
                </p>
              )}
            </div>
          )}

          {/* camera cancelled — STEP 2 is still active, the document is still
              accepted, and nothing is re-requested from the user. */}
          {phase === 'cameraCancelled' && (
            <div className="p-4 rounded-2xl bg-cream-50 border border-stone-200 space-y-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                <p className="text-xs text-stone-700 leading-relaxed">
                  Camera check cancelled. Your ID document is still uploaded and accepted ✓ — you do
                  not need to upload it again, and the live check starts fresh when you retry.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button variant="primary" size="md" onClick={retryCameraVerification}>
                  <Camera className="w-4 h-4" /> Retry Verification
                </Button>
                <Button variant="outline" size="md" onClick={() => void restartCapture()}>
                  Start Over
                </Button>
                {/* Offered only while the backend still accepts a new document. */}
                {NEW_DOCUMENT_STATES.has(serverVerificationState) ? (
                  <Button variant="ghost" size="md" onClick={changeDocument}>
                    Change Document
                  </Button>
                ) : null}
              </div>
              {/* Honest reason instead of a silent missing button: once the
                  document is accepted the server refuses a replacement (409),
                  so a new document is only possible through a support/admin
                  re-verification request. */}
              {!NEW_DOCUMENT_STATES.has(serverVerificationState) && (
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Your document is already accepted, so it can no longer be replaced from here. If it
                  is wrong, contact support and they can request a fresh verification cycle.
                </p>
              )}
            </div>
          )}

          {/* capture-failed retry */}
          {phase === 'captureFailed' && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
              <p className="text-xs text-amber-900 font-semibold">
                {lastError || 'That capture was not accepted.'}
              </p>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                Tips: face the camera with even lighting, remove anything covering your face, hold
                your head inside the outline, and blink once when asked.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="primary"
                  size="md"
                  disabled={!cameraActive}
                  onClick={() => {
                    // A rejected burst ends the ATTEMPT: the blink the server
                    // turned down, and the frames around it, are no longer
                    // evidence. The camera itself stays open — this is a frame
                    // quality result, not a camera failure — so the user simply
                    // blinks again.
                    resetLiveAttempt();
                    clearBlinkWindow(ctxRef.current?.sessionId ?? null);
                    setLastError('');
                    setPhase('capture');
                  }}
                >
                  <RefreshCw className="w-4 h-4" /> Try Again
                </Button>
                <Button variant="outline" size="md" onClick={() => void restartCapture()}>
                  Start Over
                </Button>
              </div>
            </div>
          )}

          {/* camera permission call-to-action */}
          {phase === 'cameraPermission' && (
            <div className="space-y-3">
              {cameraActive ? (
                <>
                  {cameraIssue && (
                    <div className="flex items-start gap-2 text-[11px] text-rosered bg-rosered/5 border border-rosered/20 rounded-xl p-3">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rosered" />
                      <span>{cameraIssue}</span>
                    </div>
                  )}
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full"
                    onClick={() => void retryFrameObservation()}
                  >
                    <RefreshCw className="w-5 h-5" /> Retry Live Preview
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full" onClick={cancelCameraVerification}>
                    Cancel camera check
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-[11px] text-stone-600 bg-cream-50 border border-stone-200 rounded-xl p-3">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                    <span>
                      Your ID document was already uploaded and accepted ✓ — this camera is not another ID
                      upload. It runs one <b>live face check</b> (a clear look and one blink) so a reviewer
                      can confirm the document belongs to you. Frames are held in memory only while you are
                      on this screen and are released the moment you submit, cancel or close the page.
                    </span>
                  </div>
                  <Button variant="primary" size="lg" className="w-full" onClick={() => void enableCamera()}>
                    <Camera className="w-5 h-5" /> Enable Camera & Begin
                  </Button>
                  <p className="text-[11px] text-stone-500 text-center">
                    Your camera feed is processed in real time and never leaves your device except as
                    compressed frames sent to the verification endpoint.
                  </p>
                </>
              )}
            </div>
          )}

          {(phase === 'capture' || phase === 'captureFailed') && (
            <Button variant="ghost" size="sm" className="w-full" onClick={cancelCameraVerification}>
              Cancel camera check
            </Button>
          )}

          {/* dev-only live telemetry — placed at bottom of card so UI controls stay visible on mobile */}
          {cameraTelemetry && (
            <DebugPanel
              title="face camera"
              lines={[
                ['stream', cameraTelemetry.streamActive ? 'ON' : 'OFF'],
                ['session', cameraTelemetry.cameraActive ? 'ACTIVE' : 'inactive'],
                [
                  'track',
                  `${cameraTelemetry.trackLive ? 'LIVE' : 'ENDED'}${cameraTelemetry.streamId !== 'none' ? ` · ${cameraTelemetry.streamId}` : ''} · ${cameraTelemetry.trackStates}`,
                ],
                ['frame ready', cameraTelemetry.frameReady ? 'YES' : 'no'],
                ['camera state', cameraTelemetry.cameraState.toUpperCase()],
                ['verify state', cameraTelemetry.verifyState],
                ['message', cameraTelemetry.verifyMessage],
                ['face detected', cameraTelemetry.faceCount === 1 ? 'YES' : 'NO'],
                ['faces', String(cameraTelemetry.faceCount)],
                ['position', cameraTelemetry.facePositionValid ? 'IN GUIDE' : 'not yet'],
                ['held', cameraTelemetry.faceHeld ? 'YES' : 'no'],
                [
                  'eye openness',
                  cameraTelemetry.eyeOpenness === null
                    ? cameraTelemetry.earBaseline
                      ? 'not measured'
                      : 'baseline not established'
                    : cameraTelemetry.eyeOpenness.toFixed(2),
                ],
                [
                  'blink',
                  cameraTelemetry.blinkMeasured
                    ? `MEASURED at ${cameraTelemetry.blinkAt?.toFixed(0) ?? '—'}ms · ${cameraTelemetry.bufferedFrames} frames buffered`
                    : 'not measured',
                ],
                ['submit', cameraTelemetry.submitEnabled ? 'ENABLED' : 'disabled'],
                ['contradiction', cameraTelemetry.verifyContradiction ?? 'none'],
                ['missing', cameraTelemetry.cameraMissing],
                [
                  'detection loop',
                  cameraTelemetry.detectionLoops === 1 ? 'ACTIVE' : 'IDLE',
                ],
                ['detection frame', cameraTelemetry.detectionRunning ? 'RUNNING' : 'between frames'],
                ['liveness action', `${cameraTelemetry.livenessStep} (the only one)`],
                ['verification', cameraTelemetry.verificationState],
                ['video', `rs ${cameraTelemetry.readyState} · ${cameraTelemetry.videoWidth}×${cameraTelemetry.videoHeight}`],
                ['getUserMedia calls', String(cameraTelemetry.gumCalls)],
                ['active streams', String(cameraTelemetry.activeStreams)],
                ['detect loops', String(cameraTelemetry.detectionLoops)],
                ['renders', String(cameraTelemetry.renders)],
                ['attempt/succ/fail', `${cameraTelemetry.cameraStartAttempts}/${cameraTelemetry.cameraSuccessCount}/${cameraTelemetry.cameraFailureCount}`],
                ['stops', String(cameraTelemetry.cameraStopCount)],
                ['stream cr/dst', `${cameraTelemetry.streamCreatedCount}/${cameraTelemetry.streamDestroyedCount}`],
                ['attach/play/meta', `${cameraTelemetry.videoAttachCount}/${cameraTelemetry.videoPlayCount}/${cameraTelemetry.videoMetadataCount}`],
                ['video playing', cameraTelemetry.videoPlaying ? 'YES' : 'NO'],
                ['currentTime', `${cameraTelemetry.videoCurrentTime.toFixed(2)}s`],
                ['real frame', cameraTelemetry.realFrame ? 'YES' : 'NO'],
                ['rVFC', cameraTelemetry.rvfcFired ? 'FIRED' : 'waiting'],
                ['last stop', cameraTelemetry.lastStopReason],
                ['ctx', `${cameraTelemetry.secureContext} · md ${cameraTelemetry.mediaDevicesAvailable ? 'Y' : 'N'} · gum ${cameraTelemetry.gumAvailable ? 'Y' : 'N'}`],
                [
                  'last error',
                  cameraTelemetry.lastError
                    ? `${cameraTelemetry.lastError.name}${cameraTelemetry.lastError.constraint ? ` (${cameraTelemetry.lastError.constraint})` : ''}: ${cameraTelemetry.lastError.message}`
                    : '—',
                ],
                ['init in-flight', cameraTelemetry.cameraStarting ? 'YES' : 'no'],
                [
                  'face model',
                  `${cameraTelemetry.detector}${cameraTelemetry.detectorError ? ` — ${cameraTelemetry.detectorError}` : ''}`,
                ],
                ['detector faces', String(cameraTelemetry.faces)],
                ['face threshold', cameraTelemetry.faceThreshold.toFixed(3)],
                ['frame error', cameraTelemetry.frameError ?? 'none'],
                ['inside guide', cameraTelemetry.inGuide ? 'YES' : 'NO'],
                ['face size', `${cameraTelemetry.areaPct.toFixed(1)}%`],
                ['face w/h', `${(cameraTelemetry.faceWidthRatio * 100).toFixed(0)}% / ${(cameraTelemetry.faceHeightRatio * 100).toFixed(0)}%`],
                ['preview box', cameraTelemetry.previewSize],
                ['guide oval', cameraTelemetry.guideSize],
                ['stable', `${cameraTelemetry.stableSec.toFixed(1)}s / ${PLACEMENT_HOLD_SECONDS.toFixed(1)}s`],
                ['hold gate', cameraTelemetry.captureReady ? 'PASSED' : 'accumulating'],
              ]}
            />
          )}
        </Card>
        <canvas ref={canvasRef} className="hidden" />
      </Shell>
    );
  }

  /**
   * THE GATE FELL THROUGH — the wizard asked for a camera screen while the
   * derived state says the live check is already over.
   *
   * This is a defensive arm, not a normal path: `init` routes every terminal
   * state to its own screen, so reaching here means the wizard phase and the
   * server-recorded state disagreed for one render. It is handled by asking
   * the SERVER which it is — never by picking a screen from the local
   * derivation, because the local derivation is exactly what is in doubt. And
   * never by opening a camera.
   */
  if (
    !cameraMayRun &&
    !analyzing &&
    (phase === 'cameraPermission' ||
      phase === 'capture' ||
      phase === 'captureFailed' ||
      phase === 'cameraCancelled')
  ) {
    if (import.meta.env.DEV) {
      console.warn('[VerifyFlow] camera shell suppressed — the check is already over', {
        phase,
        derivedState: liveState,
        reviewStatus,
      });
    }
    return (
      <Shell>
        <Header
          title="Checking your verification status"
          sub="Your live check is already recorded, so the camera stays closed."
        />
        <Card className="space-y-5 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-burgundy mx-auto" />
          <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
            Reading the current status from the server.
          </p>
          <Button variant="primary" size="md" onClick={() => void init()}>
            <RefreshCw className="w-4 h-4" /> Refresh my status
          </Button>
        </Card>
      </Shell>
    );
  }

  // ── 12 finishing ───────────────────────────────────────────────────────────
  // Reached ONLY on reload when the server already holds an accepted burst but
  // the hand-off to review never happened (the page died mid-submit). The
  // camera is NOT opened, no blink is asked for, and nothing is uploaded again
  // — the frames are already on the server.
  if (phase === 'finishing') {
    return (
      <Shell>
        <Header
          title="Finish your submission"
          sub="Your live check reached the server, but the last step was interrupted. Nothing needs to be recorded again."
        />
        <Card className="space-y-5 text-center">
          <Upload className="w-12 h-12 text-burgundy mx-auto" />
          <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
            Press the button below and the server will hand your case to our review team. You do not
            need to use the camera again.
          </p>
          {lastError && (
            <p className="text-xs text-rosered font-semibold">{lastError}</p>
          )}
          <Button
            variant="primary"
            size="lg"
            className="min-w-[220px]"
            disabled={analyzing}
            onClick={() => void finishSubmission()}
          >
            {analyzing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" /> Submit for review
              </>
            )}
          </Button>
          <p className="text-[11px] text-stone-500">Review is expected within 24 hours.</p>
        </Card>
      </Shell>
    );
  }

  // ── 13 approved ────────────────────────────────────────────────────────────
  // Reached ONLY from a server response. This screen grants nothing: the seller
  // area's own routes are gated by `requireApprovedSeller`, so if the account
  // is somehow not approved they will say so honestly rather than this page
  // having promised access it cannot deliver.
  if (phase === 'approved') {
    return (
      <Shell>
        <Header
          title="Verification approved"
          sub="Our review team approved your identity verification."
        />
        <Card className="space-y-5 text-center">
          <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
          <p className="text-sm text-stone-600 max-w-md mx-auto leading-relaxed">
            A reviewer approved your identity verification. You can continue with your seller
            application.
          </p>
          <Link to="/become-seller">
            <Button variant="primary" size="lg" className="min-w-[220px]">
              Continue to Seller Application
            </Button>
          </Link>
        </Card>
      </Shell>
    );
  }

  // ── 14/15 under review / rejected ──────────────────────────────────────────
  if (phase === 'manualReview' || phase === 'rejected') {
    const rejected = phase === 'rejected';
    return (
      <Shell>
        <Header
          title={rejected ? 'Verification not approved' : 'Verification submitted'}
          sub={
            rejected
              ? 'Our review team did not approve this verification.'
              : 'Your verification request has been submitted to the admin team.'
          }
        />
        <Card className="space-y-6 text-center py-4">
          {rejected ? (
            <AlertTriangle className="w-14 h-14 text-rosered mx-auto" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200 shadow-sm">
              <CheckCircle2 className="w-9 h-9" />
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-base font-bold text-stone-900">
              {rejected ? 'Application Not Approved' : 'Application Under Admin Review'}
            </h3>
            <p className="text-sm text-stone-600 max-w-md mx-auto leading-relaxed">
              {rejected
                ? lastError ||
                  'Your verification was not approved. Please contact support to discuss it or to request a fresh attempt.'
                : 'Within 1 or 2 days your verification will be approved or rejected by the admin team. Once approved, your seller dashboard will automatically unlock and open with full access to sell, manage inventory, and add products.'}
            </p>
          </div>
          {serverSubmittedAt && !rejected && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-cream-100 rounded-full text-[11px] text-stone-600">
              <Clock className="w-3.5 h-3.5 text-stone-500" />
              <span>Submitted {new Date(serverSubmittedAt).toLocaleDateString()} · Review in progress</span>
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link to="/become-seller">
              <Button variant="outline">Review Store Details</Button>
            </Link>
            <Link to="/support">
              <Button variant="outline">Contact Support</Button>
            </Link>
            <Link to="/home">
              <Button variant="primary">Return to Marketplace</Button>
            </Link>
          </div>
        </Card>
      </Shell>
    );
  }

  // ── 16 reverification ──────────────────────────────────────────────────────
  if (phase === 'reverification') {
    return (
      <Shell>
        <Header
          title="Re-verification requested"
          sub="A reviewer asked you to verify your identity again with fresh details."
        />
        <Card className="space-y-5 text-center">
          <RefreshCw className="w-12 h-12 text-burgundy mx-auto" />
          <p className="text-sm text-stone-600 max-w-md mx-auto leading-relaxed">
            A new verification cycle will be opened for you. Your previous attempt stays on record;
            only the new cycle counts.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="min-w-[220px]"
            isLoading={isBusy}
            onClick={() => void restartCapture()}
          >
            Start New Verification
          </Button>
        </Card>
      </Shell>
    );
  }

  // ── 17 expired ─────────────────────────────────────────────────────────────
  if (phase === 'expired') {
    return (
      <Shell>
        <Header
          title="Session expired"
          sub="Your verification session was short-lived and has run out of time."
        />
        <Card className="space-y-5 text-center">
          <Clock className="w-12 h-12 text-amber-500 mx-auto" />
          <p className="text-sm text-stone-600 max-w-md mx-auto leading-relaxed">
            For your security, verification sessions expire automatically. Nothing was submitted or
            stored — you can simply start a fresh session and continue.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="min-w-[220px]"
            isLoading={isBusy}
            onClick={() => void restartCapture()}
          >
            Start a Fresh Session
          </Button>
        </Card>
      </Shell>
    );
  }

  // ── 18 error ───────────────────────────────────────────────────────────────
  return (
    <Shell>
      <Header title="Something went wrong" sub="We hit a problem and could not continue." />
      <Card className="space-y-5 text-center">
        <AlertTriangle className="w-12 h-12 text-rosered mx-auto" />
        <p className="text-sm text-stone-600 max-w-md mx-auto leading-relaxed">{lastError}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="primary" onClick={() => void init()}>
            Retry
          </Button>
          {ctx?.sessionId ? (
            <Button variant="outline" onClick={() => void restartCapture()}>
              Restart Session
            </Button>
          ) : (
            <Link to="/become-seller">
              <Button variant="outline">Back</Button>
            </Link>
          )}
        </div>
      </Card>
    </Shell>
  );
};
