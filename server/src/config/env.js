/**
 * Environment loading + validation (FAIL-FAST).
 *
 * AGENTS.md §2.9 / BACKEND_SPEC §2: if a REQUIRED variable is missing the
 * server MUST fail clearly at startup — never silently fall back to mocks,
 * never invent values, never read secrets from code.
 *
 * Only variable NAMES are referenced here. Real values live exclusively in
 * .env (git-ignored) / Railway dashboard — never in source.
 */
const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_SECRET',
  'CORS_ORIGINS',
  'APP_URL',
  'BACKEND_URL',
  'ADMIN_BOOTSTRAP_EMAIL',
];

const isNonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

function fail(missing) {
  throw new Error(
    `Configuration error — missing required environment variable(s): ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill in real values (Supabase project keys, SESSION_SECRET, ' +
      'ADMIN_BOOTSTRAP_EMAIL). The server will not start without them.',
  );
}

/**
 * @param {NodeJS.ProcessEnv} vars process.env (injectable for tests)
 * @returns {Readonly<object>} validated, frozen environment config
 */
export function loadEnv(vars = process.env) {
  const missing = REQUIRED.filter((k) => !isNonEmpty(vars[k]));
  if (missing.length > 0) fail(missing);

  const url = new URL(String(vars.SUPABASE_URL));
  if (url.protocol !== 'https:') {
    throw new Error('Configuration error — SUPABASE_URL must be an https:// URL.');
  }

  const secret = String(vars.SESSION_SECRET).trim();
  if (secret.length < 32) {
    throw new Error(
      'Configuration error — SESSION_SECRET must be at least 32 characters (generate a long random string).',
    );
  }

  const rawOrigins = String(vars.CORS_ORIGINS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (rawOrigins.length === 0) {
    throw new Error('Configuration error — CORS_ORIGINS must list at least one origin (comma-separated).');
  }
  for (const origin of rawOrigins) {
    if (!/^https?:\/\//.test(origin)) {
      throw new Error(`Configuration error — invalid CORS origin "${origin}" (must be http(s)://...).`);
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(vars.ADMIN_BOOTSTRAP_EMAIL).trim())) {
    throw new Error('Configuration error — ADMIN_BOOTSTRAP_EMAIL is not a valid email address.');
  }

  const int = (name, fallback, min = 1, max = 1_000_000) => {
    const raw = vars[name];
    if (raw === undefined || String(raw).trim() === '') return fallback;
    const n = Number.parseInt(String(raw), 10);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`Configuration error — ${name} must be an integer between ${min} and ${max}.`);
    }
    return n;
  };

  const float = (name, fallback, min = 0, max = 1) => {
    const raw = vars[name];
    if (raw === undefined || String(raw).trim() === '') return fallback;
    const n = Number.parseFloat(String(raw));
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`Configuration error — ${name} must be a number between ${min} and ${max}.`);
    }
    return n;
  };

  const env = {
    NODE_ENV: String(vars.NODE_ENV ?? 'development').trim() || 'development',
    PORT: int('PORT', 3001, 1, 65535),
    APP_URL: String(vars.APP_URL).trim().replace(/\/+$/, ''),
    BACKEND_URL: String(vars.BACKEND_URL).trim().replace(/\/+$/, ''),
    CORS_ORIGINS: rawOrigins,
    SUPABASE_URL: url.origin,
    SUPABASE_ANON_KEY: String(vars.SUPABASE_ANON_KEY).trim(),
    SUPABASE_SERVICE_ROLE_KEY: String(vars.SUPABASE_SERVICE_ROLE_KEY).trim(),
    SESSION_SECRET: secret,
    SESSION_TTL_MINUTES: int('SESSION_TTL_MINUTES', 60, 1, 1440),
    OTP_TTL_MINUTES: int('OTP_TTL_MINUTES', 10, 1, 60),
    PIN_RESET_TTL_MINUTES: int('PIN_RESET_TTL_MINUTES', 15, 1, 120),
    SMTP: vars.SMTP_HOST && vars.SMTP_HOST.trim() !== ''
      ? {
          host: String(vars.SMTP_HOST).trim(),
          port: int('SMTP_PORT', 587, 1, 65535),
          user: isNonEmpty(vars.SMTP_USER) ? String(vars.SMTP_USER).trim() : null,
          pass: isNonEmpty(vars.SMTP_PASS) ? String(vars.SMTP_PASS).trim() : null,
          from: isNonEmpty(vars.EMAIL_FROM) ? String(vars.EMAIL_FROM).trim() : null,
          fromName: isNonEmpty(vars.EMAIL_FROM_NAME) ? String(vars.EMAIL_FROM_NAME).trim() : 'K-Shop',
        }
      : null,
    GEMINI_API_KEY: isNonEmpty(vars.GEMINI_API_KEY) ? String(vars.GEMINI_API_KEY).trim() : null,
    GEMINI_MODEL: isNonEmpty(vars.GEMINI_MODEL) ? String(vars.GEMINI_MODEL).trim() : 'gemini-flash',
    POSTHOG_KEY: isNonEmpty(vars.POSTHOG_KEY) ? String(vars.POSTHOG_KEY).trim() : null,
    POSTHOG_HOST: isNonEmpty(vars.POSTHOG_HOST) ? String(vars.POSTHOG_HOST).trim() : null,
    ADMIN_BOOTSTRAP_EMAIL: String(vars.ADMIN_BOOTSTRAP_EMAIL).trim().toLowerCase(),
    ADMIN_BOOTSTRAP_PASSWORD: isNonEmpty(vars.ADMIN_BOOTSTRAP_PASSWORD)
      ? String(vars.ADMIN_BOOTSTRAP_PASSWORD)
      : null,
    // Commerce fees are SERVER-owned (Phase A follow-up: move money constants
    // behind env). The defaults mirror the values the UI shows (CartContext:
    // ₹75 courier, complimentary over ₹10k) so checkout totals agree.
    ORDER_DELIVERY_FEE: int('ORDER_DELIVERY_FEE', 75, 0, 100000),
    ORDER_FREE_SHIPPING_THRESHOLD: int('ORDER_FREE_SHIPPING_THRESHOLD', 10000, 0, 1000000000),
    ORDER_LOW_STOCK_THRESHOLD: int('ORDER_LOW_STOCK_THRESHOLD', 5, 0, 100000),
    // Storage bucket names (defaults match 0001_init_schema.sql §13).
    STORAGE_BUCKET_PRODUCT_IMAGES: isNonEmpty(vars.STORAGE_BUCKET_PRODUCT_IMAGES)
      ? String(vars.STORAGE_BUCKET_PRODUCT_IMAGES).trim()
      : null,
    STORAGE_BUCKET_SELLER_DOCUMENTS: isNonEmpty(vars.STORAGE_BUCKET_SELLER_DOCUMENTS)
      ? String(vars.STORAGE_BUCKET_SELLER_DOCUMENTS).trim()
      : null,
    STORAGE_BUCKET_VERIFICATION_DOCS: isNonEmpty(vars.STORAGE_BUCKET_VERIFICATION_DOCS)
      ? String(vars.STORAGE_BUCKET_VERIFICATION_DOCS).trim()
      : null,
    // Seller identity + face verification (KYC).
    //   * FACE_VERIFICATION_PROVIDER = "human" (real on-server ML via
    //     @vladmandic/human) or "disabled" (tests/lightweight deploys — the
    //     flow then answers an honest 503 instead of faking success, §2.6).
    //   * Scores below are REAL decision thresholds consumed by the provider;
    //     they are configurable per §6 ("no universal similarity threshold")
    //     and must be validated with test data before tuning live.
    FACE_VERIFICATION_PROVIDER: isNonEmpty(vars.FACE_VERIFICATION_PROVIDER)
      ? String(vars.FACE_VERIFICATION_PROVIDER).trim()
      : 'human',
    FACE_MATCH_SIMILARITY_THRESHOLD: float('FACE_MATCH_SIMILARITY_THRESHOLD', 0.5, 0, 1),
    FACE_MANUAL_REVIEW_SIMILARITY: float('FACE_MANUAL_REVIEW_SIMILARITY', 0.35, 0, 1),
    FACE_LIVENESS_MIN_SCORE: float('FACE_LIVENESS_MIN_SCORE', 0.5, 0, 1),
    FACE_ANTISPOOF_MIN_SCORE: float('FACE_ANTISPOOF_MIN_SCORE', 0.5, 0, 1),
    FACE_MAX_ATTEMPTS: int('FACE_MAX_ATTEMPTS', 10, 1, 20),
    FACE_SESSION_TTL_MINUTES: int('FACE_SESSION_TTL_MINUTES', 15, 1, 60),
    FACE_MAX_FRAME_BYTES: int('FACE_MAX_FRAME_BYTES', 800 * 1024, 16 * 1024, 4 * 1024 * 1024),
    FACE_MAX_LIVE_FRAMES: int('FACE_MAX_LIVE_FRAMES', 24, 4, 60),
    FACE_DOC_RETENTION_DAYS: int('FACE_DOC_RETENTION_DAYS', 90, 1, 3650),
  };

  return Object.freeze(env);
}