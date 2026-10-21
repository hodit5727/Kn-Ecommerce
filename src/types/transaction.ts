export type TransactionType = 'CR' | 'DR';

export type TransactionCategory = 
  | 'ORDER_REVENUE'
  | 'REFUND_DEDUCTION'
  | 'PLATFORM_FEE'
  | 'SETTLEMENT_PAYOUT'
  | 'CORRECTION_ADJUSTMENT';

export interface FinancialTransaction {
  id: string;
  transactionNumber: string;
  referenceId?: string;
  sellerId?: string;
  sellerName?: string;
  customerId?: string;
  customerName?: string;
  orderId?: string;
  orderNumber?: string;
  productId?: string;
  productName?: string;
  productSku?: string;
  productReference?: string;
  grossAmount?: number;
  commissionRate?: number;
  commissionAmount?: number;
  netAmount?: number;
  payoutReference?: string;
  paymentMethod?: string;
  type: TransactionType; // CR or DR
  category: TransactionCategory;
  description: string;
  amount: number;
  balanceAfter: number;
  status: 'POSTED' | 'PENDING' | 'RECONCILED';
  createdAt: string;
}
