/**
 * GRANTING SELLER ACCESS — the single write path for "this person is a seller".
 *
 * WHY ONE FUNCTION
 * ----------------
 * There are two administrator decisions that must result in seller access:
 *
 *   1. `POST /admin/sellers/:id/review`                    (store application)
 *   2. `POST /admin/seller-verifications/:id/approve`      (live face check)
 *
 * They used to be separate code, and only the first one tried to touch the role
 * at all — so approving a live face check left the account unable to reach any
 * seller API, because the seller guard requires BOTH the SELLER role and an
 * APPROVED `seller_profiles.verification_status` (see middleware/seller.js).
 * Both now call this.
 *
 * TWO WRITES, BOTH REQUIRED
 * -------------------------
 * The role and the verification status are different columns in different tables,
 * and a seller needs both. A partial grant is a broken account, so a failure in
 * either step is thrown rather than logged and ignored.
 *
 * SERVER-AUTHORITATIVE (AGENTS.md §2 rules 1-4, 8, 11)
 * -----------------------------------------------------
 * `userId` is the ADMIN's chosen target; the target's own browser has no way to
 * reach this code. Nothing here reads client storage, a role the client sent, or
 * a URL. The role itself is granted through the SECURITY DEFINER
 * `grant_role_to_profile` function from migration 0007, which is revoked from
 * `anon`/`authenticated` and granted to `service_role` only — so even a bug in
 * this file cannot grant anything a direct `profiles.roles` write could not.
 */
import { httpError } from './errors.js';
import { sendSellerApprovedEmail } from './mail.js';

const nowIso = () => new Date().toISOString();

/**
 * Approve a seller: mark the verification APPROVED and grant the SELLER role.
 *
 * Idempotent — an already-approved seller is a no-op success, so a retried
 * admin request cannot fail or double-apply.
 *
 * @param {object} supabase the service-role Supabase client
 * @param {string} userId   the profile id being approved
 * @param {object} [env]    optional env config for email notifications
 * @returns {Promise<{alreadyApproved: boolean, sellerId: string | null}>}
 */
export async function grantSellerAccess(supabase, userId, env = null) {
  const id = String(userId ?? '').trim();
  if (!id) throw httpError(400, 'A user is required.');

  // (1) The verification decision. Checked first, because the role grant is the
  //     part that can fail for an unexpected reason and we do not want to hand
  //     out a role for a verification that was not recorded.
  let { data: seller, error: readError } = await supabase.service
    .from('seller_profiles')
    .select('verification_status, store_name, seller_name')
    .eq('profile_id', id)
    .maybeSingle();
  if (readError) {
    // eslint-disable-next-line no-console
    console.error('[seller-access] seller_profiles read failed:', readError.message);
    throw httpError(502, 'Unable to process the application. Please try again.');
  }
  if (!seller) {
    const { data: userProf } = await supabase.service
      .from('profiles')
      .select('full_name, phone')
      .eq('id', id)
      .maybeSingle();

    const storeName = `${userProf?.full_name || 'Campus'}'s Store`;
    const { data: newSeller, error: createErr } = await supabase.service
      .from('seller_profiles')
      .insert({
        profile_id: id,
        store_name: storeName,
        seller_name: userProf?.full_name || 'Seller',
        mobile: userProf?.phone || '',
        address: 'Campus Marketplace',
        store_category: 'General',
        business_type: 'INDIVIDUAL',
        verification_status: 'APPROVED',
        submitted_at: nowIso(),
        reviewed_at: nowIso(),
      })
      .select('verification_status, store_name, seller_name')
      .maybeSingle();

    if (createErr || !newSeller) {
      throw httpError(404, 'Seller application not found.');
    }
    seller = newSeller;
  }

  const alreadyApproved = seller.verification_status === 'APPROVED';

  if (!alreadyApproved) {
    const { error: updateError } = await supabase.service
      .from('seller_profiles')
      .update({
        verification_status: 'APPROVED',
        reviewed_at: nowIso(),
        rejection_reason: null, // a previous rejection must not linger
      })
      .eq('profile_id', id);
    if (updateError) {
      // eslint-disable-next-line no-console
      console.error('[seller-access] verification_status update failed:', updateError.message);
      throw httpError(502, 'Unable to process the application. Please try again.');
    }
  }

  // (2) The role, via the one sanctioned path. Always attempted, even when the
  //     status was already APPROVED: a previous partial failure may have set
  //     the status without ever granting the role, and this repairs it.
  const { error: roleError } = await supabase.service.rpc('grant_role_to_profile', {
    p_user_id: id,
    p_role: 'SELLER',
  });
  if (roleError) {
    // eslint-disable-next-line no-console
    console.error('[seller-access] role grant failed:', roleError.message);
    throw httpError(502, 'The seller was approved but the seller role could not be granted. Please retry.');
  }

  // (3) Read back the authoritative minted business_id (KNSR-XXXX)
  const { data: updatedProfile, error: profileError } = await supabase.service
    .from('profiles')
    .select('id, business_id, email, full_name')
    .eq('id', id)
    .maybeSingle();
  if (profileError) {
    // eslint-disable-next-line no-console
    console.warn('[seller-access] profile reload warning:', profileError.message);
  }

  const sellerId = updatedProfile?.business_id || null;

  // (4) Non-blocking approval email with the permanent unique Seller ID
  if (env && sellerId && updatedProfile?.email) {
    sendSellerApprovedEmail(env, {
      to: updatedProfile.email,
      fullName: updatedProfile.full_name || seller.seller_name || 'Artisan',
      storeName: seller.store_name,
      sellerId,
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[seller-access] approval email background error:', e && e.message ? e.message : e);
    });
  }

  return { alreadyApproved, sellerId, profile: updatedProfile };
}
