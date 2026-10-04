/**
 * Phase 6 — customer/seller profiles (BACKEND_SPEC §4/§6/§8).
 *
 * Contract (src/services/authService.ts):
 *   POST /auth/profile    OnboardingProfilePayload → { user }  (onboarding)
 *   PUT  /auth/profile    { fullName }              → { user }
 *   POST /seller/applications SellerApplicationData → { success, message, user? }
 *
 * Security:
 * - Every field is re-validated server-side via validateOnboarding() — the
 *   backend NEVER trusts the client (§2.3, §5-23..27, §5-86). Only whitelisted
 *   DB columns are written (mass-assignment/§5-76 defence).
 * - The payload email must equal the session user's email (no cross-user
 *   profile manipulation, §5-77).
 * - Seller application is created from the SERVER-side profile row
 *   (seller_name = full_name, mobile = profile.phone) — never from free-form
 *   client values — and duplicate applications are rejected (§5-32/§5-33).
 */
import { Router } from 'express';
import { HttpError, httpError, ok } from '../lib/errors.js';
import {
  isValidEmail,
  isValidFullName,
  isValidPhone,
  GENDER_OPTIONS,
  CATEGORY_OPTIONS,
  USER_TYPE_OPTIONS,
  CATEGORY_RULES,
  STAFF_CODE_PATTERN,
  validateOnboarding
} from '../lib/validate.js';
import { loadProfileRow } from '../lib/profile.js';
import { profileToUser } from '../lib/shape.js';
import { writeAudit } from '../lib/audit.js';
import { requireAuth } from '../middleware/auth.js';
import { sellerApplyLimiter } from '../middleware/security.js';
import {
  ALLOWED_ID_DOCUMENT_MIMES,
  MAX_ID_DOCUMENT_BYTES,
  SELLER_DOCUMENTS_BUCKET,
  verifyStoredObject,
} from '../lib/uploads.js';

const BUSINESS_TYPES = ['INDIVIDUAL', 'PROPRIETORSHIP', 'REGISTERED_COMPANY'];

/** True when a DB unique-index violation names the given index (never leaks
 *  internals to the client — the caller maps it to a clean user message). */
function isUniqueViolation(error, indexName) {
  const msg = String(error?.message ?? '');
  return /duplicate key value/i.test(msg) && msg.includes(indexName);
}

export function createProfilesRouter({ env, supabase }) {
  const router = Router();

  // ── POST /auth/profile (onboarding — completes the Phase 5 stub) ─────────
  router.post('/auth/profile', requireAuth(supabase, env), async (req, res) => {
    const { profile, user } = req.auth;

    const result = validateOnboarding(req.body);
    if (!result.ok) {
      // First error only — the frontend pre-validates per-field (§5-86); this
      // is the server-side safety net with a clear, non-internal message.
      throw httpError(400, Object.values(result.errors)[0]);
    }
    const fields = result.fields;
    if (String(fields.email).toLowerCase() !== String(user.email ?? '').trim().toLowerCase()) {
      throw httpError(403, 'Forbidden.');
    }

    const { error } = await supabase.service
      .from('profiles')
      .update({
        full_name: fields.full_name,
        phone: fields.phone,
        gender: fields.gender,
        category: fields.category,
        user_type: fields.user_type,
        department: fields.department,
        academic_year: fields.academic_year,
        college_reg_no: fields.college_reg_no,
        staff_code: fields.staff_code,
      })
      .eq('id', profile.id);
    if (error) {
      if (isUniqueViolation(error, 'profiles_phone_uniq')) {
        // AGENTS.md §5-22 — duplicate mobile rejected server-side, honestly.
        throw httpError(400, 'This mobile number is already registered to another account.');
      }
      if (isUniqueViolation(error, 'profiles_email_uniq')) {
        throw httpError(400, 'This email is already registered to another account.');
      }
      // CHECK-constraint / unexpected DB failure — loud log, generic client msg.
      // eslint-disable-next-line no-console
      console.error('[profiles] onboarding update failed:', error.message);
      throw httpError(400, 'Unable to save your profile. Please review the entered details.');
    }

    const row = await loadProfileRow(supabase.service, profile.id);
    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'customer.profile.completed',
      resourceType: 'profile',
      resourceId: profile.id,
      ip: req.ip ?? null,
      metadata: { email: fields.email, user_type: fields.user_type, category: fields.category },
    });
    return ok(res, { user: profileToUser(row) });
  });

  // ── PUT /auth/profile (comprehensive customer profile update) ───────────
  router.put('/auth/profile', requireAuth(supabase, env), async (req, res) => {
    const { profile } = req.auth;
    const b = req.body ?? {};
    const patch = {};

    // 1. Full name
    if (b.fullName !== undefined) {
      const fullName = String(b.fullName).trim();
      if (!isValidFullName(fullName)) {
        throw httpError(400, 'Enter a valid full name (letters only).');
      }
      patch.full_name = fullName;
    }

    // 2. Phone
    if (b.phone !== undefined) {
      const phone = String(b.phone).trim();
      if (!isValidPhone(phone)) {
        throw httpError(400, 'Enter a valid 10-digit Indian mobile number.');
      }
      patch.phone = phone;
    }

    // 3. Gender
    if (b.gender !== undefined) {
      const gender = String(b.gender).trim();
      if (gender && !GENDER_OPTIONS.includes(gender)) {
        throw httpError(400, 'Invalid gender selection.');
      }
      patch.gender = gender || null;
    }

    // 4. Category
    let targetCat = profile.category;
    if (b.category !== undefined) {
      const category = String(b.category).trim().toUpperCase();
      if (category && !CATEGORY_OPTIONS.includes(category)) {
        throw httpError(400, 'Invalid campus category.');
      }
      targetCat = category || profile.category || 'ENGINEERING';
      patch.category = category || null;
    }

    // 5. User Type
    let targetType = profile.user_type || 'STUDENT';
    if (b.userType !== undefined) {
      const userType = String(b.userType).trim().toUpperCase();
      if (userType && !USER_TYPE_OPTIONS.includes(userType)) {
        throw httpError(400, 'Invalid user type.');
      }
      targetType = userType || profile.user_type || 'STUDENT';
      patch.user_type = userType || null;
    }

    // 6. Department
    if (b.department !== undefined) {
      const dept = String(b.department).trim();
      const rules = CATEGORY_RULES[targetCat || 'ENGINEERING'];
      if (dept && rules && !rules.departments.includes(dept)) {
        throw httpError(400, `Department "${dept}" is not valid for ${targetCat || 'ENGINEERING'}.`);
      }
      patch.department = dept || null;
    }

    // 7. Academic year (Student only)
    if (b.year !== undefined) {
      const year = String(b.year).trim();
      patch.academic_year = year || null;
    }

    // 8. Registration number (Student only)
    if (b.registrationNumber !== undefined) {
      const reg = String(b.registrationNumber).trim();
      patch.college_reg_no = reg || null;
    }

    // 9. Staff code (Staff only)
    if (b.staffCode !== undefined) {
      const code = String(b.staffCode).trim();
      patch.staff_code = code || null;
    }

    // Mutually exclusive fields based on targetType
    if (targetType === 'STUDENT') {
      patch.staff_code = null;
    } else if (targetType === 'STAFF') {
      patch.academic_year = null;
      patch.college_reg_no = null;
    }

    if (Object.keys(patch).length === 0) {
      throw httpError(400, 'No valid profile updates provided.');
    }

    const { error } = await supabase.service
      .from('profiles')
      .update(patch)
      .eq('id', profile.id);
    if (error) {
      if (isUniqueViolation(error, 'profiles_phone_uniq')) {
        throw httpError(400, 'This mobile number is already registered to another account.');
      }
      console.error('[profiles] update failed:', error.message);
      throw httpError(502, 'Unable to update your profile. Please try again.');
    }

    const row = await loadProfileRow(supabase.service, profile.id);
    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'customer.profile.updated',
      resourceType: 'profile',
      resourceId: profile.id,
      ip: req.ip ?? null,
      metadata: patch,
    });
    return ok(res, { user: profileToUser(row) });
  });

  // ── POST /seller/applications (start the seller journey, spec §8) ────────
  // COD-only marketplace: no bank/tax fields are collected or stored.
  router.post('/seller/applications', requireAuth(supabase, env), sellerApplyLimiter(), async (req, res) => {
    const { profile } = req.auth;
    const b = req.body ?? {};
    const storeName = typeof b.storeName === 'string' ? b.storeName.trim() : '';
    const businessType = typeof b.businessType === 'string' ? b.businessType : '';
    const businessAddress = typeof b.businessAddress === 'string' ? b.businessAddress.trim() : '';
    const storeCategory = typeof b.storeCategory === 'string' ? b.storeCategory.trim() : '';

    if (b.agreeToTerms !== true) {
      throw httpError(400, 'You must agree to the K-Shop COD Settlement Standards.');
    }
    if (storeName.length < 3 || storeName.length > 120) {
      throw httpError(400, 'Store name must be 3–120 characters.');
    }
    if (!BUSINESS_TYPES.includes(businessType)) {
      throw httpError(400, 'Invalid seller type.');
    }
    if (businessAddress.length < 5 || businessAddress.length > 400) {
      throw httpError(400, 'Enter a valid store address (5–400 characters).');
    }
    if (storeCategory.length < 2 || storeCategory.length > 80) {
      throw httpError(400, 'Select a store category.');
    }

    // Optional identity document (from POST /seller/documents). The metadata
    // is re-validated server-side AND cross-checked against storage so a
    // client can never attach a path it did not honestly upload (§9).
    let idDocumentFields = {};
    const rawDoc = b.idDocument;
    if (rawDoc !== undefined && rawDoc !== null) {
      const storagePath = typeof rawDoc.storagePath === 'string' ? rawDoc.storagePath.trim() : '';
      const mimeType = typeof rawDoc.mimeType === 'string' ? rawDoc.mimeType.toLowerCase() : '';
      const byteSize = Number(rawDoc.byteSize);
      const DOCUMENT_PATH_RE = /^seller-docs\/[A-Za-z0-9._/-]{1,300}$/;
      if (!DOCUMENT_PATH_RE.test(storagePath)) {
        throw httpError(400, 'The identity document reference is invalid. Please upload it again.');
      }
      if (!ALLOWED_ID_DOCUMENT_MIMES.includes(mimeType)) {
        throw httpError(400, 'The identity document type is not supported.');
      }
      if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_ID_DOCUMENT_BYTES) {
        throw httpError(400, 'The identity document size is invalid. Please upload it again.');
      }
      const { mime: realMime, byteSize: realSize } = await verifyStoredObject(
        supabase.service,
        {
          bucket: env.STORAGE_BUCKET_SELLER_DOCUMENTS || SELLER_DOCUMENTS_BUCKET,
          path: storagePath,
          allowedMimes: ALLOWED_ID_DOCUMENT_MIMES,
          maxBytes: MAX_ID_DOCUMENT_BYTES,
          kindLabel: 'identity document',
        },
      );
      // The re-derived values MUST match what the server itself issued at
      // upload time (POST /seller/documents) — a client can only ever attach
      // a document it honestly uploaded through the backend (§9).
      if (realMime !== mimeType || realSize !== byteSize) {
        throw httpError(400, 'The uploaded identity document could not be verified. Please upload it again.');
      }
      idDocumentFields = {
        id_document_path: storagePath,
        id_document_mime: realMime,
        id_document_bytes: realSize,
        id_ocr_status: 'PENDING',
      };
    }

    // server-side truth: name + mobile come from the completed customer
    // profile, never from free-form client values (§2.3, §5-31).
    if (!profile.full_name || !profile.phone) {
      throw httpError(400, 'Complete your customer profile before applying to sell.');
    }

    const { data: existing, error: dupError } = await supabase.service
      .from('seller_profiles')
      .select('verification_status')
      .eq('profile_id', profile.id)
      .maybeSingle();
    if (dupError) {
      // eslint-disable-next-line no-console
      console.error('[seller/applications] duplicate check failed:', dupError.message);
      throw httpError(502, 'Unable to submit your application. Please try again.');
    }
    if (existing) {
      throw httpError(
        409,
        existing.verification_status === 'APPROVED'
          ? 'Your store is already active.'
          : 'You have already submitted a seller application.',
      );
    }

    const { error: insertError } = await supabase.service.from('seller_profiles').insert({
      profile_id: profile.id,
      store_name: storeName,
      seller_name: profile.full_name,
      mobile: profile.phone,
      address: businessAddress,
      store_category: storeCategory,
      business_type: businessType,
      submitted_at: new Date().toISOString(),
      ...idDocumentFields,
    });
    if (insertError) {
      if (String(insertError.message ?? '').includes('business_type')) {
        // eslint-disable-next-line no-console
        console.error(
          '[seller/applications] missing column: run the Phase 6 schema SQL ' +
            '(ALTER TABLE seller_profiles ADD COLUMN business_type text).',
        );
      } else {
        // eslint-disable-next-line no-console
        console.error('[seller/applications] insert failed:', insertError.message);
      }
      throw httpError(502, 'Unable to submit your application. Please try again.');
    }

    await writeAudit(supabase, {
      actorId: profile.id,
      actorRole: profile.role,
      action: 'seller.application.submitted',
      resourceType: 'seller_profile',
      resourceId: profile.id,
      ip: req.ip ?? null,
      metadata: { store_name: storeName, business_type: businessType },
    });

    const updated = await loadProfileRow(supabase.service, profile.id);
    return ok(res, {
      success: true,
      message: 'Seller application submitted! We will review and activate your store.',
      user: profileToUser(updated),
    });
  });

  return router;
}