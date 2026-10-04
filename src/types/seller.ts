export interface SellerMetrics {
  grossSales: number;
  netRevenue: number;
  pendingSettlement: number;
  availableSettlement: number;
  totalOrders: number;
  activeProductsCount: number;
  lowStockCount: number;
  refundRequestsCount: number;
  platformFeesPaid: number;
}

export interface InventoryItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  category: string;
  price: number;
  availableStock: number;
  reservedStock: number;
  soldQuantity: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  updatedAt: string;
}

export interface SettlementRecord {
  id: string;
  settlementNumber: string;
  sellerId: string;
  sellerName: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  platformFee: number;
  netSettlementAmount: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  bankReference?: string;
  createdAt: string;
  processedAt?: string;
}
