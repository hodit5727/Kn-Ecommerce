export type RefundStatus = 
  | 'REQUESTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PROCESSING'
  | 'COMPLETED';

export type RefundReason = 
  | 'DAMAGED_ON_DELIVERY'
  | 'NOT_AS_DESCRIBED'
  | 'DEFECTIVE_COMPONENT'
  | 'WRONG_ITEM_RECEIVED'
  | 'OTHER';

export interface RefundClaim {
  id: string;
  refundNumber: string;
  returnCode?: string;
  refundCode?: string;
  orderId: string;
  orderNumber: string;
  productId: string;
  productName: string;
  productImage: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  sellerId: string;
  sellerName: string;
  amount: number;
  reason: RefundReason;
  description: string;
  evidenceImages?: string[];
  status: RefundStatus;
  adminNotes?: string;
  sellerResponse?: string;
  requestedAt: string;
  resolvedAt?: string;
  updatedAt: string;
}
