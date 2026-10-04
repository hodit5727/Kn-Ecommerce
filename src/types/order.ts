import { CartItem, ShippingAddress } from './cart';

export type CODOrderStatus = 
  | 'COD_PENDING'
  | 'COD_CONFIRMED'
  | 'COD_PROCESSING'
  | 'COD_SHIPPED'
  | 'COD_DELIVERED'
  | 'COD_CANCELLED';

export interface OrderTimelineEvent {
  status: CODOrderStatus;
  timestamp: string;
  description: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  orderCode?: string;
  customerId: string;
  customerBusinessId?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  sellerId?: string;
  sellerBusinessId?: string;
  sellerName?: string;
  sellerStoreName?: string;
  sellerPersonName?: string;
  sellerEmail?: string;
  sellerPhone?: string;
  sellerAddress?: string;
  items: CartItem[];
  shippingAddress: ShippingAddress;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  totalAmount: number;
  paymentMethod: 'CASH_ON_DELIVERY';
  paymentStatus: 'UNPAID_COD' | 'COLLECTED_COD' | 'VOID_CANCELLED';
  orderStatus: CODOrderStatus;
  isEligibleForCancel: boolean;
  isEligibleForRefund: boolean;
  timeline: OrderTimelineEvent[];
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
}
