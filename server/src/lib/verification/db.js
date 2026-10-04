/**
 * seller_verifications DB helpers shared by the seller + admin verification
 * routers (loaded rows, legal multi-hop transitions).
 *
 * All reads/writes go through the service-role client — the backend is the
 * only writer; the DB transition trigger (0006) enforces legality a second
 * time even if a caller ever missteps.
 */
import { httpError } from '../errors.js';
import { transitionPath } from './states.js';

/** Latest verification cycle row for a user (routes sort in JS — §fake-restrictions). */
export async function latestVerification(supabase, userId) {
  const { data, error } = await supabase.service
    .from('seller_verifications')
    .select('*')
    .eq('user_id', userId);
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[verification] latest lookup failed:', error.message);
    throw httpError(502, 'Unable to load your verification. Please try again.');
  }
  const rows = (data ?? []).slice().sort((a, b) => Number(b.cycle ?? 0) - Number(a.cycle ?? 0));
  return rows[0] ?? null;
}

/** Load one verification row by id (admin ops). */
export async function verificationById(supabase, id) {
  const { data: row, error } = await supabase.service
    .from('seller_verifications')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !row) throw httpError(404, 'Verification not found.');
  return row;
}

/** Walk `from → to` as sequential single-step UPDATEs (DB trigger safe). */
export async function walkTransition(supabase, verification, to, finalExtra = {}) {
  const path = transitionPath(verification.verification_status, to);
  if (!path) throw httpError(409, 'This verification step is not allowed right now.');
  for (const hop of path.slice(1)) {
    const extra = hop === path[path.length - 1] ? finalExtra : {};
    const { error } = await supabase.service
      .from('seller_verifications')
      .update({ ...extra, verification_status: hop })
      .eq('id', verification.id);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[verification] transition failed:', error.message);
      throw httpError(502, 'Unable to update the verification state. Please try again.');
    }
  }
}

/** Mark every ACTIVE session of a verification REVOKED (admin reverify). */
export async function revokeActiveSessions(supabase, verificationId) {
  const { data, error } = await supabase.service
    .from('verification_sessions')
    .select('*')
    .eq('verification_id', verificationId)
    .eq('status', 'ACTIVE');
  if (error) return;
  for (const s of data ?? []) {
    await supabase.service.from('verification_sessions').update({ status: 'REVOKED' }).eq('id', s.id);
  }
  return (data ?? []).map((s) => s.id);
}