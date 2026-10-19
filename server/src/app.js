/**
 * Express app factory — dependency-injected so tests can pass a FAKE
 * Supabase client (no network/keys needed) while production passes the real
 * one. All security middleware is applied here, in the correct order.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { corsMiddleware, originCheck, globalLimiter } from './middleware/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findDistPath() {
  const candidates = [
    path.resolve(__dirname, '../../dist'),
    path.resolve(process.cwd(), 'dist'),
    path.resolve(process.cwd(), '../dist'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'index.html'))) {
      return p;
    }
  }
  return null;
}
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
import { publicImageUrls } from './lib/productShape.js';
import compression from 'compression';
import { notFoundHandler, createErrorHandler } from './lib/errors.js';
import { recordIncident } from './lib/alerting.js';

export function createApp({ env, supabase, verification = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway / proxy fronting — req.ip is the real client

  // High-performance gzip/brotli compression for API payloads and static assets
  app.use(compression());

  // Face-verification provider + in-memory frame cache are created once per
  // process (lazy ML engine load). Tests inject deterministic replacements.
  const faceContext = verification ?? {
    faceVerification: createFaceVerificationProvider({ env }),
    frameCache: createFrameCache(),
  };

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "*.supabase.co"],
        connectSrc: ["'self'", "https:", "*.supabase.co", "wss:"],
        mediaSrc: ["'self'", "blob:", "data:"],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }));

  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(self)');
    next();
  });
  app.use(cookieParser(env.SESSION_SECRET));
  app.use(express.json({ limit: '10mb' }));
  app.use(corsMiddleware(env)); // allowlist + credentials
  app.use(originCheck(env)); // CSRF defence #2 (SameSite=Lax is #1)
  app.use(globalLimiter()); // per-IP safety net

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'kshop-backend', time: new Date().toISOString() });
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

  // ── Technical SEO: Dynamic XML Sitemap ────────────────────────────────────
  app.get('/sitemap.xml', async (_req, res) => {
    try {
      const baseUrl = 'https://kn-ecommerce-production.up.railway.app';
      const dbClient = supabase?.service || supabase;
      let products = [];
      if (dbClient && typeof dbClient.from === 'function') {
        const { data } = await dbClient
          .from('products')
          .select('id, updated_at, created_at')
          .eq('status', 'APPROVED');
        products = data || [];
      }

      const now = new Date().toISOString().split('T')[0];
      const staticPages = [
        { loc: '/', priority: '1.0', changefreq: 'daily' },
        { loc: '/products', priority: '0.9', changefreq: 'daily' },
        { loc: '/faq', priority: '0.8', changefreq: 'weekly' },
        { loc: '/contact', priority: '0.7', changefreq: 'monthly' },
        { loc: '/support', priority: '0.6', changefreq: 'monthly' },
        { loc: '/privacy-policy', priority: '0.5', changefreq: 'monthly' },
        { loc: '/terms-of-service', priority: '0.5', changefreq: 'monthly' },
      ];

      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

      for (const p of staticPages) {
        xml += '  <url>\n';
        xml += `    <loc>${baseUrl}${p.loc}</loc>\n`;
        xml += `    <lastmod>${now}</lastmod>\n`;
        xml += `    <changefreq>${p.changefreq}</changefreq>\n`;
        xml += `    <priority>${p.priority}</priority>\n`;
        xml += '  </url>\n';
      }

      for (const prod of products) {
        const lastmod = (prod.updated_at || prod.created_at || now).split('T')[0];
        xml += '  <url>\n';
        xml += `    <loc>${baseUrl}/products/${prod.id}</loc>\n`;
        xml += `    <lastmod>${lastmod}</lastmod>\n`;
        xml += '    <changefreq>weekly</changefreq>\n';
        xml += '    <priority>0.8</priority>\n';
        xml += '  </url>\n';
      }

      xml += '</urlset>';

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      return res.send(xml);
    } catch {
      return res.status(500).send('Unable to generate sitemap.');
    }
  });

  const distDir = findDistPath();
  if (distDir) {
    const indexHtmlPath = path.join(distDir, 'index.html');
    let indexHtmlTemplate = '';
    try {
      indexHtmlTemplate = fs.readFileSync(indexHtmlPath, 'utf8');
    } catch {
      indexHtmlTemplate = '';
    }

    const lcpImageCache = new Map();
    const MAX_LCP_CACHE = 500;
    const LCP_CACHE_TTL_MS = 10 * 60 * 1000;

    app.use(express.static(distDir, {
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (
          filePath.includes('/assets/') ||
          filePath.includes('\\assets\\') ||
          /\.(webp|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|wasm)$/i.test(filePath)
        ) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));

    // Handle stale or missing assets under /assets/
    app.use('/assets', (req, res) => {
      // If browser requested an older index-*.css hash that was purged in a new deploy,
      // serve the active index-*.css so layout never un-styles and MIME type is valid text/css.
      const assetFile = req.path.replace(/^\//, '');
      if (/^index-.*\.css$/i.test(assetFile)) {
        try {
          const files = fs.readdirSync(path.join(distDir, 'assets'));
          const activeCss = files.find((f) => /^index-.*\.css$/i.test(f));
          if (activeCss) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.sendFile(path.join(distDir, 'assets', activeCss));
          }
        } catch {}
      }

      // Strict MIME compliance: never allow missing CSS/JS to return application/json
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      if (req.path.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        return res.status(404).send('/* CSS asset not found */');
      }
      if (req.path.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        return res.status(404).send('/* JS asset not found */');
      }
      return res.status(404).type('text/plain').send('Asset not found');
    });

    app.use(async (req, res, next) => {
      if (req.method !== 'GET') return next();
      if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/health') ||
        req.path.startsWith('/assets') ||
        /\.[a-zA-Z0-9]+$/.test(req.path)
      ) {
        return next();
      }

      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      const baseLinkHeader = '<https://fonts.googleapis.com>; rel=preconnect, <https://fonts.gstatic.com>; rel=preconnect; crossorigin, <https://dzyckrjvwbhfmgrxbjuk.supabase.co>; rel=preconnect; crossorigin';

      // Dynamic LCP image discovery for /products/:id
      const productMatch = req.path.match(/^\/products\/([0-9a-fA-F-]{36})$/);
      const dbClient = supabase?.service || supabase;
      if (productMatch && dbClient && typeof dbClient.from === 'function') {
        const productId = productMatch[1];
        let cached = lcpImageCache.get(productId);
        const now = Date.now();

        if (!cached || cached.expiresAt < now) {
          try {
            const { data } = await dbClient
              .from('products')
              .select(`
                id, verification_meta,
                images:product_images(storage_bucket, storage_path, position, is_primary)
              `)
              .eq('id', productId)
              .maybeSingle();

            if (data) {
              const imageBase = env?.SUPABASE_URL || 'https://dzyckrjvwbhfmgrxbjuk.supabase.co';
              const urls = publicImageUrls(data, imageBase);
              const rawImg = urls[0];

              if (rawImg) {
                let optUrl = rawImg;
                let opt400 = rawImg;
                let opt1200 = rawImg;
                if (typeof rawImg === 'string' && rawImg.includes('/storage/v1/object/public/')) {
                  const base = rawImg.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
                  const sep = base.includes('?') ? '&' : '?';
                  optUrl = `${base}${sep}width=800&quality=80`;
                  opt400 = `${base}${sep}width=400&quality=80`;
                  opt1200 = `${base}${sep}width=1200&quality=85`;
                }
                const srcSet = `${opt400} 400w, ${optUrl} 800w, ${opt1200} 1200w`;
                const preloadTag = `<link rel="preload" as="image" href="${optUrl}" imagesrcset="${srcSet}" imagesizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 600px" fetchpriority="high" />`;
                cached = {
                  preloadTag,
                  imgUrl: optUrl,
                  expiresAt: now + LCP_CACHE_TTL_MS,
                };
                if (lcpImageCache.size >= MAX_LCP_CACHE) {
                  const firstKey = lcpImageCache.keys().next().value;
                  if (firstKey) lcpImageCache.delete(firstKey);
                }
                lcpImageCache.set(productId, cached);
              }
            }
          } catch {
            // Graceful fallback to default index.html
          }
        }

        if (cached?.preloadTag && indexHtmlTemplate) {
          res.setHeader('Link', `<${cached.imgUrl}>; rel=preload; as=image; fetchpriority=high`);
          const html = indexHtmlTemplate.replace('<!-- LCP_PRELOAD_SLOT -->', cached.preloadTag);
          return res.type('html').send(html);
        }
      }

      return res.sendFile(indexHtmlPath);
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({ ok: true, service: 'kshop-backend', health: '/health' });
    });
  }

  app.use(notFoundHandler);
  app.use(createErrorHandler({ env }));
  return app;
}