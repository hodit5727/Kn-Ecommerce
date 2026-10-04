/**
 * DB row (snake_case) → frontend UserProfile (camelCase contract in
 * src/types/auth.ts). Map everything explicitly — never spread raw rows to
 * the client (§5-76: excessive data exposure).
 */
import { computeOnboardingComplete } from './profile.js';

export function deriveContextIds(businessId, isSeller = false) {
  if (!businessId) return { customerId: undefined, sellerId: undefined };
  const str = String(businessId);
  const suffix = str.replace(/^KN[CS]R-/, '');
  const customerId = suffix ? `KNCR-${suffix}` : str;
  const sellerId = isSeller && suffix ? `KNSR-${suffix}` : undefined;
  return { customerId, sellerId };
}

export function profileToUser(row) {
  if (!row) return null;
  const sellerStatus = row.seller_status ? String(row.seller_status) : 'NONE';
  const roles = Array.isArray(row.roles) ? row.roles : (row.role ? [row.role] : []);
  const isSellerApproved = sellerStatus === 'APPROVED' || roles.includes('SELLER') || row.role === 'SELLER';
  const { customerId, sellerId } = deriveContextIds(row.business_id, isSellerApproved);

  return {
    id: row.id,
    phone: row.phone ?? '',
    email: row.email,
    fullName: row.full_name ?? '',
    gender: row.gender ?? '',
    avatarUrl: row.avatar_url ?? undefined,
    role: row.role,
    roles,
    isSellerApproved,
    sellerStatus,
    sellerStoreName: row.seller_store_name ?? undefined,
    customerId,
    sellerId: sellerId ?? (row.business_id?.startsWith('KNSR-') ? row.business_id : undefined),
    businessId: isSellerApproved ? (sellerId || row.business_id) : (customerId || row.business_id),
    onboardingComplete: computeOnboardingComplete(row),
    category: row.category ?? undefined,
    userType: row.user_type ?? undefined,
    department: row.department ?? undefined,
    year: row.academic_year ?? undefined,
    registrationNumber: row.college_reg_no ?? undefined,
    staffCode: row.staff_code ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}