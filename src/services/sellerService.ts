/**
 * Seller metrics / inventory / settlement service — REAL backend calls only.
 *
 * ─── Security design (removed legacy mock/localStorage flow) ───────────────
 * - No localStorage, no SEED_INVENTORY / SEED_SETTLEMENTS, no hardcoded
 *   metric numbers, no simulateNetworkDelay, no devController failure
 *   toggles, and no dependency on productService seed data (INITIAL_PRODUCTS).
 * - The server derives the seller identity from the authenticated session
 *   (HttpOnly cookie, `credentials: 'include'`). Any sellerId parameter
 *   accepted by these client methods is IGNORED for authorization and is
 *   never forwarded as an authorization signal. Requests for another
 *   seller's inventory/settlement records return 403 (role violation) or
 *   404 (resource not owned by this seller).
 * - Settlement/payout data is server-owned: sellers may REQUEST a payout,
 *   but amounts, fees, statuses, and bank references are computed and
 *   mutated only by the server. Sellers cannot modify settlement records.
 *
 * ─── API contract for the Express backend (backend phase) ──────────────────
 * GET    /seller/metrics                                  -> { metrics }
 *        metrics: { grossSales, netRevenue, pendingSettlement,
 *                   availableSettlement, totalOrders, activeProductsCount,
 *                   lowStockCount, refundRequestsCount, platformFeesPaid }
 *        (all values server-aggregated for the session's seller)
 * GET    /seller/revenue-chart                            -> { chartData }
 *        chartData: { month, gross, net, orders }[] — server-aggregated
 *        monthly series; `month` is a server-formatted label (e.g. "Sep 2026")
 * GET    /seller/inventory                                -> { items }
 * PUT    /seller/inventory/:id   { availableStock }       -> { item }
 *        server validates a non-negative integer, recomputes low-stock /
 *        out-of-stock status, and rejects ids not owned by the session seller
 * GET    /seller/settlements                              -> { settlements }
 *        role-scoped entirely server-side: a seller session only ever sees
 *        its own settlements; an admin session sees all (403/404 otherwise)
 * POST   /seller/settlements/payout { amount }            -> { settlement }
 *        server validates the amount against the session seller's available
 *        balance and creates the payout record; the client cannot forge
 *        settlement rows or choose the seller
 */
import type { SellerMetrics, InventoryItem, SettlementRecord } from '../types/seller';
import { apiRequest } from '../api/http';

export interface RevenueChartDataPoint {
  month: string;
  gross: number;
  net: number;
  orders: number;
}

interface MetricsResponse {
  metrics: SellerMetrics;
}

interface RevenueChartResponse {
  chartData: RevenueChartDataPoint[];
}

interface InventoryResponse {
  items: InventoryItem[];
}

interface InventoryItemResponse {
  item: InventoryItem;
}

interface SettlementsResponse {
  settlements: SettlementRecord[];
}

interface SettlementResponse {
  settlement: SettlementRecord;
}

export const sellerService = {
  async getMetrics(sellerId?: string): Promise<SellerMetrics> {
    // Deliberately ignored: seller identity comes from the session cookie.
    void sellerId;
    const res = await apiRequest<MetricsResponse>('/seller/metrics', { method: 'GET' });
    return res.metrics;
  },

  async getRevenueChartData(): Promise<RevenueChartDataPoint[]> {
    const res = await apiRequest<RevenueChartResponse>('/seller/revenue-chart', { method: 'GET' });
    return res.chartData;
  },
};

export const inventoryService = {
  async getInventory(sellerId?: string): Promise<InventoryItem[]> {
    // Deliberately ignored: seller identity comes from the session cookie.
    void sellerId;
    const res = await apiRequest<InventoryResponse>('/seller/inventory', { method: 'GET' });
    return res.items;
  },

  /** Server validates the new stock level, recomputes low-stock status, and
   *  rejects ids that do not belong to the session's seller (403/404). */
  async updateStock(id: string, newAvailableStock: number): Promise<InventoryItem> {
    const res = await apiRequest<InventoryItemResponse>(
      `/seller/inventory/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify({ availableStock: newAvailableStock }) },
    );
    return res.item;
  },
};

export const settlementService = {
  async getSettlements(sellerId?: string): Promise<SettlementRecord[]> {
    // Deliberately ignored: the server scopes results by the session's role
    // (a seller sees only their own settlements; an admin sees all).
    void sellerId;
    const res = await apiRequest<SettlementsResponse>('/seller/settlements', { method: 'GET' });
    return res.settlements;
  },

  /** Requests a payout of `amount`; the server validates it against the
   *  session seller's available balance and creates the settlement record. */
  async requestSettlementPayout(amount: number): Promise<SettlementRecord> {
    const res = await apiRequest<SettlementResponse>('/seller/settlements/payout', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    return res.settlement;
  },
};
