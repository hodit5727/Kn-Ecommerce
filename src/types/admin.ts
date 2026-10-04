import { SellerStatus } from './auth';

/** Server-driven pagination metadata returned with every admin list. */
export interface AdminPageMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/** Generic server-paginated payload (list endpoints). */
export interface Paged<T> {
  items: T[];
  meta: AdminPageMeta;
  counts?: Record<string, number>;
}

export interface AdminMetrics {
  totalOrders: number;
  totalCustomers: number;
  totalSellers: number;
  totalProducts: number;
  totalGrossRevenue: number;
  pendingRefundsCount: number;
  pendingSettlementsCount: number;
  activeAnnouncementsCount: number;
}

export interface AdminCustomerRecord {
  id: string;
  /** DB-generated patron id (§8): KNCR-XXXXXXXX for customers (KNSR- for
   *  approved sellers). Populated by the profiles_assign_identity trigger —
   *  never client-supplied. */
  customerId: string;
  sellerId?: string;
  fullName: string;
  email: string;
  phone?: string;
  status: 'ACTIVE' | 'SUSPENDED';
  orderCount: number;
  totalSpent: number;
  sellerStatus: SellerStatus;
  joinedDate: string;
}

export interface AdminSellerRecord {
  id: string;
  customerId: string;
  sellerId?: string;
  storeName: string;
  ownerName: string;
  email: string;
  phone?: string;
  storeCategory?: string;
  businessType?: string;
  address?: string;
  documentUrl?: string | null;
  livenessStatus?: string | null;
  documentStatus?: string | null;
  matchStatus?: string | null;
  status: SellerStatus;
  productCount: number;
  orderCount: number;
  grossRevenue: number;
  settlementStatus: 'UP_TO_DATE' | 'PENDING_APPROVAL';
  appliedDate: string;
  reviewedDate?: string;
  taxId?: string;
  bankAccountLast4?: string;
}
