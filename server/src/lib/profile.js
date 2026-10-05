/**
 * Profile loading + onboarding-completeness, server-side only.
 *
 * "onboardingComplete" is COMPUTED by the backend from real DB columns —
 * never sent by the client, never stored as a client-controlled flag
 * (AGENTS.md §2.3). CUSTOMER = full_name + phone + pin_hash + gender +
 * category + user_type present; ADMIN = always true.
 */
export async function loadProfileRow(service, userId) {
  const { data: row, error } = await service
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  // Seller context (verification status) only exists after a seller
  // application — its absence means "no seller account" (NONE).
  const { data: seller, error: sellerError } = await service
    .from('seller_profiles')
    .select('verification_status, store_name')
    .eq('profile_id', userId)
    .maybeSingle();
  if (sellerError) throw sellerError;

  let roles = Array.isArray(row.roles) ? [...row.roles] : (row.role ? [row.role] : []);

  // Also check platform_operators table (if present)
  try {
    const { data: operatorRow } = await service
      .from('platform_operators')
      .select('role, status')
      .or(`id.eq.${userId},email.eq.${row.email}`)
      .maybeSingle();
    if (operatorRow && operatorRow.status === 'ACTIVE' && operatorRow.role) {
      if (!roles.includes(operatorRow.role)) {
        roles.push(operatorRow.role);
      }
    }
  } catch (e) {
    // ignore table absence or query error
  }

  return {
    ...row,
    roles,
    seller_status: seller?.verification_status ?? null,
    seller_store_name: seller?.store_name ?? null,
  };
}

/** Server-computed onboarding completeness (see module comment). */
export function computeOnboardingComplete(row) {
  if (!row) return false;
  if (row.role === 'ADMIN') return true;
  return Boolean(
    row.full_name &&
      row.phone &&
      row.pin_hash &&
      row.gender &&
      row.category &&
      row.user_type,
  );
}