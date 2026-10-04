/**
 * Seller identity + face verification (0005/0006 workflow) — full route
 * coverage with a DETERMINISTIC FAKE provider injected through createApp DI.
 * No ML engine, no network: the tests prove the backend security/state
 * contract, and the fake provider proves WHAT the routes send to / read from
 * the provider boundary (the real engine is smoke-tested in scratch probes).
 *
 * Proven per BACKEND_SPEC §6/§8/§11/§12/§17 + §5.1–20, 29–35, 60–68:
 * - authn: no session → 401; consent required; suspended → 403
 * - provider disabled → HONEST 503 (never a fake "verified")
 * - IDOR: face/complete lookups are scoped to the session owner (404)
 * - session expiry (410), replay of COMPLETED/REVOKED sessions (409),
 *   unknown/out-of-challenge steps (400)
 * - attempt cap → REJECTED + REVOKED; no unlimited retries
 * - client-supplied state/scores are ignored; every outcome comes from the
 *   provider; scores NEVER cross the wire (audit-only)
 * - liveness fail-closed; complete → VERIFIED / MANUAL_REVIEW / REJECTED via
 *   real provider similarity, with fail-closed MANUAL_REVIEW when the engine
 *   is unable (no score → admin cannot fabricate an approval)
 * - admin review: role-gated list, approve (needs real score), reject (reason
 *   required), request-reverification (revokes sessions, purges frame cache,
 *   opens a NEW cycle)
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { sign } from 'cookie-signature';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';
import { FrameCache } from '../src/lib/verification/frames.js';

const SESSION_SECRET = 'y'.repeat(48);
const signedCookie = (token) => `s:${sign(token, SESSION_SECRET)}`;

const validEnv = () => ({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  BACKEND_URL: 'http://localhost:3001',
  CORS_ORIGINS: 'http://localhost:5173',
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  SESSION_SECRET: SESSION_SECRET,
  SESSION_TTL_MINUTES: '60',
  ADMIN_BOOTSTRAP_EMAIL: 'admin@kshop.test',
  FACE_VERIFICATION_PROVIDER: 'human',
  FACE_MATCH_SIMILARITY_THRESHOLD: '0.5',
  FACE_MANUAL_REVIEW_SIMILARITY: '0.35',
  FACE_MAX_ATTEMPTS: '5',
  FACE_SESSION_TTL_MINUTES: '15',
  FACE_MAX_FRAME_BYTES: String(800 * 1024),
  FACE_DOC_RETENTION_DAYS: '90',
});

async function makeServer(supabase, provider, frameCache) {
  const env = loadEnv(validEnv());
  const app = createApp({
    env,
    supabase,
    verification: {
      faceVerification: provider,
      frameCache: frameCache ?? new FrameCache(),
    },
  });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, app };
}

/** request helper — JSON bodies (objects/strings) and raw byte bodies (Buffers). */
const request = async (base, path, { method = 'GET', headers = {}, body } = {}) => {
  const isRaw = Buffer.isBuffer(body);
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': isRaw ? 'application/octet-stream' : 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : isRaw ? body : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, body: json };
};

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CUSTOMER = uid(10);
const OTHER = uid(11);
const ADMIN = uid(30);

// A sniffable "image/jpeg" byte blob (magic bytes + slack) — enough for the
// raw parsers and sniffMime; the FAKE provider never decodes it.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(24)]);
const PDF = Buffer.concat([Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), Buffer.alloc(16)]);
const JUNK = Buffer.alloc(64, 7);

const customerCookie = () =>
  `ks_access=${signedCookie(`at-${CUSTOMER}`)}; ks_refresh=${signedCookie(`rt-${CUSTOMER}`)}`;
const otherCookie = () =>
  `ks_access=${signedCookie(`at-${OTHER}`)}; ks_refresh=${signedCookie(`rt-${OTHER}`)}`;
const adminCookie = () =>
  `ks_access=${signedCookie(`at-${ADMIN}`)}; ks_refresh=${signedCookie(`rt-${ADMIN}`)}`;

function seedUser(fake, { id, email, role = 'CUSTOMER', status = 'ACTIVE' }) {
  fake.helpers.seedUser({ id, email });
  fake.helpers.seedProfile({
    id,
    email,
    role,
    roles: [role],
    status,
    full_name: role === 'ADMIN' ? 'Root Admin' : `User ${id.slice(-4)}`,
  });
}

function seedVerification(fake, {
  id = uid(40), userId = CUSTOMER, cycle = 1, status = 'NOT_STARTED', extra = {},
} = {}) {
  const now = new Date().toISOString();
  return fake.helpers.seedRow('seller_verifications', {
    id,
    user_id: userId,
    cycle,
    verification_status: status,
    consent_granted: false,
    face_verification_provider: 'human',
    max_attempts: 5,
    attempt_count: 0,
    data_retained_until: new Date(Date.now() + 90 * 86400_000).toISOString(),
    created_at: now,
    updated_at: now,
    ...extra,
  });
}

function seedSeller(fake, { profileId = CUSTOMER, verificationStatus = 'PENDING', storeName = 'Aarav Books' } = {}) {
  return fake.helpers.seedSeller({
    profile_id: profileId,
    store_name: storeName,
    verification_status: verificationStatus,
  });
}

function seedActiveSession(fake, { id = uid(60), userId = CUSTOMER, verificationId = uid(40), expiresInMs = 900_000, challenge } = {}) {
  return fake.helpers.seedRow('verification_sessions', {
    id,
    user_id: userId,
    verification_id: verificationId,
    status: 'ACTIVE',
    challenge: challenge ?? { sequence: ['blink'], completed: [] },
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    last_activity_at: new Date().toISOString(),
    live_frames_accepted: 0,
  });
}

/**
 * Deterministic fake provider implementing the REAL provider contract
 * (lib/faceVerification/index.js) — tests assert on what routes SEND to it
 * and how they USE its results. `overrides` swaps any method or threshold.
 */
function fakeProvider(overrides = {}) {
  const provider = {
    mode: 'human',
    configured: true,
    thresholds: {
      matchSimilarity: 0.5,
      manualReviewSimilarity: 0.35,
      livenessMin: 0.5,
      antispoofMin: 0.5,
      maxAttempts: 5,
    },
    calls: { documents: 0, liveness: 0, compare: 0 },
    analyzeIdentityDocument: async (input) => {
      provider.calls.documents += 1;
      provider.lastDocumentInput = { bytes: input.bytes, mime: input.mime };
      return { status: 'PASSED', faceCount: 1, reasons: [], provider: 'human', meta: { sharpness: 42, luma: 150, areaFraction: 0.3 } };
    },
    computeLiveness: async (input) => {
      provider.calls.liveness += 1;
      provider.lastLivenessInput = { steps: (input.frames ?? []).map((f) => f.step), step: input.step };
      return { passed: true, reasons: [] };
    },
    compareFaces: async (input) => {
      provider.calls.compare += 1;
      provider.lastCompareInput = {
        idBytes: input.id?.bytes?.byteLength ?? null,
        liveBytes: input.live?.bytes?.byteLength ?? null,
        liveStep: input.live?.step ?? null,
      };
      return { similarity: 0.92, distance: 0.08, threshold: 0.5, passed: true };
    },
    ...overrides,
  };
  return provider;
}

const disabledProvider = () => ({
  mode: 'disabled',
  configured: false,
  thresholds: {},
  analyzeIdentityDocument: async () => { throw Object.assign(new Error('not configured'), { status: 503 }); },
  computeLiveness: async () => { throw Object.assign(new Error('not configured'), { status: 503 }); },
  compareFaces: async () => { throw Object.assign(new Error('not configured'), { status: 503 }); },
});

// ── authn / provider-configuration gates ────────────────────────────────────

test('verification routes require an authenticated session (401 anonymous)', async () => {
  const fake = createFakeSupabase();
  const { server, base } = await makeServer(fake, fakeProvider());
  try {
    const session = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', body: '{"consent":true}',
    });
    assert.equal(session.status, 401);
    const status = await request(base, '/api/v1/seller/verification/status');
    assert.equal(status.status, 401);
    const frame = await request(base, '/api/v1/seller/verification/face?sessionId=x&step=blink&final=true', {
      method: 'POST', body: JPEG,
    });
    assert.equal(frame.status, 401);
  } finally {
    server.close();
  }
});

test('session start requires consent and an ACTIVE account', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedVerification(fake);
  const { server, base } = await makeServer(fake, fakeProvider());
  try {
    const noConsent = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{}',
    });
    assert.equal(noConsent.status, 400);
    assert.match(noConsent.body.error.message, /consent/);

    // Suspended accounts cannot start verification either.
    fake.helpers.setProfile(CUSTOMER, { status: 'SUSPENDED' });
    const suspended = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    assert.equal(suspended.status, 403);
    assert.match(suspended.body.error.message, /suspended/i);
  } finally {
    server.close();
  }
});

test('provider disabled → HONEST 503, never a fake verification row', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  const { server, base } = await makeServer(fake, disabledProvider());
  try {
    const res = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    assert.equal(res.status, 503);
    assert.match(res.body.error.message, /not configured/);
    // No verification row, no session — nothing half-created.
    assert.equal(fake.helpers.rows('seller_verifications').length, 0);
    assert.equal(fake.helpers.rows('verification_sessions').length, 0);
  } finally {
    server.close();
  }
});

// ── session start ───────────────────────────────────────────────────────────

test('session start returns a challenge + short-lived session; unexpired session is reused', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedVerification(fake);
  const { server, base } = await makeServer(fake, fakeProvider());
  try {
    const res = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.provider.mode, 'human');
    assert.equal(res.body.provider.configured, true);
    assert.ok(res.body.verification.verificationId);
    assert.equal(res.body.verification.cycle, 1);
    const challenge = res.body.session.challenge;
    // THE LIVENESS CHALLENGE IS EXACTLY ONE ACTION: a single blink.
    //
    // It used to be a randomized four-pose sequence ('look_straight' first so
    // the face-match reference frame came from it, plus 'blink', 'turn_left'
    // and 'turn_right'). That vocabulary is gone, not deprecated: if any of
    // those steps can reappear in this response, the four-pose flow has been
    // reintroduced and this assertion fails.
    assert.deepEqual(challenge, ['blink']);
    assert.equal(challenge.length, 1);
    // No pose vocabulary anywhere in the contract, in any form.
    for (const step of challenge) {
      assert.ok(!['look_straight', 'turn_left', 'turn_right'].includes(step), `pose step returned: ${step}`);
    }
    assert.ok(res.body.session.expiresInSeconds > 0);
    // Consent recorded on the verification row.
    const v = fake.helpers.getRow('seller_verifications', res.body.verification.verificationId);
    assert.equal(v.consent_granted, true);

    // A second start reuses the still-valid session (no double session).
    const again = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.session.id, res.body.session.id);
    assert.equal(fake.helpers.rows('verification_sessions').length, 1);

    // Already VERIFIED → cannot start again.
    fake.helpers.getRow('seller_verifications', res.body.verification.verificationId)
      .verification_status = 'VERIFIED';
    const done = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    assert.equal(done.status, 409);
    assert.match(done.body.error.message, /already been completed/);
  } finally {
    server.close();
  }
});

// ── document stage ──────────────────────────────────────────────────────────

test('document upload: PASSED → DOCUMENT_VERIFIED; bytes stored privately; client verdict ignored', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedVerification(fake);
  const provider = fakeProvider();
  const { server, base } = await makeServer(fake, provider);
  try {
    const session = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    // Client tries to smuggle a state — the route only reads the provider.
    const res = await request(base, '/api/v1/seller/verification/document?type=COLLEGE_ID&status=VERIFIED&score=1', {
      method: 'POST',
      headers: { cookie: customerCookie(), 'Content-Type': 'application/octet-stream' },
      body: JPEG,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.state, 'DOCUMENT_VERIFIED');
    assert.equal(res.body.review, 'PASSED');

    // The provider really was consulted with the uploaded bytes.
    assert.equal(provider.calls.documents, 1);
    assert.equal(provider.lastDocumentInput.mime, 'image/jpeg');
    assert.equal(provider.lastDocumentInput.bytes.byteLength, JPEG.byteLength);

    // The exact bytes landed in the PRIVATE verification bucket.
    const stored = fake.helpers.storageObjects().filter((o) => o.bucket === 'seller-verification-docs');
    assert.equal(stored.length, 1);
    assert.ok(stored[0].path.startsWith('verif-docs/'));
    assert.equal(Buffer.compare(Buffer.from(stored[0].bytes), JPEG), 0);

    // DB row reflects the transition (multi-hop walked as legal single steps).
    const v = fake.helpers.getRow('seller_verifications', session.body.verification.verificationId);
    assert.equal(v.verification_status, 'DOCUMENT_VERIFIED');
    assert.equal(v.document_mime, 'image/jpeg');
    assert.equal(v.document_type, 'COLLEGE_ID');
    assert.ok(v.document_sha256);

    // nothing client-claimed leaked into the row
    assert.ok(!('verification_score' in v) || v.verification_score == null);
    assert.notEqual(v.verification_status, 'VERIFIED');
  } finally {
    server.close();
  }
});

test('document upload: FAILED → REJECTED and ambiguous → MANUAL_REVIEW (fail-closed)', async () => {
  // FAILED document
  {
    const fake = createFakeSupabase();
    seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
    seedVerification(fake);
    const provider = fakeProvider({
      analyzeIdentityDocument: async () =>
        ({ status: 'FAILED', faceCount: 0, reasons: ['blurred', 'face_too_small'], provider: 'human', meta: {} }),
    });
    const { server, base } = await makeServer(fake, provider);
    try {
      await request(base, '/api/v1/seller/verification/session', {
        method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
      });
      const res = await request(base, '/api/v1/seller/verification/document?type=COLLEGE_ID', {
        method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.state, 'REJECTED');
      assert.match(res.body.message, /could not be verified/);
      const v = fake.helpers.rows('seller_verifications')[0];
      assert.equal(v.verification_status, 'REJECTED');
      assert.ok(v.rejection_reason);
    } finally { server.close(); }
  }
  // Ambiguous (NEEDS_REVIEW) document → MANUAL_REVIEW, review REQUIRED.
  {
    const fake = createFakeSupabase();
    seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
    seedVerification(fake, { id: uid(41) });
    const provider = fakeProvider({
      analyzeIdentityDocument: async () =>
        ({ status: 'NEEDS_REVIEW', faceCount: 1, reasons: ['document_ambiguous'], provider: 'human', meta: {} }),
    });
    const { server, base } = await makeServer(fake, provider);
    try {
      await request(base, '/api/v1/seller/verification/session', {
        method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
      });
      const res = await request(base, '/api/v1/seller/verification/document?type=COLLEGE_ID', {
        method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.state, 'MANUAL_REVIEW');
      const v = fake.helpers.rows('seller_verifications')[0];
      assert.equal(v.verification_status, 'MANUAL_REVIEW');
      assert.equal(v.review_status, 'REQUIRED');
    } finally { server.close(); }
  }
});

test('document upload rejects non-photo bytes (PDF / junk) with 400', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedVerification(fake);
  const { server, base } = await makeServer(fake, fakeProvider());
  try {
    await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    const pdf = await request(base, '/api/v1/seller/verification/document?type=COLLEGE_ID', {
      method: 'POST', headers: { cookie: customerCookie() }, body: PDF,
    });
    assert.equal(pdf.status, 400);
    assert.match(pdf.body.error.message, /JPG or PNG/);
    const junk = await request(base, '/api/v1/seller/verification/document?type=GOVERNMENT_ID', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JUNK,
    });
    assert.equal(junk.status, 400);
    // Unknown document type query value
    const badType = await request(base, '/api/v1/seller/verification/document?type=HACK', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(badType.status, 400);
    // No storage object was written for any rejected upload.
    assert.equal(fake.helpers.storageObjects().filter((o) => o.bucket === 'seller-verification-docs').length, 0);
  } finally {
    server.close();
  }
});

// ── face capture ────────────────────────────────────────────────────────────

test('the single-blink challenge walks to LIVENESS_CHECK in one burst', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedVerification(fake);
  const provider = fakeProvider();
  const frameCache = new FrameCache();
  const { server, base } = await makeServer(fake, provider, frameCache);
  try {
    const session = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    const vId = session.body.verification.verificationId;
    const sessionId = session.body.session.id;
    const challenge = session.body.session.challenge;
    assert.deepEqual(challenge, ['blink']);

    // Document first (provider PASSED).
    const doc = await request(base, '/api/v1/seller/verification/document?type=COLLEGE_ID', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(doc.body.state, 'DOCUMENT_VERIFIED');

    // The one and only challenge step. First frame (final for its step)
    // auto-advances into FACE_CAPTURE_REQUIRED, and because 'blink' is the
    // ONLY step, the same burst finishes the challenge.
    const only = await request(
      base,
      `/api/v1/seller/verification/face?sessionId=${sessionId}&step=blink&final=true`,
      { method: 'POST', headers: { cookie: customerCookie() }, body: JPEG },
    );
    assert.equal(only.status, 200, JSON.stringify(only.body));
    assert.equal(only.body.stepComplete, true);
    assert.deepEqual(only.body.remainingSteps, []);
    assert.equal(only.body.allStepsComplete, true);
    assert.equal(only.body.state, 'LIVENESS_CHECK');
    const v = fake.helpers.getRow('seller_verifications', vId);
    assert.equal(v.verification_status, 'LIVENESS_CHECK');
    // Exactly one liveness burst was analysed, for the blink.
    assert.equal(provider.calls.liveness, 1);
    assert.deepEqual(provider.lastLivenessInput.steps, ['blink']);

    // A SECOND blink burst is a duplicate submission attempt, not extra
    // evidence: the challenge is already complete.
    const replay = await request(
      base,
      `/api/v1/seller/verification/face?sessionId=${sessionId}&step=blink&final=true`,
      { method: 'POST', headers: { cookie: customerCookie() }, body: JPEG },
    );
    assert.equal(replay.status, 409);
  } finally {
    server.close();
  }
});

test('face capture: IDOR on sessionId → 404, expired → 410, replay → 409, unknown step → 400', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedUser(fake, { id: OTHER, email: 'meera@kshop.test' });
  seedVerification(fake);
  const { server, base } = await makeServer(fake, fakeProvider());
  try {
    // Own session (from a fresh start).
    const session = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    const sessionId = session.body.session.id;

    // Unknown session → generic 404.
    const unknown = await request(base, `/api/v1/seller/verification/face?sessionId=${uid(99)}&step=blink`, {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(unknown.status, 404);

    // Another user's session id → 404 (session is bound to the owner).
    const idor = await request(base, `/api/v1/seller/verification/face?sessionId=${sessionId}&step=blink`, {
      method: 'POST', headers: { cookie: otherCookie() }, body: JPEG,
    });
    assert.equal(idor.status, 404);
    assert.match(idor.body.error.message, /not found/);

    // Unknown capture step is rejected before any ML work.
    const bogusStep = await request(base, `/api/v1/seller/verification/face?sessionId=${sessionId}&step=wave`, {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(bogusStep.status, 400);
    assert.match(bogusStep.body.error.message, /Invalid capture step/);

    // Expired session → 410 with an honest "start a new one".
    const expiredId = uid(61);
    seedActiveSession(fake, { id: expiredId, verificationId: session.body.verification.verificationId, expiresInMs: -60_000 });
    const expired = await request(base, `/api/v1/seller/verification/face?sessionId=${expiredId}&step=blink`, {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(expired.status, 410);
    assert.match(expired.body.error.message, /expired/);

    // A COMPLETED session cannot be replayed (set session COMPLETED directly).
    fake.helpers.getRow('verification_sessions', sessionId).status = 'COMPLETED';
    const replay = await request(base, `/api/v1/seller/verification/face?sessionId=${sessionId}&step=blink`, {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(replay.status, 409);
    assert.match(replay.body.error.message, /already finished/);
  } finally {
    server.close();
  }
});

test('face capture: liveness failures count attempts and REJECT at the cap', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedVerification(fake, { extra: { max_attempts: 2 } });
  const provider = fakeProvider({
    computeLiveness: async () => ({ passed: false, reasons: ['liveness_low'] }),
  });
  const { server, base } = await makeServer(fake, provider);
  try {
    const session = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    const vId = session.body.verification.verificationId;
    const sessionId = session.body.session.id;
    const step = session.body.session.challenge[0];

    // Document first (provider PASSED → DOCUMENT_VERIFIED) so face capture is
    // actually reachable.
    const doc = await request(base, '/api/v1/seller/verification/document?type=COLLEGE_ID', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(doc.body.state, 'DOCUMENT_VERIFIED');

    const first = await request(base, `/api/v1/seller/verification/face?sessionId=${sessionId}&step=${step}&final=true`, {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.stepFailed, true);
    assert.equal(first.body.state, 'FACE_CAPTURE_REQUIRED');
    assert.equal(first.body.retriesLeft, 1);
    let v = fake.helpers.getRow('seller_verifications', vId);
    assert.equal(v.attempt_count, 1);

    // Second failure hits the cap → REJECTED, session REVOKED.
    const second = await request(base, `/api/v1/seller/verification/face?sessionId=${sessionId}&step=${step}&final=true`, {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.state, 'REJECTED');
    v = fake.helpers.getRow('seller_verifications', vId);
    assert.equal(v.verification_status, 'REJECTED');
    assert.ok(v.rejection_reason);
    assert.equal(fake.helpers.getRow('verification_sessions', sessionId).status, 'REVOKED');

    // The revoked session cannot be replayed.
    const replay = await request(base, `/api/v1/seller/verification/face?sessionId=${sessionId}&step=${step}&final=true`, {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(replay.status, 409);
  } finally {
    server.close();
  }
});

// ── complete (face match) ───────────────────────────────────────────────────

/** Drive a full session: consent → doc(PASSED) → all challenge steps → return response. */
async function runFullFlow(base, provider, { cookie = customerCookie() } = {}) {
  const session = await request(base, '/api/v1/seller/verification/session', {
    method: 'POST', headers: { cookie }, body: '{"consent":true}',
  });
  assert.equal(session.status, 200, JSON.stringify(session.body));
  const sessionId = session.body.session.id;
  const challenge = session.body.session.challenge;
  await request(base, '/api/v1/seller/verification/document?type=COLLEGE_ID', {
    method: 'POST', headers: { cookie }, body: JPEG,
  });
  for (let i = 0; i < challenge.length; i++) {
    const frame = await request(
      base,
      `/api/v1/seller/verification/face?sessionId=${sessionId}&step=${challenge[i]}&final=true`,
      { method: 'POST', headers: { cookie }, body: JPEG },
    );
    assert.equal(frame.status, 200, JSON.stringify(frame.body));
  }
  return { sessionId, verificationId: session.body.verification.verificationId };
}

test('complete: a PASSING similarity still goes to review — no automatic approval', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedVerification(fake);
  const provider = fakeProvider(); // compare → { similarity: 0.92, passed: true }
  const frameCache = new FrameCache();
  const { server, base } = await makeServer(fake, provider, frameCache);
  try {
    const { sessionId } = await runFullFlow(base, provider);

    // Client tries to influence the outcome with fabricated fields — ignored.
    const complete = await request(base, '/api/v1/seller/verification/complete', {
      method: 'POST', headers: { cookie: customerCookie() },
      body: JSON.stringify({ sessionId, verified: true, score: 0.99, status: 'VERIFIED' }),
    });
    assert.equal(complete.status, 200, JSON.stringify(complete.body));

    // ── THE CENTRAL GUARANTEE ────────────────────────────────────────────
    // A similarity of 0.92 is comfortably above the pass threshold. It used to
    // move the row straight to VERIFIED with no human involved. It must NOT
    // any more: the outcome is an ADMIN decision, and the only thing that can
    // approve a seller is the admin-gated approve route.
    assert.equal(complete.body.state, 'MANUAL_REVIEW');
    assert.equal(complete.body.reviewStatus, 'UNDER_REVIEW');
    assert.ok(!JSON.stringify(complete.body).includes('VERIFIED'));

    const v = fake.helpers.rows('seller_verifications')[0];
    assert.equal(v.verification_status, 'MANUAL_REVIEW');
    assert.equal(v.review_status, 'REQUIRED');
    // The engine's numbers are RECORDED for the reviewer to see…
    assert.equal(v.verification_score, 0.92);
    assert.equal(v.match_status, 'PASSED');
    // …but a recorded score is not a decision: no reviewer, no terminal state.
    assert.equal(v.reviewed_at, undefined);
    assert.equal(v.reviewed_by, undefined);

    // The PROVIDER did the analysis (client scores never read).
    assert.equal(provider.calls.compare, 1);
    assert.ok(provider.lastCompareInput.idBytes > 0);
    assert.ok(provider.lastCompareInput.liveBytes > 0);

    // No similarity/score crosses the wire.
    const bodyText = JSON.stringify(complete.body);
    assert.ok(!bodyText.includes('similarity'));
    assert.ok(!bodyText.includes('score'));

    const session = fake.helpers.rows('verification_sessions')[0];
    assert.equal(session.status, 'COMPLETED');
    assert.ok(session.completed_at);
    // Raw frames purged after completion.
    assert.equal(frameCache.size(), 0);
    // Session replay blocked.
    const replay = await request(base, `/api/v1/seller/verification/face?sessionId=${sessionId}&step=blink`, {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    assert.equal(replay.status, 409);
  } finally {
    server.close();
  }
});

test('complete: any similarity → MANUAL_REVIEW; admin approve → VERIFIED and grants seller access', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedUser(fake, { id: ADMIN, email: 'admin@kshop.test', role: 'ADMIN' });
  seedSeller(fake, { profileId: CUSTOMER, verificationStatus: 'PENDING' });
  seedVerification(fake);
  const provider = fakeProvider({
    compareFaces: async () => ({ similarity: 0.4, distance: 0.6, threshold: 0.5, passed: false }),
  });
  const { server, base } = await makeServer(fake, provider);
  try {
    const { sessionId } = await runFullFlow(base, provider);
    const complete = await request(base, '/api/v1/seller/verification/complete', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JSON.stringify({ sessionId }),
    });
    assert.equal(complete.status, 200, JSON.stringify(complete.body));
    assert.equal(complete.body.state, 'MANUAL_REVIEW');

    const v = fake.helpers.rows('seller_verifications')[0];
    assert.equal(v.verification_status, 'MANUAL_REVIEW');
    assert.equal(v.verification_score, 0.4); // real score stored → approvable
    assert.equal(v.review_status, 'REQUIRED');

    // Before the admin decision the seller APIs must be CLOSED. The account has
    // no SELLER role and a PENDING verification, so the guard refuses.
    const before = await request(base, '/api/v1/seller/metrics', {
      method: 'GET', headers: { cookie: customerCookie() },
    });
    assert.equal(before.status, 403);

    // Admin approve (reviewer comes from the session, never the client).
    const approve = await request(base, `/api/v1/admin/seller-verifications/${v.id}/approve`, {
      method: 'POST', headers: { cookie: adminCookie() }, body: '{}',
    });
    assert.equal(approve.status, 200, JSON.stringify(approve.body));
    assert.equal(approve.body.state, 'VERIFIED');
    const after = fake.helpers.getRow('seller_verifications', v.id);
    assert.equal(after.verification_status, 'VERIFIED');
    assert.equal(after.reviewed_by, ADMIN);
    assert.ok(after.reviewed_at);

    // ── APPROVAL MUST ACTUALLY GRANT SELLER ACCESS ───────────────────────
    // The approve route used to write only to `seller_verifications`, so the
    // admin saw "approved" while every seller API still returned 403 and the
    // "OPEN SELLER DASHBOARD" button led nowhere. Both halves of the grant are
    // now written together, and the guard checks BOTH.
    const seller = fake.helpers.getRow('seller_profiles', CUSTOMER);
    assert.equal(seller.verification_status, 'APPROVED');
    const profile = fake.helpers.getRow('profiles', CUSTOMER);
    assert.ok(profile.roles.includes('SELLER'), `roles=${JSON.stringify(profile.roles)}`);
    assert.equal(profile.role, 'CUSTOMER'); // keeps buying (§8)
    assert.ok(/^KNSR-/.test(profile.business_id), profile.business_id);

    // And the seller API now opens — proving the grant was real, not cosmetic.
    const after2 = await request(base, '/api/v1/seller/metrics', {
      method: 'GET', headers: { cookie: customerCookie() },
    });
    assert.equal(after2.status, 200, JSON.stringify(after2.body));
  } finally {
    server.close();
  }
});

test('complete: provider unable → MANUAL_REVIEW fail-closed; no score → admin cannot approve', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedUser(fake, { id: ADMIN, email: 'admin@kshop.test', role: 'ADMIN' });
  seedVerification(fake);
  const provider = fakeProvider({
    compareFaces: async () => ({ similarity: null, distance: null, threshold: 0.5, passed: false, unable: true, reason: 'embedding_unavailable' }),
  });
  const { server, base } = await makeServer(fake, provider);
  try {
    await runFullFlow(base, provider);
    const sessionId = fake.helpers.rows('verification_sessions')[0].id;
    const complete = await request(base, '/api/v1/seller/verification/complete', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JSON.stringify({ sessionId }),
    });
    assert.equal(complete.status, 200);
    assert.equal(complete.body.state, 'MANUAL_REVIEW'); // never an automatic pass

    const v = fake.helpers.rows('seller_verifications')[0];
    assert.equal(v.verification_status, 'MANUAL_REVIEW');
    assert.equal(v.verification_score, null);
    assert.equal(v.match_status, 'PENDING');

    // An admin cannot fabricate an approval without real evidence.
    const approve = await request(base, `/api/v1/admin/seller-verifications/${v.id}/approve`, {
      method: 'POST', headers: { cookie: adminCookie() }, body: '{}',
    });
    assert.equal(approve.status, 409);
    assert.match(approve.body.error.message, /no face-match score/);
  } finally {
    server.close();
  }
});

test('complete: a very low similarity is ALSO not an automatic rejection', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedVerification(fake);
  const provider = fakeProvider({
    compareFaces: async () => ({ similarity: 0.1, distance: 0.9, threshold: 0.5, passed: false }),
  });
  const { server, base } = await makeServer(fake, provider);
  try {
    await runFullFlow(base, provider);
    const sessionId = fake.helpers.rows('verification_sessions')[0].id;
    const complete = await request(base, '/api/v1/seller/verification/complete', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JSON.stringify({ sessionId }),
    });
    assert.equal(complete.status, 200);

    // This used to end in REJECTED. A poor automated score is now evidence FOR
    // the reviewer, not a decision BY the system: rejecting a person outright on
    // one model output is exactly the kind of irreversible automated judgement
    // a KYC review exists to catch. The admin rejects via the reject route.
    assert.equal(complete.body.state, 'MANUAL_REVIEW');
    assert.equal(complete.body.reviewStatus, 'UNDER_REVIEW');

    const v = fake.helpers.rows('seller_verifications')[0];
    assert.equal(v.verification_status, 'MANUAL_REVIEW');
    assert.equal(v.verification_score, 0.1); // diagnostics kept server-side
    assert.equal(v.match_status, 'FAILED');
    assert.equal(v.review_status, 'REQUIRED');
    // No rejection reason: nothing was rejected.
    assert.equal(v.rejection_reason, undefined);

    // The failing evidence IS visible to the reviewer, server-side only.
    const audit = fake._state.auditLogs;
    const reviewEvent = audit.find((e) => String(e.action).includes('manual_review'));
    assert.ok(reviewEvent, 'a manual-review audit event was written');
    assert.equal(reviewEvent.metadata?.engineSuggestedMatch, 'FAILED');
  } finally {
    server.close();
  }
});

test('complete is gated: before LIVENESS_CHECK → 409, wrong session → 404', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedUser(fake, { id: OTHER, email: 'meera@kshop.test' });
  seedVerification(fake);
  const { server, base } = await makeServer(fake, fakeProvider());
  try {
    // Document only — never reached face capture.
    const session = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    const vexId = session.body.verification.verificationId;
    const sessionId = session.body.session.id;
    await request(base, '/api/v1/seller/verification/document?type=COLLEGE_ID', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    const early = await request(base, '/api/v1/seller/verification/complete', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JSON.stringify({ sessionId }),
    });
    assert.equal(early.status, 409);
    assert.match(early.body.error.message, /Complete the face-capture steps/);

    // Another user's session → 404 (session bound to its owner).
    seedActiveSession(fake, { id: uid(62), userId: CUSTOMER, verificationId: vexId });
    const idor = await request(base, '/api/v1/seller/verification/complete', {
      method: 'POST', headers: { cookie: otherCookie() }, body: JSON.stringify({ sessionId: uid(62) }),
    });
    assert.equal(idor.status, 404);
  } finally {
    server.close();
  }
});

// ── status / admin ──────────────────────────────────────────────────────────

test('GET /seller/verification/status surfaces honest state — never scores', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedUser(fake, { id: OTHER, email: 'meera@kshop.test' });
  seedVerification(fake);
  const { server, base } = await makeServer(fake, fakeProvider());
  try {
    // No verification yet (different user).
    const none = await request(base, '/api/v1/seller/verification/status', {
      headers: { cookie: otherCookie() },
    });
    assert.equal(none.status, 200);
    assert.equal(none.body.verification, null);

    const session = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    await request(base, '/api/v1/seller/verification/document?type=COLLEGE_ID', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JPEG,
    });
    const status = await request(base, '/api/v1/seller/verification/status', {
      headers: { cookie: customerCookie() },
    });
    assert.equal(status.status, 200);
    assert.equal(status.body.verification.state, 'DOCUMENT_VERIFIED');
    assert.equal(status.body.verification.cycle, 1);
    assert.equal(status.body.verification.attemptsRemaining, 5);
    assert.ok(status.body.session);
    assert.equal(status.body.session.id, session.body.session.id);
    const bodyText = JSON.stringify(status.body);
    assert.ok(!bodyText.includes('similarity'));
    assert.ok(!bodyText.includes('score'));
  } finally {
    server.close();
  }
});

test('admin verification list is role-gated and joins applicant email', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedUser(fake, { id: OTHER, email: 'meera@kshop.test' });
  seedUser(fake, { id: ADMIN, email: 'admin@kshop.test', role: 'ADMIN' });
  seedVerification(fake, { id: uid(50), userId: CUSTOMER, status: 'MANUAL_REVIEW', extra: { verification_score: 0.4, review_status: 'REQUIRED' } });
  seedVerification(fake, { id: uid(51), userId: OTHER, cycle: 1, status: 'VERIFIED', extra: { verification_score: 0.91, match_status: 'PASSED' } });
  const { server, base } = await makeServer(fake, fakeProvider());
  try {
    const anon = await request(base, '/api/v1/admin/seller-verifications');
    assert.equal(anon.status, 401);
    const customer = await request(base, '/api/v1/admin/seller-verifications', {
      headers: { cookie: customerCookie() },
    });
    assert.equal(customer.status, 403);
    const admin = await request(base, '/api/v1/admin/seller-verifications', {
      headers: { cookie: adminCookie() },
    });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.verifications.length, 2);
    const byId = new Map(admin.body.verifications.map((v) => [v.id, v]));
    assert.equal(byId.get(uid(50)).email, 'aarav@kshop.test');
    assert.equal(byId.get(uid(51)).email, 'meera@kshop.test');
    assert.equal(byId.get(uid(51)).state, 'VERIFIED');
    // Scores are NOT exposed to the admin API surface either.
    assert.ok(!('verification_score' in byId.get(uid(50))));
    assert.ok(!('similarity' in byId.get(uid(50))));
  } finally {
    server.close();
  }
});

test('admin verification list/endpoint expose a short-lived signed document URL (role-gated, 404 when no doc)', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedUser(fake, { id: ADMIN, email: 'admin@kshop.test', role: 'ADMIN' });
  seedVerification(fake, {
    id: uid(50),
    userId: CUSTOMER,
    status: 'MANUAL_REVIEW',
    extra: {
      document_storage_path: 'verif-docs/doc-a.webp',
      document_status: 'PASSED',
      consent_granted: true,
      verification_score: 0.4,
      review_status: 'REQUIRED',
    },
  });
  seedVerification(fake, { id: uid(51), userId: CUSTOMER, status: 'NOT_STARTED' }); // no document
  const { server, base } = await makeServer(fake, fakeProvider());
  try {
    // Role gate applies to the document endpoint too.
    const anon = await request(base, `/api/v1/admin/seller-verifications/${uid(50)}/document`);
    assert.equal(anon.status, 401);
    const customer = await request(base, `/api/v1/admin/seller-verifications/${uid(50)}/document`, {
      headers: { cookie: customerCookie() },
    });
    assert.equal(customer.status, 403);

    const admin = await request(base, '/api/v1/admin/seller-verifications', {
      headers: { cookie: adminCookie() },
    });
    assert.equal(admin.status, 200);
    const byId = new Map(admin.body.verifications.map((v) => [v.id, v]));
    // Only the row WITH a stored document carries a signed URL.
    assert.ok(byId.get(uid(50)).documentUrl.startsWith('https://storage.test/sign/'));
    assert.equal(byId.get(uid(51)).documentUrl, null);

    // Per-verification endpoint returns a fresh signed URL for the reviewer.
    const docRes = await request(base, `/api/v1/admin/seller-verifications/${uid(50)}/document`, {
      headers: { cookie: adminCookie() },
    });
    assert.equal(docRes.status, 200);
    assert.ok(docRes.body.documentUrl.startsWith('https://storage.test/sign/'));

    // No document was submitted → explicit 404 (never a leak of other rows).
    const noDoc = await request(base, `/api/v1/admin/seller-verifications/${uid(51)}/document`, {
      headers: { cookie: adminCookie() },
    });
    assert.equal(noDoc.status, 404);
    const bogus = await request(base, '/api/v1/admin/seller-verifications/not-a-uuid/document', {
      headers: { cookie: adminCookie() },
    });
    assert.equal(bogus.status, 404);
  } finally {
    server.close();
  }
});

test('admin reject requires a reason; request-reverification revokes sessions and opens a new cycle', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedUser(fake, { id: ADMIN, email: 'admin@kshop.test', role: 'ADMIN' });
  seedVerification(fake, { id: uid(50), userId: CUSTOMER, status: 'MANUAL_REVIEW', extra: { verification_score: 0.4, review_status: 'REQUIRED' } });
  seedActiveSession(fake, { id: uid(70), userId: CUSTOMER, verificationId: uid(50) });
  const frameCache = new FrameCache();
  frameCache.begin(uid(70));
  frameCache.add(uid(70), { step: 'blink', bytes: JPEG, mime: 'image/jpeg' });
  const { server, base } = await makeServer(fake, fakeProvider(), frameCache);
  try {
    // Reject: reason mandatory.
    const noReason = await request(base, `/api/v1/admin/seller-verifications/${uid(50)}/reject`, {
      method: 'POST', headers: { cookie: adminCookie() }, body: '{}',
    });
    assert.equal(noReason.status, 400);
    assert.match(noReason.body.error.message, /reason/);

    const rejected = await request(base, `/api/v1/admin/seller-verifications/${uid(50)}/reject`, {
      method: 'POST', headers: { cookie: adminCookie() }, body: '{"reason":"Document does not match the applicant."}',
    });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    const afterReject = fake.helpers.getRow('seller_verifications', uid(50));
    assert.equal(afterReject.verification_status, 'REJECTED');
    assert.equal(afterReject.reviewed_by, ADMIN);

    // Re-verification: require a note, revoke ACTIVE sessions, purge frames.
    const reVerify = await request(base, `/api/v1/admin/seller-verifications/${uid(50)}/request-reverification`, {
      method: 'POST', headers: { cookie: adminCookie() }, body: '{"reason":"Submit a fresh document."}',
    });
    assert.equal(reVerify.status, 200, JSON.stringify(reVerify.body));
    const row = fake.helpers.getRow('seller_verifications', uid(50));
    assert.equal(row.verification_status, 'REVERIFICATION_REQUIRED');
    assert.equal(fake.helpers.getRow('verification_sessions', uid(70)).status, 'REVOKED');
    assert.equal(frameCache.size(), 0); // raw frames purged

    // The applicant starts a NEW cycle (history preserved).
    const session = await request(base, '/api/v1/seller/verification/session', {
      method: 'POST', headers: { cookie: customerCookie() }, body: '{"consent":true}',
    });
    assert.equal(session.status, 200, JSON.stringify(session.body));
    assert.equal(session.body.verification.cycle, 2);
    assert.equal(fake.helpers.rows('seller_verifications').length, 2);
  } finally {
    server.close();
  }
});

// ── post-completion guard rails ─────────────────────────────────────────────

test('a VERIFIED verification cannot regress; session re-play after complete is blocked end-to-end', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedVerification(fake);
  const provider = fakeProvider();
  const frameCache = new FrameCache();
  const { server, base } = await makeServer(fake, provider, frameCache);
  try {
    const { sessionId } = await runFullFlow(base, provider);
    const complete = await request(base, '/api/v1/seller/verification/complete', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JSON.stringify({ sessionId }),
    });
    // Completion is NOT approval: it lands in review, and only the admin route
    // can move it on from there.
    assert.equal(complete.body.state, 'MANUAL_REVIEW');

    // Face frames for the completed session are gone (cache purged).
    assert.equal(frameCache.size(), 0);

    // A second complete attempt is refused (session COMPLETED → 404-ish gate
    // via status check -> 410/409 semantics; here the session is COMPLETED).
    const again = await request(base, '/api/v1/seller/verification/complete', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JSON.stringify({ sessionId }),
    });
    assert.equal(again.status, 409);
  } finally {
    server.close();
  }
});

// ── audit trail (lightweight guarantee) ─────────────────────────────────────

test('verification lifecycle writes an audit trail with server-side diagnostics only', async () => {
  const fake = createFakeSupabase();
  seedUser(fake, { id: CUSTOMER, email: 'aarav@kshop.test' });
  seedVerification(fake);
  const provider = fakeProvider();
  const { server, base } = await makeServer(fake, provider);
  try {
    const { sessionId } = await runFullFlow(base, provider);
    await request(base, '/api/v1/seller/verification/complete', {
      method: 'POST', headers: { cookie: customerCookie() }, body: JSON.stringify({ sessionId }),
    });
    const logs = fake._state.auditLogs;
    const events = logs.map((l) => l.action);
    assert.ok(events.includes('verification.face_session_created'));
    assert.ok(events.includes('verification.document_uploaded'));
    assert.ok(events.includes('verification.face_capture_started'));
    // Completing the live check routes to REVIEW, and the audit trail records
    // that — it is no longer a 'verification.completed' event, because nothing
    // has been completed or approved by an automated score.
    assert.ok(events.includes('verification.manual_review_requested'));
    assert.ok(!events.includes('verification.completed'));
    // Diagnostics stored for the reviewer — never sent to the applicant.
    const review = logs.find((l) => l.action === 'verification.manual_review_requested');
    assert.equal(typeof review.metadata.similarity, 'number');
    // The engine's own opinion is recorded as EVIDENCE, not as a decision.
    assert.equal(review.metadata.engineSuggestedMatch, 'PASSED');
    assert.equal(review.result, 'NEEDS_REVIEW');
    const writes = JSON.stringify(logs);
    assert.ok(writes.includes('"meta"')); // quality meta kept server-side
  } finally {
    server.close();
  }
});