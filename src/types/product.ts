export interface ProductSpecification {
  name: string;
  value: string;
}

export interface Product3DConfig {
  geometryType: 'watch' | 'furniture' | 'decor' | 'jewelry' | 'electronics';
  primaryColor: string;
  metalness: number;
  roughness: number;
  scale?: number;
  interiorType?: 'living_room' | 'gallery' | 'executive_suite' | 'minimalist_lounge';
}

export interface ProductVariantItem {
  id?: string;
  sku: string;
  size?: string | null;
  color?: string | null;
  price: number;
  stock: number;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  price: number;
  originalPrice?: number;
  discountPercent?: number;
  category: string;
  subcategory?: string;
  brand: string;
  material?: string;
  colors?: string[];
  images: string[];
  threeDConfig?: Product3DConfig;
  stock: number;
  sku: string;
  variants?: ProductVariantItem[];
  rating: number;
  reviewCount: number;
  isTrending?: boolean;
  isFeatured?: boolean;
  isNewArrival?: boolean;
  sellerId: string;
  sellerName: string;
  sellerEmail?: string;
  sellerPhone?: string;
  sellerBusinessId?: string;
  sellerAddress?: string;
  sellerRating: number;
  specifications: ProductSpecification[];
  deliveryEstimateDays: number;
  returnPolicyDays: number;
  status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';
  productCode?: string;
  approvalStatus?: string;
  totalStock?: number;
  soldCount?: number;
  balanceStock?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductFilterParams {
  query?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStockOnly?: boolean;
  sortBy?: 'featured' | 'price_asc' | 'price_desc' | 'rating' | 'newest';
  sellerId?: string;
}
