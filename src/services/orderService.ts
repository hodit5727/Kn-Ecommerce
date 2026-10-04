/**
 * Order service — REAL backend calls only (Cash on Delivery).
 *
 * ─── Security design (removed legacy localStorage/mock orders) ─────────────
 * - No SEED_ORDERS, no INITIAL_PRODUCTS fixtures, no localStorage order
 *   store, no client-side order-number generation, no simulateNetworkDelay.
 * - The SERVER recalculates every price, stock level, delivery fee, discount
 *   and total from the database when creating an order — client-supplied
 *   amounts are NEVER trusted (§5.51, §5.52, §5.41, §75 of the spec).
 * - Identity and scope come from the HttpOnly session cookie only.
 * - Errors propagate as ApiError so pages can render real error states.
 *
 * ─── API contract for the Express backend (backend phase) ──────────────────
 * GET    /orders                 -> { orders }   Server scopes rows by the
 *       query: customerId, sellerId              authenticated session. The
 *                                                legacy client customerId /
 *                                                sellerId params are HINTS
 *                                                ONLY and must be IGNORED for
 *                                                authorization — they can
 *                                                never widen or narrow access
 *                                                (§5.56, §5.57, §5.77/78).
 * GET    /orders/:id             -> { order }    Ownership-checked server-side
 *                                                (customer: own orders,
 *                                                seller: orders containing own
 *                                                products, admin: all) — 403
 *                                                otherwise (§5.56, §5.57).
 * POST   /orders                 -> { order }    COD order creation.
 *       body: { items: [{ productId,            Server re-reads products from
 *               quantity, ... }],                the DB, re-prices them, checks
 *               shippingAddress,                 stock and recomputes totals
 *               customer }                       (§5.49–53, §75). Identity is
 *                                                taken from the session; the
 *                                                client `customer.id` is not
 *                                                used for authorization.
 * POST   /orders/:id/cancel      -> { order }    body { reason }; ownership
 *                                                checked server-side; the
 *                                                server enforces cancellation
 *                                                eligibility/status (§5.55).
 * PATCH  /orders/:id/status      -> { order }    body { status }; SELLER/ADMIN
 *                                                role-checked server-side
 *                                                (§5.11, §5.12, §5.55); a
 *                                                seller may only advance orders
 *                                                containing their own products;
 *                                                status/payment/eligibility
 *                                                transitions are computed by
 *                                                the server (§5.59).
 */
import type { Order, CODOrderStatus } from '../types/order';
import type { CartItem, ShippingAddress } from '../types/cart';
import { apiRequest } from '../api/http';

interface OrdersResponse {
  orders: Order[];
}

interface OrderResponse {
  order: Order;
}

export const orderService = {
  /**
   * `customerId` / `sellerId` are kept for call-site compatibility only —
   * the server derives the real scope from the session and ignores these
   * params for authorization.
   */
  async getOrders(customerId?: string, sellerId?: string): Promise<Order[]> {
    const query = new URLSearchParams();
    if (customerId) query.set('customerId', customerId);
    if (sellerId) query.set('sellerId', sellerId);
    const qs = query.toString();

    const res = await apiRequest<OrdersResponse>(`/orders${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
    return res.orders;
  },

  /** Ownership is verified server-side; a foreign order id returns 403/404. */
  async getOrderById(orderId: string): Promise<Order> {
    const res = await apiRequest<OrderResponse>(`/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
    });
    return res.order;
  },

  /**
   * Cash-on-Delivery order creation. Only line items and the shipping
   * address are sent — the server derives the customer from the session,
   * re-reads products from the DB, and recomputes subtotal / fees / total.
   */
  async placeCODOrder(
    items: CartItem[],
    shippingAddress: ShippingAddress,
    customer: { id: string; name: string; email: string; phone?: string }
  ): Promise<Order> {
    const res = await apiRequest<OrderResponse>('/orders', {
      body: JSON.stringify({
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          selectedColor: item.selectedColor,
          selectedSize: item.selectedSize,
        })),
        shippingAddress,
        // Identity is established by the session cookie server-side; the
        // client only relays contact details for delivery coordination.
        customer: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
        },
      }),
    });
    return res.order;
  },

  /** Ownership + eligibility are re-checked by the server. */
  async cancelOrder(orderId: string, reason: string): Promise<Order> {
    const res = await apiRequest<OrderResponse>(`/orders/${encodeURIComponent(orderId)}/cancel`, {
      body: JSON.stringify({ reason }),
    });
    return res.order;
  },

  /** Seller/admin fulfillment advance. Role + scope enforced server-side. */
  async updateOrderStatusBySellerOrAdmin(
    orderId: string,
    status: CODOrderStatus
  ): Promise<Order> {
    const res = await apiRequest<OrderResponse>(`/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    return res.order;
  },
};
