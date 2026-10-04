# AGENTS.md — Project Memory & Mandatory Rules

> This file is loaded at the start of **every new chat / task** in this project.
> Read it fully before any implementation, debugging, refactoring, or feature work.

> **Authoritative backend spec: [`BACKEND_SPEC.md`](./BACKEND_SPEC.md)** — the
> 44-section backend specification (phases, endpoints, business rules).
> `supabase/migrations/` implements its data architecture (§3, §8, §16–§36);
> verify any schema change with `server/tests/pg-harness` (`npm test` — boots a
> real PostgreSQL, applies all migrations, runs the schema/RLS assertions).

---

## 1. System Architecture (authoritative)

This is a production e-commerce platform with a strict 3-tier architecture:

```
Browser (User)
   │  Internet
   ▼
Frontend  ── hosted on Railway
   │  all API requests go to the Express backend
   ▼
Express.js Backend
   │  handles: authentication, authorization, business logic, orders,
   │           inventory, refunds, seller & admin operations
   ▼
Supabase
   ├── Supabase Auth      → user authentication
   ├── Supabase Storage   → product images / documents
   └── Supabase PostgreSQL→ customers, sellers, products, orders,
                            payments, refunds (secure data storage)
```

### Rules derived from the architecture
- **Frontend** = Railway. It is untrusted. It only renders UI and calls the backend.
- **Backend** = Express.js. It is the **single place** where authentication, authorization, business logic, orders, inventory, refunds, and all seller/admin operations live.
- **Database** = Supabase PostgreSQL, accessed through the Express backend (never bypass the backend for privileged operations).
- **Auth** = Supabase Auth, verified server-side by Express.
- **Storage** = Supabase Storage for product images/documents.
- The frontend must **never** talk to privileged Supabase APIs directly for protected operations; everything privileged goes Frontend → Express → Supabase.

**Before creating any backend code, strictly follow these rules.**

---

## 2. Production Security Rules (mandatory — all 14)

These rules are mandatory for **every** coding, debugging, refactoring, and feature implementation task in this project.

1. **Identity & Authorization Authority**: Never use `localStorage`, `sessionStorage`, or client-controlled profile objects as the authoritative source for user identity or authorization.
2. **Backend Authentication**: Authentication must be verified using the real authenticated backend/session.
3. **Server-Side Authorization**: Authorization must be enforced by the backend/database/RLS.
4. **No Client Privilege Reliance**: Never use `localStorage` user IDs, `isAdmin` flags, roles, or client-side values to authorize protected operations.
5. **No Production Mock Data**: Never use mock, fake, dummy, demo, placeholder, or hardcoded application data in production functionality.
6. **No Fallback Mocking**: Never use mock data as a fallback when Supabase, Firebase, API, or database requests fail.
7. **Error Visibility**: Never silently ignore errors. No empty catch blocks and no `.catch(() => {})`.
8. **True Operation Confirmation**: Only show a success UI after the required backend/database operation actually succeeds.
9. **Zero Secrets in Code**: Never hardcode passwords, secrets, service-role keys, private keys, database credentials, or privileged API keys.
10. **Supabase Security Architecture**: For Supabase, use Supabase Auth for identity and RLS/`auth.uid()` for authorization.
11. **Security Control Preservation**: Before modifying existing code, inspect the existing implementation and preserve existing security controls.
12. **Pre-Completion Audit**: Before completing any task, inspect changed code for `localStorage`, `sessionStorage`, mock data, hardcoded data, fake authentication, fallback data, `isAdmin`, `user_profile`, empty catch blocks, ignored database errors, and exposed secrets.
13. **Graceful Error States**: If the real backend is unavailable, show an error state instead of creating fake functionality.
14. **Verifiable Test Claims**: Never claim a security test passed unless it was actually executed and verified.

---

## 3. Pre-Completion Checklist (run before answering "done")

Search the changed code for, and fix any occurrence of:

- [ ] `localStorage` / `sessionStorage` used for identity, roles, or authorization
- [ ] `isAdmin`, `role`, `user_profile`, user id read from the client to grant access
- [ ] mock / fake / dummy / demo / placeholder / hardcoded application data
- [ ] mock data used as a fallback after an API/Supabase/DB failure
- [ ] empty `catch` blocks, `.catch(() => {})`, swallowed errors
- [ ] success UI shown before the backend/DB operation confirmed success
- [ ] hardcoded passwords, secrets, service-role keys, DB credentials
- [ ] Supabase calls that skip the Express backend for privileged operations
- [ ] claims of "test passed" without actually running the test
- [ ] applicable items from §5 (the 90 experienced error classes) violated by the changed code
- [ ] security-sensitive changes not accounted for in the §6 assessment scope

---

## 4. Stack Reference

| Layer     | Technology                | Hosted / Where          |
|-----------|---------------------------|-------------------------|
| Frontend  | React + Vite + Tailwind   | Railway                 |
| Backend   | Express.js (Node)         | API server              |
| Auth      | Supabase Auth             | Verified in Express     |
| Storage   | Supabase Storage          | Images & documents      |
| Database  | Supabase PostgreSQL + RLS | Via backend / RLS rules  |

---

## 5. Pre-Backend Mandate — 90 Previously Experienced Errors (MUST NOT recur)

> Recorded from real field experience **before backend creation**. The Express
> backend (and any frontend work touching these areas) must be built so these
> error classes are **prevented server-side**. Frontend validation is UX only —
> every item below must be enforced/enforced-or-handled by the backend.
> Before marking backend work "done", verify the applicable numbered items.

### Authentication (1–20)
1. Login OTP not received
2. OTP expiry not working correctly
3. Wrong OTP accepted
4. OTP resend cooldown bypass
5. Multiple OTP requests
6. PIN setup validation error
7. PIN confirmation mismatch
8. Logout not invalidating session
9. Unauthorized dashboard access
10. Customer accessing seller/admin routes
11. Seller accessing admin routes
12. Session/token expiry not handled
13. Refresh token/session renewal error
14. Account enumeration through login response
15. Password/PIN brute-force protection missing
16. Rate limiting missing
17. Authentication state inconsistent after refresh
18. Back button exposes authenticated pages
19. New-device login not handled
20. Account deactivation not immediately enforced

### Customer Registration (21–28)
21. 10-digit mobile validation
22. Duplicate mobile registration
23. Invalid college/reg number accepted
24. Department validation issue
25. Year validation issue
26. Missing mandatory fields accepted
27. Profile update not saved
28. Customer data disappearing after logout/login

### Seller (29–35)
29. Seller verification bypass
30. Invalid ID card upload accepted
31. Store information not validated
32. Seller approval status not enforced
33. Unapproved seller can add products
34. Seller can modify another seller's product
35. Seller can access another seller's orders

### Product / E-commerce (36–48)
36. Product creation error
37. Product image upload failure
38. Invalid image type/size accepted
39. Product price validation bypass
40. Negative/zero price accepted
41. Stock becoming negative
42. Product search returning incorrect results
43. Category/filter mismatch
44. Wishlist persistence error
45. Review/rating authorization issue
46. Duplicate reviews
47. Deleted product still appearing
48. Seller product edit not reflected for customers

### Cart / Orders (49–59)
49. Cart quantity manipulation
50. Out-of-stock item still purchasable
51. Price changed after adding to cart
52. Order total calculation mismatch
53. COD order creation error
54. Duplicate order creation
55. Order status unauthorized modification
56. Customer viewing another customer's order
57. Seller viewing unrelated orders
58. Cancelled order still appearing active
59. Refund/settlement status mismatch

### Admin (60–68)
60. Admin route authorization error
61. Customer → admin privilege escalation
62. Seller → admin privilege escalation
63. Admin CRUD failures
64. Incorrect customer/seller counts
65. Transaction/settlement calculation errors
66. Refund status not synchronized
67. Announcement CRUD error
68. Audit/history records missing

### Backend / Database (69–80)
69. API returning 400/401/403 incorrectly
70. API returning 500 on invalid input
71. Missing database error handling
72. Database transaction not rolled back
73. Duplicate records
74. Foreign-key/reference errors
75. Race condition in stock/order creation
76. API exposing sensitive fields
77. IDOR/BOLA on resource IDs
78. Missing server-side authorization
79. CORS misconfiguration
80. Error messages exposing internal information

### Frontend (81–90)
81. Authentication state lost on refresh
82. Loading state stuck
83. API timeout not handled
84. Broken redirect after login
85. Mobile UI authentication issue
86. Form validation mismatch with backend
87. Stale product/order data
88. Error toast not displayed
89. Double-click creates duplicate requests
90. Browser cache showing outdated account data

---

## 6. Authorized Security Assessment Protocol (run after backend build, before production)

Perform a complete authorized security assessment of the **Vibe Coders / K-Shop
e-commerce website**. Test ONLY the application and APIs explicitly provided and
authorized for this assessment.

### Objective
Identify, validate, and document vulnerabilities across authentication,
authorization, APIs, user roles, seller workflows, admin functions, products,
cart, orders, COD, refunds, file uploads, sessions, and business logic.

### Testing areas
1. **Authentication** — login bypass; OTP validation/expiry/resend abuse/
   brute-force/rate limits; PIN setup/validation/brute-force; session creation,
   invalidation, expiry; logout invalidation; auth state after refresh; account
   enumeration; duplicate registration; unauthenticated page access; auth API
   endpoints. Server-side enforcement must be verified — never frontend/localStorage only.
2. **Authorization & access control** — test Customer, Seller, Admin separately:
   privilege escalation (C→S, C→A, S→A), horizontal escalation, IDOR/BOLA,
   cross-user profile/order/product access, function-level authorization, direct
   URL/API access. Frontend role checks are never the security boundary.
3. **API security** — per endpoint: missing auth(n/z), IDOR, parameter tampering,
   mass assignment, method manipulation, input validation, excessive data
   exposure, error handling, rate limits, CORS, 401/403 correctness, version drift.
   Backend must independently validate user identity AND resource ownership.
4. **E-commerce business logic** — price/quantity/stock/cart/order-total
   manipulation, negative values, COD bypass, duplicate orders, order ownership,
   unauthorized cancellation/status changes, refund authorization, settlement
   manipulation, coupon abuse, product ownership, deleted/out-of-stock purchase.
   No frontend-calculated value is trustworthy.
5. **Seller security** — registration/verification bypass, unauthorized approval,
   ID-card upload validation, profile/API authorization, cross-seller access,
   unauthorized product modification/deletion, order/customer data access, settlements.
6. **Admin security** — admin authn/authz, endpoint protection, IDOR/BOLA,
   customer/seller/product/refund/settlement/announcement management authorization,
   audit-log integrity.
7. **Web application (OWASP)** — SQLi, XSS, CSRF, SSRF, path traversal, command
   injection, XXE, CRLF, open redirect, file upload, CORS, security headers,
   information disclosure. Safe, non-destructive payloads only; stop immediately
   if testing could modify/destroy real data.
8. **File upload** — type/MIME/extension validation, size limits, filename/path
   handling, unauthorized access, public/private storage config, SVG/HTML/script
   risks, ID-card/profile-image access control.
9. **Session & client-side** — fixation, reuse, invalidation, token expiry/scope,
   cookie attributes, sensitive data in browser storage, client-side authz bypass,
   cache/history exposure. Client storage is never proof of identity/role.
10. **Automated + manual** — authorized tools where appropriate (Burp Suite,
    OWASP ZAP, Nuclei, Nmap) **plus manual verification** of important findings.
    Scanner-only alerts are never reported as vulnerabilities.
11. **Error handling** — invalid requests must not reveal stack traces, DB errors,
    internal paths, framework versions, API keys/secrets, debug info, or sensitive
    user data. Return safe generic errors; log detail securely server-side.
12. **Report** — per confirmed vulnerability: name, severity (Critical/High/Medium/
    Low/Informational), endpoint/page, affected role, preconditions, reproduction
    steps, safe PoC, expected vs actual behavior, impact, root cause, remediation, retest procedure.

### Mandatory rules for the assessment
- Authorized testing only; non-destructive; no production data deletion/corruption; no access to unrelated users' private data; no DoS; exploit only as far as needed to prove the issue.
- Never report based only on a scanner alert — manually validate.
- Treat all client-controlled values as untrusted; frontend restrictions are non-security controls.
- Backend/DB authorization must be independently enforced; never silently ignore backend/DB errors.
- Prioritize Critical/High findings first.

### Final output (17 sections)
1. Executive Summary · 2. Testing Scope · 3. Attack Surface · 4. Authentication
Findings · 5. Authorization Findings · 6. API Security Findings · 7. E-commerce
Business Logic Findings · 8. Seller Security Findings · 9. Admin Security
Findings · 10. Web Vulnerability Findings · 11. File Upload Findings · 12.
Session Security Findings · 13. Risk Matrix · 14. Critical/High Priority Fixes ·
15. Detailed Remediation Plan · 16. Retest Checklist · 17. Final Security Status.

> Never claim the application is secure because no vulnerability was found.
> Clearly distinguish **tested**, **not tested**, **not applicable**, and
> **requires further verification**.
