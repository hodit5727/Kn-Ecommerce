/**
 * Product catalog service — REAL backend calls only.
 *
 * ─── Security design (removed legacy mock/demo catalog) ────────────────────
 * - No INITIAL_PRODUCTS mock array, no Unsplash fixture images, no
 *   simulateNetworkDelay, no dev-chaos toggles, no in-memory CRUD.
 * - The server owns price, stock and status: client-supplied values are
 *   validated input, never authoritative (§5.39/5.40/5.41 of the spec).
 * - Errors propagate as ApiError so pages can render real error states —
 *   never a silent fallback to fixture data.
 *
 * ─── API contract for the Express backend (backend phase) ──────────────────
 * GET    /products?search&category&minPrice&maxPrice&sort
 *          (optional hints: &minRating&inStock&sellerId)      -> { products }
 * GET    /products/categories   (register BEFORE /products/:id)
 *                                                            -> { categories }
 * GET    /products/:id          (id or slug; 404 when missing)
 *                                                            -> { product }
 * POST   /seller/products       Product payload              -> { product }
 * PUT    /seller/products/:id   Partial product payload      -> { product }
 * DELETE /seller/products/:id                                -> { success }
 *
 * Server rules the frontend depends on:
 * - Public GET /products and GET /products/:id return ONLY PUBLISHED products
 *   of APPROVED sellers; unapproved / draft / archived products are never
 *   publicly returned (§5.32, §5.33, §5.47).
 * - Seller endpoints are ownership-checked: the server derives the seller
 *   from the authenticated session and IGNORES any client-supplied
 *   `sellerId` — a seller can never create/modify/delete another seller's
 *   product (§5.29, §5.34, §5.35; no privilege escalation §5.62).
 * - The `sellerId` query hint on GET /products is never used to widen
 *   access; scope always comes from the session.
 * - Session travels in an HttpOnly cookie (credentials: 'include').
 */
import type { Product, ProductFilterParams } from '../types/product';
import { apiRequest } from '../api/http';

interface ProductsResponse {
  products: Product[];
}

interface ProductResponse {
  product: Product;
}

interface CategoriesResponse {
  categories: string[];
}

interface DeleteResponse {
  success: boolean;
}

export const productService = {
  /** Public catalog listing. All params are server-validated search hints. */
  async getProducts(params?: ProductFilterParams): Promise<Product[]> {
    const query = new URLSearchParams();
    if (params?.query) query.set('search', params.query);
    if (params?.category && params.category !== 'All') query.set('category', params.category);
    if (params?.minPrice !== undefined) query.set('minPrice', String(params.minPrice));
    if (params?.maxPrice !== undefined) query.set('maxPrice', String(params.maxPrice));
    if (params?.minRating !== undefined) query.set('minRating', String(params.minRating));
    if (params?.inStockOnly) query.set('inStock', 'true');
    if (params?.sortBy) query.set('sort', params.sortBy);
    // Hint only — the server ignores it for authorization (scope = session).
    if (params?.sellerId) query.set('sellerId', params.sellerId);

    const qs = query.toString();
    const res = await apiRequest<ProductsResponse>(`/products${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
    return res.products;
  },

  async getProductById(id: string): Promise<Product> {
    const res = await apiRequest<ProductResponse>(`/products/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    return res.product;
  },

  /** Facet list for filter UIs — never a hardcoded category fixture. */
  async getCategories(): Promise<string[]> {
    const res = await apiRequest<CategoriesResponse>('/products/categories', { method: 'GET' });
    return res.categories;
  },

  /** Seller catalog: fetches the authenticated seller's own products (including pending/drafts). */
  async getSellerProducts(): Promise<Product[]> {
    const res = await apiRequest<{ products: Product[] }>('/seller/products', {
      method: 'GET',
    });
    return res.products;
  },

  /** Seller create. The server derives the seller from the session and
   *  ignores any client-supplied sellerId/sellerName/sellerRating. */
  async createProduct(productData: Partial<Product>): Promise<Product> {
    const res = await apiRequest<ProductResponse>('/seller/products', {
      body: JSON.stringify(productData),
    });
    return res.product;
  },

  /** Seller update. Ownership is checked server-side from the session. */
  async updateProduct(id: string, updates: Partial<Product>): Promise<Product> {
    const res = await apiRequest<ProductResponse>(`/seller/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return res.product;
  },

  /** Seller delete. Ownership is checked server-side from the session. */
  async deleteProduct(id: string): Promise<void> {
    await apiRequest<DeleteResponse>(`/seller/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  /** Upload a product image to storage and retrieve its public URL. */
  async uploadProductImage(file: File): Promise<{ storagePath: string; publicUrl: string }> {
    const buffer = await file.arrayBuffer();
    const res = await apiRequest<{ storagePath: string; publicUrl: string }>(
      '/seller/product-images',
      {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: buffer,
      },
    );
    return res;
  },

  /** AI-powered product inspector: analyzes product photo and returns smart auto-fill fields. */
  async analyzeProductImage(payload: {
    imageUrl?: string;
    imageBase64?: string;
    images?: any[];
    productNameHint?: string;
  }): Promise<any> {
    const res = await apiRequest<{ analysis: any }>('/seller/products/analyze-image', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.analysis;
  },
};
