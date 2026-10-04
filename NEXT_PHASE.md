# NEXT_PHASE.md — K-Shop Roadmap (replaces all earlier "next phase" lists)

> Written for the current build state: backend live on `:3001`, admin dashboard
> serving real data, sessions via signed HttpOnly cookies, CSRF + CORS
> allowlist active, and INR-only money display. Items marked ✅ DONE are already
> shipped. Everything else is the plan — nothing here is mock/fake data, and no
> item bypasses the Express backend (AGENTS.md §2).

---

## Phase A — INR-only currency (✅ DONE this round)

- All money now renders through `src/lib/currency.ts` → `formatINR()`:
  `₹` symbol + Indian digit grouping (`₹1,29,999`), never a dollar sign.
- Removed literal `$` / `USD`: admin + seller transactions (`+₹…/−₹…`),
  seller dashboard chart tooltips (Gross/Net), payout toast, checkout
  expedited fee (`+₹150`), and the seller "Selling Price (₹)" label.
- `DollarSign` icons replaced with lucide `IndianRupee`.
- **Follow-up (flagged, not hidden):** the `₹150` expedited fee and any other
  money constants are currently UI-side. Phase H must move fees/rates to a
  server-driven configuration so the frontend never invents amounts.

## Phase B — Compact 4-digit business ids: KNCR-NNNN / KNSR-NNNN (migration ready)

Requirement: patron ids `KNCR-4digit`, and when a customer is promoted to
seller the id switches to `KNSR-4digit` (customer role is kept alongside).

- **Done in code:** new migration [`supabase/migrations/0004_business_id_compact.sql`](./supabase/migrations/0004_business_id_compact.sql)
  — relaxes the CHECK to `^KN(CR|SR)-[0-9]{4}$`, regenerates every existing id
  (trigger disabled during the rewrite), and replaces the identity trigger with
  a 4-digit mint that retries on collision.
- ✅ Verified by `pg-harness` (embedded PostgreSQL applies 0001→0004 and asserts
  `^KN(CR|SR)-[0-9]{4}$` on insert + customer→seller promotion, and that
  client-supplied ids/roles are still ignored).
- **Your action — run in Supabase Dashboard SQL Editor:** open
  `supabase/migrations/0004_business_id_compact.sql` and run the whole file in
  a transaction. This is the KNCR/KNSR format change; existing ids are
  regenerated **once** (e.g. `KNCR-0CFE995A` → `KNCR-0xxx`), then stay stable.
- Admin patrons table already shows the id in the **Customer ID** column and
  the seller review flow shows it via `customerId`.

## Phase C — Seller setup completion (unblocks seller onboarding end-to-end)

- **Pending (your action):** run the Phase-7 ALTER from earlier context in the
  Supabase Dashboard so seller applications stop 502ing —
  `ALTER TABLE seller_profiles ADD COLUMN IF NOT EXISTS business_type text;`
  (plus re-check `customers_have_phone`). Until then seller counts stay honest
  zeros.
- **Next:** finish the seller onboarding UX (`BecomeSellerPage`) against the
  backend contract — store name, category, tax id, bank details, ID-card
  upload (see Phase E for upload rules), and the approval pipeline that the
  admin `seller/review` endpoint already implements (APPROVE pushes `SELLER`
  into `profiles.roles`, which mints the `KNSR-` id via the DB trigger).
- Only APPROVED sellers may list products / act on orders — already enforced
  server-side; re-verify when real sellers exist.

## Phase D — OCR setup for seller document verification

Goal: digitize the ID-card verification step instead of manual admin review of
the scan alone.

1. **Upload endpoint (backend)** — `POST /seller/applications` accepts the ID
   card image; validated by Phase E rules; stored in Supabase Storage access-
   controlled bucket; attachment id recorded on the application.
2. **OCR service** — self-hosted Tesseract (privacy-first) or a cloud OCR
   provider; extract candidate name / DOB / document number + a confidence
   score. No PII ever leaves the backend path except to the configured OCR
   endpoint; keys live in server env, never client code.
3. **Verification rules** — the extracted name must fuzzy-match the profile
   full name and the document number must pass the id-type checksum; low
   confidence / mismatch → stays `PENDING` with a clear reason for admin.
4. **Human-in-the-loop guaranteed** — OCR never auto-approves; it pre-fills
   the admin review card so a person makes the final call (§29–§32 seller
   verification cannot be bypassed server-side).
5. **Audit** — every OCR result and every approval decision lands in
   `audit_logs` and the application row.

## Phase E — Server-side input validation + MIME-type upload validation

**What already exists (server-enforced, not just UX):**
- DB CHECK constraints: 10-digit mobile `^[6-9][0-9]{9}$`, email format,
  full-name length, gender/category/year vocab, price `> 0`, stock `>= 0`,
  order-total math (`subtotal+fee-discount=total`), refund window ≤ Day 7,
  commission ∈ {5,10}, one-time coupon uniqueness, append-only financials.
- Route-level checks in `server/src/routes/*` for the admin/orders/auth
  surfaces incl. role/ownership (IDOR → 404, wrong role → 403).

**To add — request-schema validators per endpoint** (single source of truth,
so §5 error classes 36–40, 43, 49–52, 69–70 stay closed wherever a new route
appears):
- A tiny `validate(body, schema)` helper + shape definitions for every
  mutation: products, cart, orders, refunds, seller application, announcements.
- Length caps, enum whitelists, numeric bounds, and type checks mirrored to the
  DB checks — frontend validation is UX only.

**MIME-type upload validation (new — no upload endpoint exists yet):**
- Allowlist by **magic bytes** (sniffed), not just extension/Content-Type:
  JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), WebP (`RIFF…WEBP`); documents PDF
  (`%PDF`) for ID cards.
- Size caps: product images ≤ 5 MB, ID documents ≤ 2 MB (mirrored by a
  storage rule, not only the HTTP body limit).
- Random storage keys (never client-chosen filenames), private bucket +
  short-lived signed URLs for viewing; EXIF stripping; no SVG/HTML accepted
  (blocks script-in-image XSS – §7 file-upload attack surface).
- Backend rejects anything not matching → 400 with a safe message; silent
  fallbacks are forbidden (AGENTS.md §2.6).

## Phase F — Login page security: JWT + cookies + CSRF (already live; harden next)

**Already shipped and verified:**
- **JWT + cookies:** Supabase-issued access/refresh tokens travel ONLY in
  signed **HttpOnly SameSite=Lax** cookies (`ks_access`/`ks_refresh`) — never
  `localStorage`; every request re-validated by Express; refresh rotation
  re-issues cookie pairs.
- **CSRF:** two independent defences — SameSite=Lax as primary, plus an
  **Origin/Referer allowlist** middleware that rejects state-changing requests
  from non-allowlisted origins (403). Sign-in/logout/PIN/OTP, admin ops and
  order status changes all get this protection automatically because it is
  mounted app-wide (`server/src/app.js`).

**Hardening phase (next):**
- Brute-force / rate limits tuned per route: admin login, OTP send/verify, PIN
  verify (already rate-limited — verify limits against the spec).
- Admin-login lockout after N failures with audit trail; account-enumeration
  neutrality re-audited (identical generic error regardless of email existence).
- Security headers audit (helmet defaults + `CSP` nonce review for the Vite
  bundle) and a final authorized assessment pass per AGENTS.md §6 before
  production.

## Phase G — Remaining verified-claimed-state discipline

- Tests: `server` `npm test` (65/65 incl. admin + auth suites), plus
  `server/tests/pg-harness` for schema/RLS assertions (run after any schema
  change). Frontend type-check: `npx tsc --noEmit`.
- Nothing is marked "secure" until the AGENTS.md §6 assessment is actually
  executed; this roadmap's tested/untested status per item is stated above.

---

## Suggested order of execution

1. **You:** run `0004_business_id_compact.sql` + Phase-7 `business_type` ALTER in the Supabase Dashboard (two SQL actions; unblocks seller data + 4-digit ids).
2. **Backend:** Phase C seller onboarding + Phase E validators/MIME upload rules.
3. **Backend:** Phase D OCR pipeline (after Phase E gives a validated upload path).
4. **Backend:** Phase F hardening (limits, lockout, headers audit).
5. **Security:** AGENTS.md §6 authorized assessment; retest per §16 checklist.