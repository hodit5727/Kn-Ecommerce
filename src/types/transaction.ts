export type TransactionType = 'CR' | 'DR';

export type TransactionCategory =
  | 'COD_COLLECTION'
  | 'CASH_RECONCILIATION'
  | 'PLATFORM_COMMISSION'
  | 'SELLER_PAYABLE'
  | 'SELLER_PAYOUT'
  | 'SELLER_PAYOUT_REVERSAL'
  | 'CUSTOMER_REFUND'
  | 'REFUND_REVERSAL'
  | 'ADJUSTMENT'
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
  productCode?: string;
  productName?: string;
  productSku?: string;
  productImage?: string;
  productReference?: string;
  grossAmount?: number;
  commissionRate?: number;
  commissionAmount?: number;
  netAmount?: number;
  sellerPayoutId?: string;
  payoutReference?: string;
  cashCollectionReference?: string;
  isReconciled?: boolean;
  reconciliationReference?: string;
  payoutStatus?: string;
  payoutDate?: string;
  paymentMethod?: string;
  type: TransactionType; // CR or DR
  category: TransactionCategory;
  transactionCategory?: string;
  description: string;
  amount: number;
  balanceAfter: number;
  status: 'POSTED' | 'PENDING' | 'RECONCILED';
  createdAt: string;
}

export interface AdminTreasurySummary {
  totalCodCollected: number;
  sellerPayoutsPaid: number;
  pendingSellerPayouts: number;
  retainedCommission: number;
  cashAwaitingReconciliation: number;
  reconciledCash?: number;
  treasuryBalance: number;
}

export interface SellerTreasurySummary {
  grossSales: number;
  platformCommission: number;
  netSellerEarnings: number;
  totalPayoutsPaid: number;
  pendingPayouts: number;
  availableSellerBalance: number;
}
