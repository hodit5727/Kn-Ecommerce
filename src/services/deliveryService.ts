import { apiRequest } from '../api/http';
import { Order, CODOrderStatus } from '../types/order';
import { UserProfile } from '../types/auth';

interface DeliveryAuthResponse {
  user: UserProfile;
}

interface OrdersResponse {
  orders: Order[];
}

interface OrderResponse {
  order: Order;
}

export const deliveryService = {
  async login(email: string, password: string): Promise<UserProfile> {
    const res = await apiRequest<DeliveryAuthResponse>('/delivery/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return res.user;
  },

  async getDeliveryOrders(): Promise<Order[]> {
    const res = await apiRequest<OrdersResponse>('/orders', {
      method: 'GET',
    });
    return res.orders;
  },

  async markAsDelivered(orderId: string): Promise<Order> {
    const res = await apiRequest<OrderResponse>(`/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'COD_DELIVERED' as CODOrderStatus, collectedCod: true }),
    });
    return res.order;
  },
};
