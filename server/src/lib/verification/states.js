/**
 * State-machine guard for seller verification (spec §13).
 *
 * The DATABASE trigger (0006) is the authoritative enforcement; this map is
 * the application-layer fast-path that turns an illegal transition into a
 * clean 409 before any DB call. Both share VERIFICATION_TRANSITIONS.
 */
import { httpError } from '../errors.js';
import { VERIFICATION_TRANSITIONS } from './constants.js';

/**
 * Asserts that `from → to` is a legal verification-state transition.
 * @throws {HttpError 409} when the transition is illegal.
 */
export function assertTransition(from, to) {
  const allowed = VERIFICATION_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw httpError(409, 'This verification step is not allowed right now.');
  }
}

/** True when `from → to` is legal (used for defensive branching). */
export function canTransition(from, to) {
  return (VERIFICATION_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Shortest legal path (BFS) from `from` to `to`, including both endpoints.
 * Returns null when no legal path exists. Routes use this to walk multi-hop
 * transitions (e.g. FACE_CAPTURE_REQUIRED → LIVENESS_CHECK) with sequential
 * single-step UPDATEs so the DB transition trigger never sees a jump. The
 * self-loops in VERIFICATION_TRANSITIONS (FACE_CAPTURE_REQUIRED,
 * LIVENESS_CHECK) are ignored here — they express "stay put while more data
 * arrives" and are never a *forward* step in a path.
 */
export function transitionPath(from, to) {
  if (from === to) return [to];
  const queue = [[from]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const path = queue.shift();
    const last = path[path.length - 1];
    for (const next of VERIFICATION_TRANSITIONS[last] ?? []) {
      if (next === last || seen.has(next)) continue;
      if (next === to) return [...path, next];
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}