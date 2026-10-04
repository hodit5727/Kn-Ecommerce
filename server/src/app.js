/**
 * Express app factory — dependency-injected so tests can pass a FAKE
 * Supabase client (no network/keys needed) while production passes the real
 * one. All security middleware is applied here, in the correct order.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { corsMiddleware, originCheck, globalLimiter } from './middleware/security.js';
import { createAuthRouter } from './routes/auth.js';
import { createAdminRouter } from './routes/adminAuth.js';
import { createAdminManagementRouter } from './routes/admin.js';
import { createOrdersRouter } from './routes/orders.js';
import { createProductsRouter } from './routes/products.js';
import { createProfilesRouter } from './routes/profiles.js';
import { createSellerProductsRouter } from './routes/sellerProducts.js';
import { createSellerRouter } from './routes/seller.js';
import { createRefundsRouter } from './routes/refunds.js';
import { createTransactionsRouter } from './routes/transactions.js';
import { createAnnouncementsRouter } from './routes/announcements.js';
import { createUploadsRouter } from './routes/uploads.js';
import { createSellerVerificationRouter } from './routes/sellerVerification.js';
import { createAdminVerificationRouter } from './routes/adminVerification.js';
import { createFaceVerificationProvider } from './lib/faceVerification/index.js';
import { createFrameCache } from './lib/verification/frames.js';
import { notFoundHandler, createErrorHandler } from './lib/errors.js';
import { recordIncident } from './lib/alerting.js';

export function createApp({ env, supabase, verification = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway / proxy fronting — req.ip is the real client

  // Face-verification provider + in-memory frame cache are created once per
  // process (lazy ML engine load). Tests inject deterministic replacements.
  const faceContext = verification ?? {
    faceVerification: createFaceVerificationProvider({ env }),
    frameCache: createFrameCache(),
  };

  app.use(helmet());
  app.use(cookieParser(env.SESSION_SECRET));
  app.use(express.json({ limit: '10mb' }));
  app.use(corsMiddleware(env)); // allowlist + credentials
  app.use(originCheck(env)); // CSRF defence #2 (SameSite=Lax is #1)
  app.use(globalLimiter()); // per-IP safety net

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'kshop-backend', time: new Date().toISOString() });
  });
  // Hitting the process root in a browser is a common local-dev mix-up
  // (the UI is on :5173; this API is on :3001). Name the health path instead
  // of returning a bare "Not found." JSON with no next step.
  app.get('/', (_req, res) => {
    res.json({ ok: true, service: 'kshop-backend', health: '/health' });
  });

  app.use('/api/v1', createAuthRouter({ env, supabase }));
  app.use('/api/v1', createAdminRouter({ env, supabase }));
  app.use('/api/v1', createAdminManagementRouter({ env, supabase }));
  app.use('/api/v1', createOrdersRouter({ env, supabase }));
  app.use('/api/v1', createProductsRouter({ env, supabase }));
  app.use('/api/v1', createProfilesRouter({ env, supabase }));
  app.use('/api/v1', createSellerProductsRouter({ env, supabase }));
  // Verification routers — mounted BEFORE createSellerRouter (whose
  // `router.use('/seller', …)` gate matches any /seller/* path and would
  // otherwise shadow /seller/verification/*). The seller verification router
  // enforces its own auth-only gate; the admin router is role-gated.
  app.use('/api/v1', createAdminVerificationRouter({
    env,
    supabase,
    frameCache: faceContext.frameCache,
  }));
  app.use('/api/v1', createSellerVerificationRouter({
    env,
    supabase,
    faceVerification: faceContext.faceVerification,
    frameCache: faceContext.frameCache,
  }));
  app.use('/api/v1', createUploadsRouter({ env, supabase }));
  // NOTE: mounted BEFORE createSellerRouter — the seller router's
  // `router.use('/seller', …)` gate matches any /seller/* path, which would
  // otherwise shadow POST /seller/documents (identity documents are uploaded
  // by customers mid-application, not only by approved sellers). The upload
  // routes enforce their own gates (auth-only for documents, seller-gate for
  // product images).
  app.use('/api/v1', createSellerRouter({ env, supabase }));
  app.use('/api/v1', createRefundsRouter({ env, supabase }));
  app.use('/api/v1', createTransactionsRouter({ env, supabase }));
  app.use('/api/v1', createAnnouncementsRouter({ env, supabase }));

  // Telemetry endpoint for frontend error reporting
  app.post('/api/v1/telemetry/error', (req, res) => {
    const { name, message, stack } = req.body || {};
    if (message) {
      const clientErr = new Error(String(message));
      clientErr.name = String(name || 'FrontendClientError');
      clientErr.stack = String(stack || '');
      recordIncident({
        env,
        req,
        err: clientErr,
        level: 'error',
        source: 'frontend',
      });
    }
    res.json({ ok: true });
  });

  app.use(notFoundHandler);
  app.use(createErrorHandler({ env }));
  return app;
}