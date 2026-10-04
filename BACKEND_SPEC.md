now to move to backend if your create follow my agent rules strrcly: those 90 doesnot come carefully handle backend and input santization 

before createing backend all mock and hardcoded products completely remove please add login admin page email and password

now env folder like i will that subabase auth and storage and data and gemini api flash for product img approve auto fill fields like input fields regenerate for example upload shirt input field generate description auto like M L XL X like they two shirt same brand one is M ANOTHER L that how to you handle based based on now local:5173 run after local testing after launch all sources 

i want to email template professional what i write html verification and if one time setup pin again logout login enter your pin show appear and also pin forgot enter email after confirmation email update new pin and confirm pin 


like env file gave me do not hardcorde if fallback fall function mainly not use 

seller dashboard input field remove College / Institution ID or Seller ID field 
if product img and seller college id card(algorithm OCR) gave mime type and size 

project flow: if customer using id :KNCR and move on seller id: KNSR and add to admin dashboard coupoun management create coupoun that is use only one time create a nav bar notification symbol based picked to anouncement reach that notification 

seller dashboard remove seller payout from left side bar

challenges: if seller product add and verify after list product(auto verification using deepfake algorithm after product list 3D rotation that product appear) customer will purchased and order tracking that product list created a qr near eye  view that qr enter  customer pin after qr show . deliever man manalyy added that mail just eitheir admin automatically veriify lets create a mobile app order deliever just scan only that customer qr after deleivered retrieve customer order detaills like name ,email,phone below deliever click automatically update in admin dashboard delieverd (customer & admin email notification)and email notification like customer order,delievered and admin dashboard store show if refund again qr generate customer again scan returned show and retrict order only handle customer not seller if seller dashboard show only how many orders product id and img show and then delievering status.

customer purchased first amount received admin after seller payouts(8th day) will 7th upto handle amount only admin if refund product by customer within 7th(1-3 commission 5% 4-7 10%) and if release 8th day automatically window closed 8th payout to seller fullan fully COD 

if delievered admin dashboard update original receive amount after seller payout show balance amount analytics used posthog mainly mobile app simple ahh simpaah venum 

if email notication admin&customer like -- order,deleievered ,return,cancel and admin and seller update dashboard --transaction(virtual passpook ) virtual account 

# VIBE CODERS E-COMMERCE — STRICT BACKEND IMPLEMENTATION SPECIFICATION

You are now moving from frontend/mock implementation to the **real production backend**.

Follow every rule below strictly. Do not skip, simplify, reinterpret, or silently ignore requirements.

The existing frontend is running locally at:

`http://localhost:5173`

Your responsibility is to connect the frontend to a real, secure backend and real Supabase infrastructure.

---

# 1. CRITICAL FIRST STEP — REMOVE ALL MOCK DATA

Before creating or modifying backend functionality:

- Completely remove all mock products.
- Completely remove all hardcoded product records.
- Completely remove fake users.
- Completely remove fake seller accounts.
- Completely remove fake admin accounts except the real admin authentication flow described below.
- Completely remove mock orders.
- Completely remove mock transactions.
- Completely remove hardcoded dashboard statistics.
- Completely remove fake authentication states.
- Completely remove frontend-only authorization.
- Completely remove fake API responses.
- Completely remove localStorage/sessionStorage values being treated as authentication authority.

Search the entire project for:

- mock
- dummy
- fake
- hardcoded products
- sample products
- test login
- temporary authentication
- static dashboard values
- static order data
- static seller data

Replace these with real backend/database operations.

Do not preserve mock data as a fallback.

---

# 2. ENVIRONMENT VARIABLES — ZERO SECRETS IN SOURCE CODE

Create/use environment variables for every secret or configurable backend credential.

At minimum:

- Supabase URL
- Supabase anon/public key
- Supabase service-role key
- Supabase database credentials if required by backend
- Supabase storage configuration
- Gemini API key
- Gemini model configuration
- SMTP/email credentials
- email sender address
- PostHog API key
- PostHog host
- admin configuration
- application URL
- backend URL

NEVER hardcode:

- API keys
- passwords
- SMTP credentials
- Supabase service-role key
- Gemini API key
- JWT secrets
- admin credentials
- database credentials

Use `.env` / `.env.local` appropriately.

Create a safe `.env.example` containing variable names only.

NEVER expose server-only secrets to the frontend.

If a required environment variable is missing:

- fail clearly during startup/configuration
- display a meaningful configuration error
- do NOT silently use a fake fallback
- do NOT use hardcoded credentials
- do NOT silently switch to mock mode

---

# 3. SUPABASE ARCHITECTURE

Use Supabase as the real backend infrastructure for:

- Authentication
- PostgreSQL database
- Storage
- Row Level Security
- user profiles
- customer records
- seller records
- products
- product images
- orders
- order items
- returns
- refunds
- coupons
- announcements
- notifications
- transactions
- seller payout records
- virtual passbook/account
- QR/order verification data

Design the database properly with:

- primary keys
- foreign keys
- indexes
- timestamps
- status fields
- constraints
- audit fields
- appropriate RLS policies

Never trust frontend-supplied role, price, amount, seller ID, customer ID, order status, payout status, or authorization information.

---

# 4. AUTHENTICATION FLOW

Remove the old/test login flow.

Create a proper authentication system.

Customer authentication:

1. User selects customer login.
2. User enters required information.
3. OTP/email verification must be performed where required.
4. After successful verification, collect basic customer information.
5. Customer can later become a seller.

Admin authentication:

Create a dedicated Admin Login page with:

- Admin email
- Admin password
- secure authentication
- backend authorization
- proper session management

Do NOT create an admin account automatically in frontend code.

Admin privileges must be verified server-side.

---

# 5. CUSTOMER PIN SYSTEM

After initial successful authentication/setup:

- allow customer to create a secure login PIN
- confirm PIN
- securely store only a suitable protected representation
- NEVER store plaintext PIN

When the customer logs out and logs in again:

1. authenticate the user
2. show PIN verification
3. require the correct PIN before entering the protected application

Do not treat the frontend PIN state as authoritative.

---

# 6. FORGOT PIN FLOW

Implement:

`Forgot PIN`

Flow:

1. Customer enters registered email.
2. Backend verifies the account.
3. Send a professional email confirmation/verification message.
4. Only after successful verification allow PIN reset.
5. Customer enters:
   - New PIN
   - Confirm PIN
6. Validate PIN securely.
7. Update the protected PIN representation.
8. Invalidate appropriate previous authentication/reset state.
9. Log the security-sensitive event.

Never reveal whether an arbitrary email belongs to an account in a way that enables account enumeration.

---

# 7. PROFESSIONAL EMAIL SYSTEM

Create production-quality HTML email templates.

Required email events:

### Customer

- Account verification
- PIN reset
- Order placed
- Order cancelled
- Order delivered
- Return initiated
- Refund/return update

### Admin

- New order
- Order delivered
- Order cancelled
- Return initiated
- Refund event
- Important seller/order updates

### Seller

- Product verification result
- Product approved/rejected
- Order/product status updates where applicable
- Payout status

Emails must be:

- responsive HTML
- professional
- branded
- clear
- mobile friendly
- secure
- reusable through templates

Do not hardcode email HTML repeatedly throughout route handlers.

Create a reusable email service/template system.

---

# 8. CUSTOMER → SELLER CONVERSION

A customer may choose:

`Become a Seller`

The customer must complete the seller onboarding process.

Seller information should include appropriate seller details such as:

- Store Name
- Seller Name
- Profile Photo
- Mobile Number
- Email
- Address
- Store Category
- College/Institution-related information only where actually required by the business flow

IMPORTANT:

Remove the old unnecessary:

- College / Institution ID
- Seller ID

input fields from the seller dashboard.

Do not ask users to manually enter identifiers that the backend can generate.

Seller IDs must be generated by the backend.

Example business identifier:

`KNSR`

Customer identifier:

`KNCR`

Do not trust these identifiers if supplied by the frontend.

---

# 9. SELLER IDENTITY CARD / DOCUMENT UPLOAD

If seller verification requires an ID card/document:

- allow secure image/document upload
- validate MIME type
- validate extension
- validate file size
- reject unsupported files
- do not trust the client-provided MIME type alone
- perform server-side validation
- store securely in Supabase Storage
- use private storage where appropriate
- generate signed URLs when access is required

Perform OCR/verification processing where required.

Never allow arbitrary executable files to be uploaded as identity documents.

---

# 10. PRODUCT CREATION

Seller creates products using real database operations.

Product fields should support:

- Product Name
- Brand
- Category
- Description
- Price
- Stock
- Product Images
- Sizes
- Colors
- SKU/product ID
- other required product attributes

---

# 11. GEMINI PRODUCT ASSISTANCE

Use Gemini Flash through the backend/server-side environment.

Never expose the Gemini API key to the browser.

Example:

Seller uploads product image:

`shirt image`

Seller enters basic information such as:

`Brand: ABC`

The system can generate:

- Product description
- Suggested attributes
- Category
- Color
- Material
- Search keywords
- Size-related information when inferable

The seller must be able to review/edit generated information before saving.

Do NOT blindly trust AI-generated data.

---

# 12. PRODUCT VARIANT HANDLING

Products must support variants correctly.

Example:

Same shirt:

`Brand: ABC`

Variant 1:

`Size: M`

Variant 2:

`Size: L`

These should NOT become unrelated products simply because sizes differ.

Use a parent product + product variants architecture.

Example:

Product:

`ABC Casual Shirt`

Variants:

- M
- L
- XL

Each variant can have its own:

- SKU
- stock
- price if required
- size
- color
- inventory

Do not duplicate the complete product unnecessarily.

---

# 13. PRODUCT IMAGE STORAGE

All product images must be stored using Supabase Storage.

Validate:

- MIME type
- actual file type where possible
- file size
- image dimensions where appropriate

Reject:

- executable files
- unsupported file formats
- oversized uploads

Generate optimized versions/thumbnails where appropriate.

---

# 14. PRODUCT VERIFICATION

When seller submits a product:

`Draft → Submitted → Verification → Approved/Rejected`

Do not immediately expose unapproved products to customers.

Implement automated product verification where required.

If a deepfake/manipulation detection algorithm is used for product images:

- process the image
- calculate the verification result
- store verification metadata
- do not expose the product until required checks pass

AI/algorithmic verification must not be treated as infallible.

Support an admin review mechanism for uncertain/rejected cases.

---

# 15. 3D PRODUCT VIEW

After product approval:

- customer can view the product
- support a product rotation/3D-style viewing experience where applicable
- product images must come from real stored product data
- do not use placeholder product assets

---

# 16. CUSTOMER PURCHASE FLOW

Customer selects product variant and purchases.

For COD:

- create real order
- calculate actual order total
- record customer
- record seller
- record product
- record variant
- record quantity
- record address
- record order status
- record timestamps

Never trust the total amount sent by the frontend.

The backend must recalculate the amount.

---

# 17. ORDER STATUS SYSTEM

Use a controlled state machine.

Example:

`PLACED`

→ `CONFIRMED`

→ `PROCESSING`

→ `READY_FOR_DELIVERY`

→ `OUT_FOR_DELIVERY`

→ `DELIVERED`

Possible alternative states:

`CANCELLED`

`RETURN_REQUESTED`

`RETURNED`

`REFUNDED`

Do not allow arbitrary status transitions from the frontend.

---

# 18. CUSTOMER ORDER QR

For a delivered-order verification process:

Generate a secure QR associated with the order.

The QR must NOT contain sensitive customer information directly.

Use a secure random token/reference.

Delivery agent scans QR.

Then require appropriate customer PIN/verification.

Only after successful verification should the delivery workflow expose the necessary order information.

Never encode:

- customer password
- PIN
- full personal information
- authentication secrets

inside the QR.

---

# 19. SIMPLE DELIVERY MOBILE APP

Create a simple delivery-agent mobile workflow.

The app should primarily support:

1. Login/authentication
2. Scan customer order QR
3. Verify customer
4. Show minimum required order/customer details
5. Confirm delivery
6. Submit delivery confirmation

Keep the mobile app simple.

Do NOT build unnecessary complex features.

After successful delivery:

Backend automatically updates:

`OUT_FOR_DELIVERY → DELIVERED`

Then:

- customer dashboard updates
- admin dashboard updates
- seller dashboard updates
- customer receives email
- admin receives email

---

# 20. DELIVERY SECURITY

A QR scan alone must NOT be enough to deliver an order.

Require appropriate verification.

Prevent:

- replay attacks
- reused QR tokens
- delivery of already delivered orders
- unauthorized order access
- scanning another customer's order without authorization

QR tokens should be:

- unpredictable
- scoped to the order
- time/state aware
- invalidated after successful delivery where appropriate

---

# 21. RETURN / REFUND QR FLOW

If a customer initiates a valid return:

Generate a new secure return QR.

Return process:

1. Customer requests return.
2. Backend validates eligibility.
3. Return QR is generated.
4. Delivery/return agent scans QR.
5. Customer verification occurs.
6. Return is confirmed.
7. Order status updates.
8. Refund process is triggered according to business rules.

Returned product handling must be customer/order focused.

Do not expose seller-side customer management unnecessarily.

---

# 22. REFUND WINDOW

Business rule:

Customer refund eligibility is based on the delivery date.

Days:

`Day 1–3`

Commission:

`5%`

Days:

`Day 4–7`

Commission:

`10%`

After:

`Day 7`

Refund window closes.

`Day 8`

Seller payout is released automatically according to the payout rules.

IMPORTANT:

Calculate eligibility using backend timestamps, not frontend time.

Use server/database time.

Prevent timezone manipulation.

---

# 23. SELLER PAYOUT

Seller payout must NOT appear as a normal seller dashboard left-sidebar navigation item.

Remove:

`Seller Payout`

from seller navigation.

Payout processing is controlled by backend/admin.

For COD:

1. Customer places order.
2. Customer pays COD.
3. Admin records/controls received amount.
4. Refund eligibility remains open until the configured deadline.
5. After the refund window closes:
   - seller payout becomes eligible
   - payout is released on Day 8 according to the business rule
6. Record the transaction.

Never mark a payout as completed only because the frontend displays it.

---

# 24. SELLER DASHBOARD

Seller dashboard should NOT expose unnecessary financial controls.

Seller should primarily see:

- Product ID
- Product image
- Product name
- Product status
- Number of orders
- Order quantity
- Delivery status
- Basic order/product operational information

Do not expose full customer sensitive information unnecessarily.

Do not expose admin financial controls.

---

# 25. ADMIN DASHBOARD

Admin dashboard must contain real database-driven information.

Required modules:

### Dashboard

- total customers
- total sellers
- total products
- total orders
- delivered orders
- cancelled orders
- returns
- refunds
- transaction summary

### Customer Management

- customers
- status
- orders
- relevant account information

### Seller Management

- sellers
- verification status
- products
- operational status

### Product Management

- pending verification
- approved
- rejected
- product details
- verification information

### Order Management

- all orders
- status
- delivery
- cancellation
- returns
- refunds

### Coupon Management

Admin can:

- create coupon
- configure coupon code
- discount
- eligibility
- expiration
- usage rules

---

# 26. COUPON — ONE-TIME USE

Support one-time coupon functionality.

A coupon marked as one-time-use must not be reusable by the same customer after successful redemption.

Backend must enforce this.

Do NOT rely on:

- frontend button disabling
- localStorage
- client-side counters

Use database constraints/transactions where appropriate to prevent race-condition double redemption.

---

# 27. ANNOUNCEMENT + NOTIFICATION

Admin can create announcements.

Announcements can be targeted according to the selected audience.

When an announcement is published:

- relevant users receive an in-app notification
- navbar notification icon/bell displays unread count
- notification list shows the announcement
- notification can be marked as read

Do not send announcements to users outside the selected audience.

---

# 28. TRANSACTION / VIRTUAL PASSBOOK

Create an admin transaction system similar to a virtual passbook.

Record:

- transaction ID
- order ID
- customer
- seller
- transaction type
- credit/debit
- amount
- commission
- refund amount
- payout amount
- balance
- timestamp
- status

Transactions must be immutable/auditable wherever appropriate.

Do not simply overwrite financial history.

Every important financial event should create a transaction record.

---

# 29. ADMIN BALANCE / ANALYTICS

After delivery:

- update the admin transaction records
- show received COD amount
- account for refunds
- account for commission
- account for seller payout
- calculate remaining balance

Do not calculate financial history only from frontend state.

Use database transaction records as the source of truth.

---

# 30. POSTHOG ANALYTICS

Integrate PostHog primarily for product analytics.

Track meaningful events such as:

- login
- signup
- product_view
- product_search
- add_to_cart
- checkout_started
- order_created
- order_delivered
- return_requested
- refund_completed
- coupon_used

Do not send unnecessary sensitive personal information to analytics.

Do not send:

- passwords
- PINs
- authentication tokens
- full payment secrets
- sensitive identity documents

---

# 31. INPUT SANITIZATION — MANDATORY

Every backend input must be validated.

Protect against:

- SQL injection
- XSS
- HTML injection
- command injection
- path traversal
- malicious file uploads
- prototype pollution where applicable
- SSRF where applicable
- parameter tampering
- mass assignment
- IDOR
- broken access control
- race conditions
- replay attacks

Use:

- schema validation
- allowlists
- strict types
- length limits
- enum validation
- server-side authorization
- parameterized queries
- secure file validation

Never trust frontend validation.

Frontend validation is UX only.

Backend validation is security.

---

# 32. AUTHORIZATION

Every protected API endpoint must verify:

1. authenticated user
2. user identity
3. role
4. resource ownership
5. requested action permission

Example:

A seller must not be able to modify another seller's product by changing:

`product_id`

in the request.

A customer must not be able to access another customer's order by changing:

`order_id`

Test for IDOR/BOLA explicitly.

---

# 33. DATABASE SECURITY

Implement Supabase RLS correctly.

Do not create policies such as:

`allow everyone everything`

Do not expose service-role credentials to the browser.

Use server-side privileged operations only where necessary.

Test:

- customer access
- seller access
- admin access
- unauthorized access
- cross-user access
- cross-seller access

---

# 34. EMAIL NOTIFICATION MATRIX

Implement notifications for:

### Customer

- Order placed
- Order cancelled
- Order delivered
- Return requested
- Refund processed

### Admin

- Order placed
- Order delivered
- Order cancelled
- Return requested
- Refund processed

### Seller

- Product approved/rejected
- Operational order/product updates
- payout status when applicable

All email events must originate from backend business events.

---

# 35. ERROR HANDLING

Never silently ignore:

- database errors
- authentication errors
- email errors
- storage errors
- AI API errors
- transaction errors
- payout errors
- QR verification errors

Return safe user-facing errors while logging useful server-side diagnostics.

Never expose:

- stack traces
- API keys
- database credentials
- internal secrets
- sensitive database details

---

# 36. AUDIT LOGGING

Log security-sensitive/admin actions such as:

- admin login
- seller verification
- product approval
- product rejection
- order status change
- refund
- cancellation
- payout
- coupon creation
- coupon redemption
- announcement creation
- PIN reset

Audit logs should contain appropriate:

- actor
- action
- resource
- timestamp
- result

Do not store sensitive secrets in logs.

---

# 37. TESTING BEFORE COMPLETION

Do NOT claim the backend is complete until testing is performed.

Test at minimum:

### Authentication

- valid login
- invalid login
- logout
- PIN login
- forgot PIN
- PIN reset
- unauthorized access

### Customer

- signup
- profile
- seller conversion
- product browsing
- product purchase
- order tracking
- QR verification
- return
- refund

### Seller

- onboarding
- document upload
- product creation
- product image upload
- AI field generation
- product submission
- product approval/rejection
- order visibility

### Admin

- login
- customer management
- seller management
- product verification
- order management
- coupon management
- announcements
- transactions
- refund
- payout

### Security

Test for:

- IDOR/BOLA
- SQL injection
- XSS
- CSRF where applicable
- authentication bypass
- authorization bypass
- parameter tampering
- file upload vulnerabilities
- MIME spoofing
- oversized uploads
- race conditions
- QR replay
- coupon double redemption
- payout manipulation
- refund-window manipulation

---

# 38. FRONTEND-BACKEND CONTRACT

Do not randomly modify frontend behavior.

First identify:

- current routes
- current components
- current API calls
- current state management
- current forms
- current authentication UI

Then create a clean backend API/data contract.

Replace mock service calls with real API/database operations.

Maintain existing UI wherever possible unless a backend requirement requires a UI change.

---

# 39. LOCAL TESTING

Run the complete system locally.

Frontend:

`localhost:5173`

Backend should use the configured local/backend environment.

Verify:

- frontend
- backend
- Supabase
- Storage
- authentication
- email
- Gemini
- PostHog
- QR workflow
- admin dashboard
- seller dashboard
- customer dashboard

Do not say “working” based only on compilation.

Actually test the flows.

---

# 40. FINAL SECURITY AUDIT

Before deployment, perform a final security review.

Search the entire codebase for:

- hardcoded secrets
- API keys
- passwords
- test credentials
- mock data
- fake products
- fake orders
- fake users
- insecure localStorage authentication
- client-side authorization
- disabled security checks
- TODO security bypasses
- commented-out authentication
- debug endpoints
- unrestricted Supabase policies

Fix every issue found.

---

# 41. PRODUCTION DEPLOYMENT

Only after local testing passes:

1. Configure production environment variables.
2. Apply production database migrations.
3. Configure Supabase Storage.
4. Configure authentication.
5. Configure email.
6. Configure Gemini.
7. Configure PostHog.
8. Deploy backend.
9. Deploy frontend.
10. Verify production API connectivity.
11. Verify production authentication.
12. Verify production order flow.
13. Verify production email.
14. Verify production QR.
15. Verify production admin/seller/customer permissions.

Do not deploy development credentials.

---

# 42. STRICT DEVELOPMENT RULE

Do NOT say:

- “done”
- “working”
- “secure”
- “production ready”

unless the relevant functionality has actually been implemented and tested.

If something cannot be implemented because a required credential/configuration is missing:

- clearly identify the missing variable/configuration
- implement everything that can safely be implemented
- do not invent credentials
- do not create fake fallback functionality

---

# 43. IMPLEMENTATION ORDER

Follow this order strictly:

PHASE 1
Remove all mocks/hardcoded data.

PHASE 2
Environment configuration.

PHASE 3
Supabase schema + RLS.

PHASE 4
Authentication + admin authentication.

PHASE 5
Customer PIN + forgot PIN.

PHASE 6
Customer/seller profiles.

PHASE 7
Seller verification/document upload.

PHASE 8
Product + variants + image storage.

PHASE 9
Gemini product assistance.

PHASE 10
Product verification.

PHASE 11
Customer purchase/order system.

PHASE 12
Delivery + QR verification.

PHASE 13
Return/refund system.

PHASE 14
Coupon system.

PHASE 15
Announcements/notifications.

PHASE 16
Transactions/virtual passbook.

PHASE 17
Seller payout logic.

PHASE 18
Email notification system.

PHASE 19
PostHog analytics.

PHASE 20
Security testing.

PHASE 21
Complete local testing.

PHASE 22
Production deployment.

Do not jump directly to Phase 22.

---

# 44. FINAL ACCEPTANCE CRITERIA

The project is considered complete only when:

- zero mock products remain
- zero fake authentication remains
- zero hardcoded secrets remain
- real Supabase authentication works
- real Supabase database works
- real Supabase Storage works
- admin authentication works
- customer PIN works
- forgot PIN works
- seller onboarding works
- seller documents are securely validated
- product creation works
- product variants work
- Gemini assistance works through backend
- product verification works
- customer ordering works
- COD flow works
- order tracking works
- delivery QR works
- delivery verification works
- return QR works
- refund rules work
- coupon one-time-use enforcement works
- announcement notifications work
- transaction/passbook works
- seller payout timing works
- customer/admin/seller emails work
- PostHog analytics works
- seller dashboard is restricted appropriately
- seller payout navigation is removed
- admin dashboard is database-driven
- RLS is tested
- IDOR/BOLA is tested
- file upload security is tested
- input sanitization is tested
- race conditions are considered/tested
- local testing passes
- production deployment is verified

FINAL RULE:

**Do not build another demo. Build the actual backend-connected production architecture.**

