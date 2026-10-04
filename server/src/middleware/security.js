/**
 * Security middleware stack: CORS allowlist, Origin/Referer CSRF check,
 * and rate limiting (in-memory store; swap to Redis for multi-instance).
 *
 * AGENTS.md §5: 15 brute-force protection, 16 rate limiting, 79 CORS
 * misconfiguration, 88 error toast (we return structured 429 JSON instead of
 * a plain html block).
 */
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { httpError } from '../lib/errors.js';

/** CORS: only the configured frontend origins may call with credentials. */
export function corsMiddleware(env) {
  return cors({
    origin(origin, cb) {
      // No Origin header (curl, same-origin proxy node) → allowed.
      if (!origin || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });
}

function originAllowed(env, origin) {
  if (!origin) return false;
  return env.CORS_ORIGINS.includes(origin.replace(/\/+$/, ''));
}

/**
 * CSRF defence #2 (defence #1 is SameSite=Lax on the session cookie).
 * State-changing requests from a BROWSER must carry an Origin (or Referer)
 * header that matches a configured origin. Requests with no Origin and no
 * Referer (API clients / curl / our tests) are allowed — a browser can never
 * send a cross-origin form POST without one of them.
 */
export function originCheck(env) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (origin) {
      if (!originAllowed(env, origin)) {
        return next(httpError(403, 'Request origin not allowed.'));
      }
      return next();
    }
    if (referer) {
      let refBase;
      try {
        refBase = new URL(referer).origin;
      } catch {
        return next(httpError(403, 'Request origin not allowed.'));
      }
      if (!originAllowed(env, refBase)) {
        return next(httpError(403, 'Request origin not allowed.'));
      }
    }
    return next();
  };
}

const json429 = (message) => (_req, res) => {
  res.status(429).json({ error: { message } });
};

/** Global safety net: 600 requests / 15 min per IP. */
export function globalLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    handler: json429('Too many requests. Please try again later.'),
  });
}

/** Key = IP + attempted email — per-account throttling, not just per-IP. */
function accountKey(req) {
  const ip = req.ip || 'unknown';
  const email = req.body && typeof req.body.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : '';
  return `${ip}|${email}`;
}

/** OTP send: 3 per 10 minutes (per account+IP). §5-4/5-5. */
export function otpSendLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many verification-code requests. Please wait a few minutes.'),
  });
}

/** OTP verify: 6 attempts per 10 minutes. §5-2/5-3/5-15. */
export function otpVerifyLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 6,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many incorrect codes. Please try again later.'),
  });
}

/** Admin login: 8 attempts per 15 minutes. §5-15/5-16. */
export function adminLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many sign-in attempts. Please try again later.'),
  });
}

/** PIN setup: 5 per 10 minutes (per account+IP). §5-15/5-16. */
export function pinSetupLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many PIN requests. Please try again later.'),
  });
}

/** PIN verify: 5 per 10 minutes — layered over the DB attempt lockout. */
export function pinVerifyLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many incorrect PIN attempts. Please try again later.'),
  });
}

/** PIN change: 5 per 10 minutes. */
export function pinChangeLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many PIN change attempts. Please try again later.'),
  });
}

/** Forgot-PIN request: 3 per 15 minutes (anti-enumeration also demands
 *  identical responses — the limit is keyed by email+IP, §5-16/§6). */
export function pinForgotLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many reset requests. Please try again later.'),
  });
}

/** PIN reset: 5 per 15 minutes (brute-forces the 6-digit emailed code). */
export function pinResetLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many reset attempts. Please try again later.'),
  });
}

/** Seller applications: 3 per 10 minutes (per account+IP). Duplicate rows
 *  are also rejected at the DB/service layer (§5-33). */
export function sellerApplyLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many requests. Please try again later.'),
  });
}

/** KYC face-verification steps: 30 per 15 minutes (per account+IP) — layered
 *  over the per-attempt DB cap and the short-lived session TTL (§5-4/5-5/§8). */
export function faceVerificationLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many verification attempts. Please try again later.'),
  });
}

/** Admin verification review actions: 60 per 15 minutes per account+IP. */
export function adminVerificationLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: accountKey,
    handler: json429('Too many requests. Please try again later.'),
  });
}