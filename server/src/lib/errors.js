/**
 * HTTP error + response helpers for the Express backend.
 *
 * Error response shape (contract): { error: { message } }.
 * Success responses always carry a JSON body — the frontend apiRequest()
 * throws when it receives HTTP 204, so mutations must never return empty.
 * Generic 502 is used for UPSTREAM auth-service failures; details are logged
 * server-side only (AGENTS.md §5-80: never expose internals to the client).
 */
export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const httpError = (status, message, code = null) => new HttpError(status, message, code);

/**
 * Upstream (Supabase/PostgREST/network) failure diagnosis.
 *
 * WHY: `TypeError: fetch failed` is what Node's fetch reports for EVERY
 * transport failure — DNS, TCP, TLS, reset socket, timeout. The actionable
 * detail (the OS error code) lives in `err.cause`, so logging only
 * `err.message` produced six identical, useless lines and no way to tell a
 * paused project from a DNS problem from a dead keep-alive socket.
 *
 * These helpers make the real cause visible in the SERVER LOG while the client
 * still receives a generic 502 (AGENTS.md §5-80: never expose internals).
 */

/** OS/undici codes that mean "the request never reached the server". */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** Walks the `cause` chain and returns every distinct OS code found. */
function causeCodes(err, out = []) {
  let cur = err;
  let depth = 0;
  while (cur && depth < 6) {
    if (cur.code && !out.includes(cur.code)) out.push(cur.code);
    cur = cur.cause;
    depth += 1;
  }
  return out;
}

/**
 * Strips anything token-shaped so a key can never reach the log, even if a
 * driver ever embeds one in a message. A Supabase service-role key is a JWT
 * (three base64url segments), so the three-segment shape is what we match —
 * a prefix-only pattern would leave the rest of the key readable.
 */
function redact(value, max = 240) {
  return String(value ?? '')
    .replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-token]')
    .replace(/eyJ[A-Za-z0-9_.-]{20,}/g, '[redacted-token]')
    .slice(0, max);
}

/**
 * A compact, secret-free description of an upstream failure: the error class,
 * the OS codes, and the deepest message in the `cause` chain.
 */
export function describeUpstreamError(err) {
  if (!err) return 'unknown error';
  const codes = causeCodes(err);
  let deepest = err;
  let cur = err;
  let depth = 0;
  while (cur.cause && depth < 6) {
    cur = cur.cause;
    deepest = cur;
    depth += 1;
  }
  const top = redact(err.message, 120);
  const low = redact(deepest?.message, 240);
  return [
    `${err.name || 'Error'}${codes.length ? ` [${codes.join(',')}]` : ''}`,
    low,
    low && low !== top ? `from: ${top}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

/**
 * True ONLY for a transport failure — the request never got a response, so
 * repeating it is safe and meaningful.
 *
 * Deliberately NOT transient (retrying cannot fix them, and a retry would only
 * delay the honest error): a PostgREST/SQL error such as a missing relation or
 * an RLS violation, any HttpError from our own layer, and TLS trust failures
 * such as an expired or untrusted certificate.
 */
export function isTransientUpstreamError(err) {
  if (!err) return false;
  // An HttpError from our own layer is a decision, not a transport failure.
  if (err instanceof HttpError) return false;
  const codes = causeCodes(err);
  if (codes.length) return codes.some((c) => TRANSIENT_CODES.has(c));
  // No code anywhere: fall back to the message shapes Node/undici use.
  return /fetch failed|socket hang up|terminated|ECONNRESET|ETIMEDOUT/i.test(String(err.message ?? ''));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bounded retry for READ-ONLY upstream queries, and ONLY for transport
 * failures. Never use it on a write: a POST that "failed" may still have been
 * applied, and repeating it is how duplicate orders get created
 * (AGENTS.md §5-54, §5-73).
 *
 * Logging contract: this helper reports only its OWN decisions — one line per
 * retry and one line when it gives up. A non-transient error is NOT logged
 * again here, because the caller already logged it with full context; that
 * avoids the same failure appearing twice in the log.
 *
 * The LAST error is rethrown unchanged, so the caller's own handling and the
 * client's generic 502 are unaffected. This is not a fallback: the same real
 * query is re-issued and a real failure still fails — no mock or invented data
 * is ever substituted (AGENTS.md §5-6).
 */
export async function withReadRetry(fn, { label, attempts = 2, delayMs = 250 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientUpstreamError(err)) throw err; // caller already logged it
      if (attempt === attempts) {
        // eslint-disable-next-line no-console
        console.error(
          `[${label}] upstream unreachable after ${attempts} attempts:`,
          describeUpstreamError(err),
        );
        throw err;
      }
      // eslint-disable-next-line no-console
      console.error(
        `[${label}] upstream attempt ${attempt}/${attempts} failed (transport — retrying):`,
        describeUpstreamError(err),
      );
      await sleep(delayMs * attempt);
    }
  }
  throw lastErr;
}

/** 200 OK with a JSON body (never 204 — see above). */
export const ok = (res, data) => res.status(200).json(data);

import { recordIncident } from './alerting.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: 'Not found.' } });
}

export function createErrorHandler({ env } = {}) {
  return function errorHandler(err, req, res, _next) {
    // Client JSON parse failures from express.json()
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { message: 'Invalid JSON in request body.' } });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: { message: 'Request body too large.' } });
    }
    if (err instanceof HttpError) {
      if (err.status >= 500) {
        recordIncident({ env, req, err, level: 'error' });
      }
      return res.status(err.status).json({ error: { message: err.message } });
    }
    // Cross-origin requests from a non-allowlisted origin (browser CSRF) get a
    // clean 403 — never a 500.
    if (err && err.message === 'Not allowed by CORS') {
      return res.status(403).json({ error: { message: 'Request origin not allowed.' } });
    }
    // Unknown server error — never leak internals (§5-80).
    // The full detail goes to the server log for operators.
    // eslint-disable-next-line no-console
    console.error('[errorHandler]', err && err.stack ? err.stack : err);
    // Sentry-style trace recording + Urgent Admin Email Alert
    recordIncident({ env, req, err, level: 'fatal' });
    return res.status(500).json({ error: { message: 'Internal server error.' } });
  };
}

export const errorHandler = createErrorHandler();