# ROUTE_MAP.md — Frontend ↔ Backend Route Audit

> Empirically verified against the **live backend on :3001** (admin session,
> real Supabase) on 2026-09-25. `✅ 200` = probed live, responds correctly.
> `❌ 404` = probed live, backend returns `{ error: { message: 'Not found.' } }`
> (the exact error seen in the browser). `🔎 code` = verified from source but
> not re-probed this pass.
>
> **Root cause of your `Not found.` (original diagnosis, 2026-09-25 morning):**
> the frontend called several endpoints the backend had not implemented yet
> (seller analytics/CRUD, refunds, transactions, announcements, order
> creation/cancellation), and any page using one got the 404 JSON.
>
> **⚠️ Status update (same day, later pass):** those route groups are now
> **implemented** in `server/src/routes/*` (orders create/cancel, seller
> products CRUD + seller console, refunds, transactions, announcements,
> uploads) plus the new **seller identity + face verification** routes. The
> whole server suite is green (`npm test` — **122/122** incl. the pg-harness
> schema/RLS checks). §1–§6 below are the *original* live-probe record; **§7 is
> the current inventory** and supersedes the gap analysis.

---

## 1. Live probe results (admin session, real DB)

| Method | Path | Live | Notes |
|---|---|---|---|
| POST | `/api/v1/admin/auth/login` | ✅ 200 | Real Supabase password check + ADMIN role gate |
| GET | `/api/v1/admin/stats` | ✅ 200 | Server-aggregated metrics |
| GET | `/api/v1/admin/customers?perPage=3` | ✅ 200 | Shows `KNCR-5612` → **0004 is live (4-digit ids)** |
| GET | `/api/v1/admin/sellers?perPage=3` | ✅ 200 | `seller_profiles` table is queryable |
| GET | `/api/v1/admin/products?perPage=3` | ✅ 200 | |
| GET | `/api/v1/products` | ✅ 200 | Public catalog (empty = honest) |
| GET | `/api/v1/products/categories` | ✅ 200 | |
| GET | `/api/v1/orders` | ✅ 200 | `{ orders: [] }` |
| GET | `/api/v1/auth/session` | ✅ 200 | `{"user":null}` when signed out |
| GET | `/api/v1/admin/announcements` | ❌ 404 | **Not implemented** |
| GET | `/api/v1/seller/metrics` | ❌ 404 | **Not implemented** |
| GET | `/api/v1/seller/inventory` | ❌ 404 | **Not implemented** |
| GET | `/api/v1/seller/settlements` | ❌ 404 | **Not implemented** |
| GET | `/api/v1/seller/products` | ❌ 404 | **Not implemented** |
| GET | `/api/v1/refunds` | ❌ 404 | **Not implemented** |
| GET | `/api/v1/transactions` | ❌ 404 | **Not implemented** |
| GET | `/api/v1/announcements` | ❌ 404 | **Not implemented** |
| POST | `/api/v1/orders` | ❌ 404 | **Not implemented** (COD placement) |

## 2. Backend endpoint inventory (code-verified, `server/src/routes/*`)

All mounted under `/api/v1` in `app.js` (order: auth → adminAuth → admin →
orders → products → profiles → sellerProducts → **sellerVerification →
adminVerification** → uploads → seller → refunds → transactions →
announcements), plus `/health`. The verification routers are mounted **before**
`createSellerRouter`, whose `/seller` gate would otherwise swallow
`seller/verification/*` paths.

| Endpoint | Router file | Auth / gate | Live |
|---|---|---|---|
| `POST /auth/otp/send` | auth.js | rate-limited (public) | 🔎 code |
| `POST /auth/otp/verify` | auth.js | rate-limited (public) | 🔎 code |
| `GET /auth/session` | auth.js | cookie re-validation | ✅ 200 |
| `POST /auth/logout` | auth.js | cookie clear + revoke | 🔎 code |
| `POST /auth/pin/setup` | auth.js | `requireAuth` + limiter + admin-gate | 🔎 code |
| `POST /auth/pin/verify` | auth.js | `requireAuth` + limiter + lockout | 🔎 code |
| `POST /auth/pin/change` | auth.js | `requireAuth` + limiter | 🔎 code |
| `POST /auth/pin/forgot` | auth.js | limiter (anti-enumeration) | 🔎 code |
| `POST /auth/pin/reset` | auth.js | limiter (5 attempts) | 🔎 code |
| `POST /admin/auth/login` | adminAuth.js | limiter + ADMIN gate | ✅ 200 |
| `GET /admin/stats` | admin.js | `requireAdmin` | ✅ 200 |
| `GET /admin/customers` | admin.js | `requireAdmin` (+`q` search) | ✅ 200 |
| `POST /admin/customers/:id/toggle-status` | admin.js | `requireAdmin` | 🔎 code |
| `GET /admin/sellers` | admin.js | `requireAdmin` | ✅ 200 |
| `POST /admin/sellers/:id/review` | admin.js | `requireAdmin` (APPROVE/REJECT) | 🔎 code |
| `GET /admin/products` | admin.js | `requireAdmin` | ✅ 200 |
| `GET /orders` | orders.js | `requireAuth`, scope: OWN | ✅ 200 |
| `GET /orders/:id` | orders.js | `requireAuth`, ownership (404) | 🔎 code |
| `PATCH /orders/:id/status` | orders.js | `requireAuth` + seller/admin + terminal check | 🔎 code |
| `GET /products/categories` | products.js | public (approved/gated) | ✅ 200 |
| `GET /products` | products.js | public (approved/gated) | ✅ 200 |
| `GET /products/:id` | products.js | public (approved/gated) | 🔎 code |
| `POST /auth/profile` | profiles.js | `requireAuth` + validateOnboarding | 🔎 code |
| `PUT /auth/profile` | profiles.js | `requireAuth` | 🔎 code |
| `POST /seller/applications` | profiles.js | `requireAuth` + limiter + terms gate | 🔎 code |
| `POST /orders` | orders.js | `requireAuth` + server stock/price/total checks | ✅ tests |
| `POST /orders/:id/cancel` | orders.js | `requireAuth` + ownership + state checks | ✅ tests |
| `GET /seller/products` | sellerProducts.js | `requireAuth` + seller gate + ownership | ✅ tests |
| `POST /seller/products` | sellerProducts.js | `requireAuth` + seller gate | ✅ tests |
| `PUT /seller/products/:id` | sellerProducts.js | `requireAuth` + ownership | ✅ tests |
| `DELETE /seller/products/:id` | sellerProducts.js | `requireAuth` + ownership | ✅ tests |
| `GET /seller/metrics` | seller.js | seller gate | ✅ tests |
| `GET /seller/revenue-chart` | seller.js | seller gate | ✅ tests |
| `GET /seller/inventory` | seller.js | seller gate | ✅ tests |
| `PUT /seller/inventory/:id` | seller.js | seller gate + stock rules | ✅ tests |
| `GET /seller/settlements` | seller.js | seller gate | ✅ tests |
| `POST /seller/settlements/payout` | seller.js | seller gate + balance rules | ✅ tests |
| `POST /seller/documents` | uploads.js | `requireAuth` + seller gate + raw parser | ✅ tests |
| `POST /seller/product-images` | uploads.js | `requireAuth` + seller gate | ✅ tests |
| `GET /refunds` | refunds.js | `requireAuth` (scoped) | ✅ tests |
| `GET /refunds/:id` | refunds.js | `requireAuth` + ownership | ✅ tests |
| `POST /refunds` | refunds.js | `requireAuth` + order ownership + rules | ✅ tests |
| `PATCH /refunds/:id/status` | refunds.js | seller/admin gates | ✅ tests |
| `GET /transactions` | transactions.js | `requireAuth` (scoped) | ✅ tests |
| `GET /announcements` | announcements.js | public (visibility gate) | ✅ tests |
| `POST /admin/announcements` | announcements.js | admin gate | ✅ tests |
| `PUT /admin/announcements/:id` | announcements.js | admin gate | ✅ tests |
| `DELETE /admin/announcements/:id` | announcements.js | admin gate | ✅ tests |
| `POST /seller/verification/session` | sellerVerification.js | `requireAuth` + limiter + consent + provider gate | ✅ tests (20 in verification.test.mjs) |
| `POST /seller/verification/document` | sellerVerification.js | `requireAuth` + raw parser (jpeg/png only) | ✅ tests |
| `POST /seller/verification/face` | sellerVerification.js | `requireAuth` + session ownership + step + limiter | ✅ tests |
| `POST /seller/verification/complete` | sellerVerification.js | `requireAuth` + session ownership | ✅ tests |
| `GET /seller/verification/status` | sellerVerification.js | `requireAuth` | ✅ tests |
| `GET /admin/seller-verifications` | adminVerification.js | `requireAdmin` (+ email join) | ✅ tests |
| `GET /admin/seller-verifications/:id/document` | adminVerification.js | `requireAdmin`; short-lived signed URL (15 min) for the private ID doc | ✅ tests |
| `POST /admin/seller-verifications/:id/approve` | adminVerification.js | `requireAdmin` + score/match CHECK | ✅ tests |
| `POST /admin/seller-verifications/:id/reject` | adminVerification.js | `requireAdmin` | ✅ tests |
| `POST /admin/seller-verifications/:id/request-reverification` | adminVerification.js | `requireAdmin` | ✅ tests |
| `GET /health` | app.js | public | ✅ (code) |

## 3. Frontend service → backend mapping (`src/services/*`)

| Service method | Frontend path called | Backend | Status |
|---|---|---|---|
| `authService.requestOtp` | `POST /auth/otp/send` | 🔎 | ✅ |
| `authService.verifyOtp` | `POST /auth/otp/verify` | 🔎 | ✅ |
| `authService.setupPin` | `POST /auth/pin/setup` | 🔎 | ✅ |
| `authService.verifyPin` | `POST /auth/pin/verify` | 🔎 | ✅ |
| `authService.changePin` | `POST /auth/pin/change` | 🔎 | ✅ |
| `authService.forgotPin` | `POST /auth/pin/forgot` | 🔎 | ✅ |
| `authService.resetPin` | `POST /auth/pin/reset` | 🔎 | ✅ |
| `authService.completeProfile` | `POST /auth/profile` | 🔎 | ✅ |
| `authService.updateProfile` | `PUT /auth/profile` | 🔎 | ✅ |
| `authService.adminLogin` | `POST /admin/auth/login` | ✅ | ✅ |
| `authService.getSession` | `GET /auth/session` | ✅ | ✅ |
| `authService.logout` | `POST /auth/logout` | 🔎 | ✅ |
| `authService.applyAsSeller` | `POST /seller/applications` | 🔎 | ✅ |
| `verificationService.startSession` | `POST /seller/verification/session` | ✅ tests | ✅ |
| `verificationService.uploadDocument` | `POST /seller/verification/document?type=` | ✅ tests | ✅ |
| `verificationService.sendFrame` | `POST /seller/verification/face?sessionId&step&final` | ✅ tests | ✅ |
| `verificationService.complete` | `POST /seller/verification/complete` | ✅ tests | ✅ |
| `verificationService.getStatus` | `GET /seller/verification/status` | ✅ tests | ✅ |
| `adminVerificationService.list` | `GET /admin/seller-verifications` | ✅ tests | ✅ |
| `adminVerificationService.getDocumentUrl` | `GET /admin/seller-verifications/:id/document` | ✅ tests | ✅ |
| `adminVerificationService.approve` | `POST /admin/seller-verifications/:id/approve` | ✅ tests | ✅ |
| `adminVerificationService.reject` | `POST /admin/seller-verifications/:id/reject` | ✅ tests | ✅ |
| `adminVerificationService.requestReverification` | `POST /admin/seller-verifications/:id/request-reverification` | ✅ tests | ✅ |
| `adminService.getMetrics` | `GET /admin/stats` | ✅ | ✅ |
| `adminService.getCustomers` | `GET /admin/customers` | ✅ | ✅ |
| `adminService.toggleCustomerStatus` | `POST /admin/customers/:id/toggle-status` | 🔎 | ✅ |
| `adminService.getSellers` | `GET /admin/sellers` | ✅ | ✅ |
| `adminService.reviewSellerApplication` | `POST /admin/sellers/:id/review` | 🔎 | ✅ |
| `adminService.getProducts` | `GET /admin/products` | ✅ | ✅ |
| `orderService.getOrders` | `GET /orders` | ✅ | ✅ |
| `orderService.getOrder` | `GET /orders/:id` | 🔎 | ✅ |
| `orderService.createOrder` | `POST /orders` | ❌ | **404** |
| `orderService.cancelOrder` | `POST /orders/:id/cancel` | ❌ | **404** |
| `orderService.updateStatus` | `PATCH /orders/:id/status` | 🔎 | ✅ |
| `productService.getProducts` | `GET /products` | ✅ | ✅ |
| `productService.getProduct` | `GET /products/:id` | 🔎 | ✅ |
| `productService.getCategories` | `GET /products/categories` | ✅ | ✅ |
| `productService.createProduct` | `POST /seller/products` | ❌ | **404** |
| `productService.updateProduct` | `PATCH /seller/products/:id` | ❌ | **404** |
| `productService.deleteProduct` | `DELETE /seller/products/:id` | ❌ | **404** |
| `sellerService.getMetrics` | `GET /seller/metrics` | ❌ | **404** |
| `sellerService.getRevenueChart` | `GET /seller/revenue-chart` | ❌ | **404** |
| `sellerService.getInventory` | `GET /seller/inventory` | ❌ | **404** |
| `sellerService.updateInventoryItem` | `PATCH /seller/inventory/:id` | ❌ | **404** |
| `sellerService.getSettlements` | `GET /seller/settlements` | ❌ | **404** |
| `sellerService.requestPayout` | `POST /seller/settlements/payout` | ❌ | **404** |
| `refundService.*` | `GET/POST /refunds`, `GET/POST /refunds/:id/*` | ❌ | **404** |
| `transactionService.getTransactions` | `GET /transactions` | ❌ | **404** |
| `announcementService.*` | `GET /announcements`, `/admin/announcements` | ❌ | **404** |

## 4. ~~Gap analysis~~ → **superseded — see §7**

> The "13 missing endpoints" listed in the original version of this section are
> all implemented now (order creation/cancellation, `/seller/products` CRUD,
> seller console metrics/inventory/settlements/payout, refunds, transactions,
> announcements — see §2 and §7). The `seller_profiles` table already carries
> the OCR columns (`id_document_path`, `id_document_mime`, `id_document_bytes`,
> `id_ocr_status`, `id_ocr_meta`) and `business_type` (0001), which the
> identity-verification flow builds on.

## 5. ~~What to do about it~~ → **current state**

- Nothing in the old §5 remains outstanding: the seller hub, refunds,
  transactions, announcements and checkout route groups exist and are covered
  by green suites (`orders-create`, `refunds-transactions-announcements`,
  `seller-console`, `verification` test files).
- The only live-side action still required is applying the two new migrations
  in the Supabase dashboard (**0005** `seller_verifications` +
  `verification_sessions`, **0006** state-machine trigger + RLS) and restarting
  the backend, after which the KYC flow runs end to end (see §7).
- **Do NOT re-run 0001/0002/0003** — all three are already applied live (the
  "already exists" errors you saw prove it). 0004 is confirmed live via
  `KNCR-5612`.

---

## 6. Complete live sweep — every known endpoint (2026-09-25)

All 43 calls made against `http://localhost:3001` with a real ADMIN session
(real Supabase DB). Verdicts: ✅ = route exists and executes (a 4xx here is a
correct validation/auth response, proving the handler runs); ❌ = route does
**not** exist (catch-all `Not found.` — the error you saw in the browser).

| # | Method | Path | Live | Verdict |
|---|---|---|---|---|
| 1 | POST | `/api/v1/admin/auth/login` | 200 | ✅ Active |
| 2 | POST | `/api/v1/auth/otp/send` | 400 (validation) | ✅ Active |
| 3 | POST | `/api/v1/auth/otp/verify` | 400 (validation) | ✅ Active |
| 4 | GET | `/api/v1/auth/session` | 200 | ✅ Active |
| 5 | POST | `/api/v1/auth/logout` | 200 | ✅ Active |
| 6 | POST | `/api/v1/auth/pin/setup` | 403 (admin gate) | ✅ Active |
| 7 | POST | `/api/v1/auth/pin/verify` | 403 (admin gate) | ✅ Active |
| 8 | POST | `/api/v1/auth/pin/change` | 400 (no PIN set) | ✅ Active |
| 9 | POST | `/api/v1/auth/pin/forgot` | 400 (validation) | ✅ Active |
| 10 | POST | `/api/v1/auth/pin/reset` | 400 (validation) | ✅ Active |
| 11 | POST | `/api/v1/auth/profile` | 400 (validation) | ✅ Active |
| 12 | PUT | `/api/v1/auth/profile` | 400 (validation) | ✅ Active |
| 13 | POST | `/api/v1/seller/applications` | 400 (profile first) | ✅ Active |
| 14 | GET | `/api/v1/admin/stats` | 200 | ✅ Active |
| 15 | GET | `/api/v1/admin/customers` | 200 | ✅ Active |
| 16 | POST | `/api/v1/admin/customers/:id/toggle-status` | 404 (no such customer) | ✅ Active |
| 17 | GET | `/api/v1/admin/sellers` | 200 | ✅ Active |
| 18 | POST | `/api/v1/admin/sellers/:id/review` | 404 (no such seller) | ✅ Active |
| 19 | GET | `/api/v1/admin/products` | 200 | ✅ Active |
| 20 | GET | `/api/v1/orders` | 200 | ✅ Active |
| 21 | GET | `/api/v1/orders/:id` | 404 (no such order) | ✅ Active |
| 22 | PATCH | `/api/v1/orders/:id/status` | 404 (no such order) | ✅ Active |
| 23 | GET | `/api/v1/products` | 200 | ✅ Active |
| 24 | GET | `/api/v1/products/categories` | 200 | ✅ Active |
| 25 | GET | `/api/v1/products/:id` | 404 (no such product) | ✅ Active |
| 26 | GET | `/health` | 200 | ✅ Active |
| 27 | POST | `/api/v1/orders` | 404 catch-all | ❌ Not built |
| 28 | POST | `/api/v1/orders/:id/cancel` | 404 catch-all | ❌ Not built |
| 29 | POST | `/api/v1/seller/products` | 404 catch-all | ❌ Not built |
| 30 | PATCH | `/api/v1/seller/products/:id` | 404 catch-all | ❌ Not built |
| 31 | DELETE | `/api/v1/seller/products/:id` | 404 catch-all | ❌ Not built |
| 32 | GET | `/api/v1/seller/metrics` | 404 catch-all | ❌ Not built |
| 33 | GET | `/api/v1/seller/revenue-chart` | 404 catch-all | ❌ Not built |
| 34 | GET | `/api/v1/seller/inventory` | 404 catch-all | ❌ Not built |
| 35 | PATCH | `/api/v1/seller/inventory/:id` | 404 catch-all | ❌ Not built |
| 36 | GET | `/api/v1/seller/settlements` | 404 catch-all | ❌ Not built |
| 37 | POST | `/api/v1/seller/settlements/payout` | 404 catch-all | ❌ Not built |
| 38 | GET | `/api/v1/refunds` | 404 catch-all | ❌ Not built |
| 39 | POST | `/api/v1/refunds` | 404 catch-all | ❌ Not built |
| 40 | GET | `/api/v1/refunds/:id` | 404 catch-all | ❌ Not built |
| 41 | GET | `/api/v1/transactions` | 404 catch-all | ❌ Not built |
| 42 | GET | `/api/v1/announcements` | 404 catch-all | ❌ Not built |
| 43 | POST | `/api/v1/admin/announcements` | 404 catch-all | ❌ Not built |

**26 routes active ✅ · 17 routes not built ❌.** The 17 missing ones are exactly
the surfaces the app is planned for but the backend has not shipped yet —
mapped to spec phases in §4 above. None of the `Not found.` errors indicate a
broken/misconfigured server; every error is an honest "this endpoint does not
exist yet" (AGENTS.md §2.13 — no fake data, no silent fallback).

> ⚠️ This sweep is the **original** record. All 17 "not built" routes are
> implemented in the current tree and covered by green test suites — see §7.

---

## 7. Current inventory (post implementation sweep, 2026-09-25)

Supersedes §1/§4/§5/§6. Status of every route group **in the current code**,
verified by the automated suites in `server/tests/` (`npm test` = 122/122
green). `🔎 tests` = covered by a green test file; the pg-harness also asserts
schema + RLS for the migrations.

| # | Method | Path | Gate / notes | Status |
|---|---|---|---|---|
| 1 | POST | `/auth/otp/send` | rate-limited public | 🔎 tests |
| 2 | POST | `/auth/otp/verify` | rate-limited public | 🔎 tests |
| 3 | GET | `/auth/session` | cookie re-validation | ✅ live |
| 4 | POST | `/auth/logout` | cookie clear + revoke | 🔎 tests |
| 5 | POST | `/auth/pin/setup` | `requireAuth` + limiter + admin gate | 🔎 tests |
| 6 | POST | `/auth/pin/verify` | `requireAuth` + limiter + lockout | 🔎 tests |
| 7 | POST | `/auth/pin/change` | `requireAuth` + limiter | 🔎 tests |
| 8 | POST | `/auth/pin/forgot` | anti-enumeration limiter | 🔎 tests |
| 9 | POST | `/auth/pin/reset` | limiter (5 attempts) | 🔎 tests |
| 10 | POST | `/admin/auth/login` | limiter + ADMIN gate | ✅ live |
| 11 | GET | `/admin/stats` | `requireAdmin` | ✅ live |
| 12 | GET/POST | `/admin/customers…` | `requireAdmin` | 🔎 tests |
| 13 | GET/POST | `/admin/sellers…` | `requireAdmin` | 🔎 tests |
| 14 | GET | `/admin/products` | `requireAdmin` | ✅ live |
| 15 | GET | `/orders` | `requireAuth` OWN scope | ✅ live |
| 16 | GET | `/orders/:id` | `requireAuth` + ownership (404) | 🔎 tests |
| 17 | POST | `/orders` | COD creation, server price/stock/total | 🔎 tests |
| 18 | POST | `/orders/:id/cancel` | `requireAuth` + ownership + state | 🔎 tests |
| 19 | PATCH | `/orders/:id/status` | seller/admin + terminal check | 🔎 tests |
| 20 | GET | `/products` | public (approved/gated) | ✅ live |
| 21 | GET | `/products/categories` | public | ✅ live |
| 22 | GET | `/products/:id` | public | 🔎 tests |
| 23 | GET/POST | `/seller/products…` | `requireAuth` + seller gate + ownership | 🔎 tests |
| 24 | GET/PUT | `/seller/inventory…` | seller gate + stock rules | 🔎 tests |
| 25 | GET | `/seller/metrics` | seller gate | 🔎 tests |
| 26 | GET | `/seller/revenue-chart` | seller gate | 🔎 tests |
| 27 | GET | `/seller/settlements` | seller gate | 🔎 tests |
| 28 | POST | `/seller/settlements/payout` | seller gate + balance rules | 🔎 tests |
| 29 | GET | `/refunds`, `/refunds/:id` | `requireAuth` + ownership | 🔎 tests |
| 30 | POST | `/refunds` | `requireAuth` + order ownership + rules | 🔎 tests |
| 31 | PATCH | `/refunds/:id/status` | seller/admin gates | 🔎 tests |
| 32 | GET | `/transactions` | `requireAuth` (scoped) | 🔎 tests |
| 33 | GET | `/announcements` | public (visibility gate) | 🔎 tests |
| 34 | POST/PUT/DELETE | `/admin/announcements…` | admin gate | 🔎 tests |
| 35 | POST | `/seller/documents` | `requireAuth` + seller gate + raw parser | 🔎 tests |
| 36 | POST | `/seller/product-images` | `requireAuth` + seller gate | 🔎 tests |

### 7.1 Seller identity + face verification (KYC) — *this build*

Backend: `sellerVerification.js` + `adminVerification.js` +
`lib/verification/{states,db,frames,constants}.js` +
`lib/faceVerification/{index,engine}.js` (@vladmandic/human 3.3.6, CPU).
Covered by **`tests/verification.test.mjs` — 20/20 green** (DI fake provider, no
env test-mode). Frontend: `verificationService.ts` +
`pages/customer/SellerVerificationPage.tsx` (18 honest screens) at
`/become-seller/verify`, linked from `BecomeSellerPage` after applying.

| # | Method | Path | Gate / notes | Status |
|---|---|---|---|---|
| 37 | POST | `/seller/verification/session` | `requireAuth` + limiter; consent; provider gate | ✅ 20/20 tests |
| 38 | POST | `/seller/verification/document?type=` | `requireAuth`; raw bytes; jpeg/png only (PDF → 400); private bucket; stored then re-downloaded for compare | ✅ tests |
| 39 | POST | `/seller/verification/face?sessionId&step&final` | `requireAuth`; session ownership; per-frame full-pipeline analysis; in-memory TTL FrameCache; per-step burst finalisation + liveness | ✅ tests |
| 40 | POST | `/seller/verification/complete` | `requireAuth`; ownership; compare vs stored ID → VERIFIED / MANUAL_REVIEW / REJECTED | ✅ tests |
| 41 | GET | `/seller/verification/status` | `requireAuth`; no scores/status in the response | ✅ tests |
| 42 | GET | `/admin/seller-verifications` | `requireAdmin` + customer email join; includes best-effort short-lived `documentUrl` (signed, 15 min) for the private ID doc | ✅ tests |
| 43 | GET | `/admin/seller-verifications/:id/document` | `requireAdmin`; fresh signed URL for the reviewer; 404 when no doc | ✅ tests |
| 44 | POST | `/admin/seller-verifications/:id/approve` | `requireAdmin`; requires real `verification_score` + `match_status` (DB CHECK) else 409 | ✅ tests |
| 45 | POST | `/admin/seller-verifications/:id/reject` | `requireAdmin` | ✅ tests |
| 46 | POST | `/admin/seller-verifications/:id/request-reverification` | `requireAdmin`; revokes sessions, purges frames, opens cycle+1 | ✅ tests |

Key security properties (§2 of AGENTS.md): outcomes decided backend-only —
client-supplied scores/statuses are ignored; `FACE_VERIFICATION_PROVIDER` is
`human` (default) or `disabled` (honest 503), no env test-mode (tests inject a
fake provider through `createApp` DI); the `human` engine is mutex-serialised
with per-call config snapshot/restore; face frames are raw octet-stream,
RAM-only, TTL FrameCache, never logged; audit trail via `audit_logs`; generic
client errors (no internal paths/scores leaked, §21).

**Remaining live step (user-side):** apply `supabase/migrations/0006_seller_verification.sql`
(or the appendix section of `supabase/apply-production.sql`) in the Supabase
dashboard — **0005 is `commerce_refinements` and is unrelated; do NOT apply it
here**. The migration was validated against real PostgreSQL by
`server/tests/pg-harness` (57/57 assertions). Storage buckets
(`product-images`, `seller-documents`, `seller-verification-docs`) are created
idempotently at backend boot (`lib/storage-bootstrap.js`) and in the appendix.
Then restart the backend (`npm run dev` in `server/`); a missing-table warning
is logged at boot if 0006 was not applied yet (clients still get the honest
generic 502 until it is). Errors surfaced in the live run so far were: (1) the
original 0006 had nested same-tag `$$` dollar-quoting → "syntax error at or
near BEGIN" (fixed with distinct `$body$`/`$func$` tags), and (2) the storage
bucket was missing → "Bucket not found" (fixed by boot-time creation).