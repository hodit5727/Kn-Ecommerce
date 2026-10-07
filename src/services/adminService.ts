/**
 * Administrative service — REAL backend calls only.
 *
 * ─── Security design (removed legacy mock/localStorage flow) ───────────────
 * - No localStorage, no SEED_CUSTOMERS / SEED_SELLERS, no
 *   simulateNetworkDelay, no devController failure toggles, no in-browser
 *   status mutation. Every list, statistic, and review decision is produced
 *   by the server.
 * - ALL /admin/* endpoints require a server-verified ADMIN role; the Express
 *   backend returns 403 otherwise (customers, sellers, and unauthenticated
 *   requests are rejected server-side). Client-supplied ids (customer id,
 *   seller id) are NEVER trusted for authorization — the server resolves the
 *   target resource and the caller's role from the authenticated session
 *   (HttpOnly cookie, `credentials: 'include'`), so IDOR/BOLA on resource
 *   ids is rejected with 403/404.
 *
 * ─── API contract for the Express backend (backend phase) ──────────────────
 * GET    /admin/stats                                          -> { stats }
 *        stats: { totalCustomers, totalSellers, totalProducts, totalOrders,
 *                 deliveredOrders, cancelledOrders, returns, refunds,
 *                 transactionSummary, ... }
 *        (all values server-aggregated; dashboard numbers are never accepted
 *         from the client)
 * GET    /admin/customers?page&perPage&q                       -> { customers, page, perPage, total, totalPages }
 * POST   /admin/customers/:id/toggle-status                    -> { customer }
 *        (server flips ACTIVE <-> SUSPENDED after verifying the ADMIN role
 *         and that the customer id exists)
 * GET    /admin/sellers?page&perPage&status&q                  -> { sellers, page, perPage, total, totalPages }
 *        status: 'PENDING' | 'APPROVED' | 'REJECTED' | (omitted = ALL)
 * POST   /admin/sellers/:id/review    { decision }             -> { seller }
 *        decision: 'APPROVED' | 'REJECTED'
 * GET    /admin/products?page&perPage&q                        -> { products, page, perPage, total, totalPages }
 *        (ADMIN-ONLY index: ALL sellers' products, including unpublished)
 *
 * Pagination rules the frontend depends on:
 * - `page` is 1-based; `perPage` defaults to 20 and is capped server-side
 *   (max 50); `totalPages = ceil(total / perPage)`.
 * - Empty result sets return page=1, total=0, totalPages=0.
 * - `q` is a server-side search hint (name/email/store name). The client
 *   NEVER filters a server page locally — search + paging stay consistent
 *   with the real total.
 *
 * Server rules: re-verify the ADMIN role on every request, validate ids and
 * decision values server-side, persist decisions atomically, return only
 * safe error messages, and never expose internal errors or sensitive fields
 * (full bank details, tax records beyond what the UI shows) in responses.
 */
import type { AdminMetrics, AdminCustomerRecord, AdminSellerRecord, Paged } from '../types/admin';
import type { Product } from '../types/product';
import { apiRequest } from '../api/http';

interface AdminStatsResponse {
  stats: AdminMetrics;
}

interface AdminCustomersResponse {
  customers: AdminCustomerRecord[];
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
}

interface AdminCustomerResponse {
  customer: AdminCustomerRecord;
}

interface AdminSellersResponse {
  sellers: AdminSellerRecord[];
  counts?: Record<string, number>;
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
}

interface AdminSellerResponse {
  seller: AdminSellerRecord;
}

interface AdminProductsResponse {
  products: Product[];
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
}

export interface AdminListParams {
  page?: number;
  perPage?: number;
  q?: string;
}

export interface AdminSellersParams extends AdminListParams {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
}

/** Normalize the pagination envelope (protects against a missing field). */
const pageMeta = (r: { page?: number; perPage?: number; total?: number; totalPages?: number }) => ({
  page: r.page ?? 1,
  perPage: r.perPage ?? 20,
  total: r.total ?? 0,
  totalPages: r.totalPages ?? 0,
});

const toQueryString = (pairs: Array<[string, string | number | undefined]>) => {
  const query = new URLSearchParams();
  for (const [key, value] of pairs) {
    if (value === undefined || value === '' || value === 'ALL') continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : '';
};

export const adminService = {
  /** Server-aggregated dashboard statistics — never hardcoded client-side. */
  async getMetrics(): Promise<AdminMetrics> {
    const res = await apiRequest<AdminStatsResponse>('/admin/stats', { method: 'GET' });
    return res.stats;
  },

  /** Server-paginated patron directory. */
  async getCustomers(params: AdminListParams = {}): Promise<Paged<AdminCustomerRecord>> {
    const res = await apiRequest<AdminCustomersResponse>(
      `/admin/customers${toQueryString([['page', params.page], ['perPage', params.perPage], ['q', params.q?.trim()]])}`,
      { method: 'GET' },
    );
    return { items: res.customers, meta: pageMeta(res) };
  },

  /** Server flips the account status (ACTIVE <-> SUSPENDED) after verifying
   *  the caller's ADMIN role; the client never mutates state locally. */
  async toggleCustomerStatus(id: string): Promise<AdminCustomerRecord> {
    const res = await apiRequest<AdminCustomerResponse>(
      `/admin/customers/${encodeURIComponent(id)}/toggle-status`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    return res.customer;
  },

  /** Server-paginated seller registry, optionally filtered by accreditation
   *  status (PENDING / APPROVED / REJECTED / ALL). */
  async getSellers(params: AdminSellersParams = {}): Promise<Paged<AdminSellerRecord>> {
    const res = await apiRequest<AdminSellersResponse>(
      `/admin/sellers${toQueryString([
        ['page', params.page],
        ['perPage', params.perPage],
        ['status', params.status],
        ['q', params.q?.trim()],
      ])}`,
      { method: 'GET' },
    );
    return { items: res.sellers, meta: pageMeta(res), counts: res.counts };
  },

  /** Persists an accreditation decision server-side. The server re-verifies
   *  the ADMIN role and the seller id; the client only supplies the
   *  decision value. */
  async reviewSellerApplication(
    sellerId: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<AdminSellerRecord> {
    const res = await apiRequest<AdminSellerResponse>(
      `/admin/sellers/${encodeURIComponent(sellerId)}/review`,
      { method: 'POST', body: JSON.stringify({ decision }) },
    );
    return res.seller;
  },

  /** ADMIN-ONLY catalog index: every product across all sellers (including
   *  unpublished drafts). Server-paginated. */
  async getProducts(params: AdminListParams = {}): Promise<Paged<Product>> {
    const res = await apiRequest<AdminProductsResponse>(
      `/admin/products${toQueryString([['page', params.page], ['perPage', params.perPage], ['q', params.q?.trim()]])}`,
      { method: 'GET' },
    );
    return { items: res.products, meta: pageMeta(res) };
  },

  async getCoupons(): Promise<AdminCoupon[]> {
    const res = await apiRequest<{ coupons: AdminCoupon[] }>('/admin/coupons', { method: 'GET' });
    return res.coupons;
  },

  async createCoupon(data: {
    code: string;
    description?: string;
    couponKind: 'PERCENT' | 'FIXED';
    discountValue: number;
    maxDiscount?: number | null;
    minOrderAmount?: number | null;
    oneTimePerCustomer?: boolean;
    expiresAt?: string | null;
  }): Promise<AdminCoupon> {
    const res = await apiRequest<{ coupon: AdminCoupon }>('/admin/coupons', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.coupon;
  },

  async toggleCouponStatus(id: string): Promise<AdminCoupon> {
    const res = await apiRequest<{ coupon: AdminCoupon }>(`/admin/coupons/${id}/toggle`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return res.coupon;
  },

  async deleteCoupon(id: string): Promise<void> {
    await apiRequest<{ success: boolean }>(`/admin/coupons/${id}`, {
      method: 'DELETE',
    });
  },

  async reviewProduct(id: string, decision: 'APPROVED' | 'REJECTED', reason?: string): Promise<{ id: string; status: string }> {
    const res = await apiRequest<{ id: string; status: string }>(`/admin/products/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    });
    return res;
  },

  async updateProduct(id: string, data: Partial<Product>): Promise<void> {
    await apiRequest<{ success: boolean }>(`/admin/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteProduct(id: string): Promise<void> {
    await apiRequest<{ success: boolean }>(`/admin/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async getOperators(): Promise<AdminOperator[]> {
    const res = await apiRequest<{ operators: AdminOperator[] }>('/admin/operators', {
      method: 'GET',
    });
    return res.operators ?? [];
  },

  async createOperator(data: {
    fullName: string;
    email: string;
    role: OperatorRole;
    password: string;
    phone?: string;
  }): Promise<AdminOperator> {
    const res = await apiRequest<{ operator: AdminOperator }>('/admin/operators', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.operator;
  },

  async toggleOperatorStatus(id: string): Promise<boolean> {
    const res = await apiRequest<{ success: boolean; status: string }>(`/admin/operators/${encodeURIComponent(id)}/toggle-status`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return res.success;
  },

  async deleteOperator(id: string): Promise<void> {
    await apiRequest<{ success: boolean }>(`/admin/operators/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async getTrendingProducts(): Promise<{
    products: (Product & { soldCount: number; totalRevenue: number; sellerStoreName?: string })[];
    top10: (Product & { soldCount: number; totalRevenue: number; sellerStoreName?: string })[];
    metrics: { activeTrendingCount: number; totalUnitsSold: number; totalProducts: number };
  }> {
    return await apiRequest('/admin/trending', { method: 'GET' });
  },

  async toggleProductTrending(productId: string, isTrending: boolean): Promise<boolean> {
    const res = await apiRequest<{ success: boolean; isTrending: boolean }>('/admin/trending/toggle', {
      method: 'POST',
      body: JSON.stringify({ productId, isTrending }),
    });
    return res.isTrending;
  },

  async getAuditLogs(): Promise<SystemAuditLog[]> {
    const res = await apiRequest<{ logs: SystemAuditLog[] }>('/admin/audit-logs', {
      method: 'GET',
    });
    return res.logs ?? [];
  },
};

export type OperatorRole = 'SUPER_ADMIN' | 'ADMIN' | 'DELIVERY_PERSON';

export interface AdminOperator {
  id: string;
  fullName: string;
  email: string;
  role: OperatorRole;
  phone?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  createdAt: string;
}

export interface SystemAuditLog {
  id: string;
  actor_id?: string | null;
  actor_role?: string | null;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  result: string;
  ip_address?: string | null;
  metadata?: any;
  created_at: string;
}

export interface AdminCoupon {
  id: string;
  code: string;
  description?: string | null;
  coupon_kind: 'PERCENT' | 'FIXED';
  discount_value: number;
  max_discount?: number | null;
  min_order_amount?: number | null;
  one_time_per_customer?: boolean;
  expires_at?: string | null;
  is_active: boolean;
  created_at: string;
}