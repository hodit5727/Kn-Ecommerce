/**
 * UI Preview Mode — temporary development aid so the login/onboarding UI can
 * be walked through BEFORE the Express backend exists.
 *
 * Hard rules encoded here:
 * - DEV-only: `import.meta.env.DEV` is statically `false` in production
 *   builds, so every reference below is dead-code eliminated (verified by
 *   grepping the built dist/ output after `vite build`).
 * - Explicit opt-in via the `?uiPreview=1` query parameter. It NEVER
 *   activates as a fallback when the API fails — without the flag, a missing
 *   backend always shows the real error state (rules 6/13).
 * - Nothing here claims backend success: every toast/banner says "preview",
 *   "not saved", or "backend not connected" (rule 8).
 * - No localStorage/sessionStorage: the flag lives in module memory for the
 *   current page session only (rules 1/4).
 * - A refresh removes the preview session; re-add `?uiPreview=1` to walk it
 *   again.
 *
 * Usage: http://localhost:5173/?uiPreview=1
 */
import type { UserRole, UserProfile } from '../types/auth';

export const IS_UI_PREVIEW: boolean =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('uiPreview');

/** Entering this OTP during preview simulates a returning (existing) user. */
export const PREVIEW_RETURNING_OTP = '000000';

export const previewDelay = (ms = 400): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Obviously-marked local-only profile used to preview post-login layouts. */
export function buildPreviewProfile(email: string): UserProfile {
  return {
    id: 'preview-user',
    phone: '',
    email,
    fullName: 'UI Preview User',
    gender: 'Prefer not to say',
    role: 'CUSTOMER',
    isSellerApproved: false,
    sellerStatus: 'NONE',
    onboardingComplete: true,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Preview profile for the guarded dashboards. In UI preview mode only,
 * `RoleGuard` attaches this with the route's required role so the /seller and
 * /admin layouts render. Clearly labeled — never a real privileged account.
 */
export function buildPreviewRoleProfile(role: UserRole): UserProfile {
  const base = buildPreviewProfile(`preview.${role.toLowerCase()}@ui-preview.local`);
  if (role === 'SELLER') {
    return {
      ...base,
      id: 'preview-seller',
      fullName: 'UI Preview Seller',
      role: 'SELLER',
      isSellerApproved: true,
      sellerStatus: 'APPROVED',
      sellerStoreName: 'UI Preview Store',
    };
  }
  if (role === 'ADMIN') {
    return {
      ...base,
      id: 'preview-admin',
      fullName: 'UI Preview Admin',
      role: 'ADMIN',
    };
  }
  return base;
}
