/**
 * DB row (snake_case, joined variants/images/seller) → frontend Product
 * (src/types/product.ts camelCase contract). Map everything explicitly —
 * never spread raw rows to the client (§5-76: excessive data exposure).
 *
 * Public catalog rows arrive gated as APPROVED products of APPROVED sellers
 * with ACTIVE profiles (see routes/products.js); this module only SHAPES —
 * it never decides visibility.
 *
 * The DB `product_status` enum is a verification pipeline
 * (DRAFT/SUBMITTED/VERIFICATION/APPROVED/REJECTED) while the frontend speaks
 * PUBLISHED/DRAFT/ARCHIVED. APPROVED maps to PUBLISHED; nothing else is
 * publicly visible (routes/products.js already excludes them).
 */

export const PUBLIC_PRODUCT_STATUS = 'APPROVED';
export const PUBLIC_SELLER_STATUS = 'APPROVED';
export const PUBLIC_PROFILE_STATUS = 'ACTIVE';

const slugify = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

function activeVariants(row) {
  return Array.isArray(row?.variants) ? row.variants.filter((v) => v.is_active !== false) : [];
}

/** Min price over ACTIVE variants; 0 when there are none (honest — no invented price). */
export function minVariantPrice(row) {
  const prices = activeVariants(row)
    .map((v) => Number(v.price))
    .filter((n) => Number.isFinite(n));
  return prices.length ? Math.min(...prices) : 0;
}

export function resolveImageUrl(img, imageBase = '') {
  if (!img) return '';
  if (typeof img === 'string') {
    const s = img.trim();
    if (!s) return '';
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:')) return s;
    if (s.startsWith('/storage/v1/object/public/')) return imageBase ? `${imageBase}${s}` : s;
    const clean = s.replace(/^\/+/, '');
    return imageBase ? `${imageBase}/storage/v1/object/public/product-images/${clean}` : clean;
  }
  if (typeof img === 'object') {
    const path = String(img.storage_path || img.url || img.path || '').trim();
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
    const bucket = encodeURIComponent(img.storage_bucket || 'product-images');
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    return imageBase ? `${imageBase}/storage/v1/object/public/${bucket}/${encodedPath}` : path;
  }
  return '';
}

/** Public storage URLs: primary first, then position order. */
function publicImageUrls(row, imageBase) {
  if (!Array.isArray(row?.images)) return [];
  const images = row.images.slice().sort((a, b) => {
    const primary = Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary));
    if (primary !== 0) return primary;
    return (a.position ?? 0) - (b.position ?? 0);
  });
  const urls = images.map((img) => resolveImageUrl(img, imageBase)).filter(Boolean);
  if (urls.length) return urls;
  if (Array.isArray(row?.verification_meta?.images)) {
    return row.verification_meta.images.map((img) => resolveImageUrl(img, imageBase)).filter(Boolean);
  }
  return [];
}

export function formatProductCode(rawSku, productId) {
  if (rawSku && String(rawSku).startsWith('KNPR-')) {
    return String(rawSku).split('-').slice(0, 2).join('-');
  }
  const match = String(rawSku ?? '').match(/\d{4}/);
  if (match) return `KNPR-${match[0]}`;
  const hex = String(productId ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
  const num = hex ? (parseInt(hex, 16) % 9000 + 1000) : 1001;
  return `KNPR-${num}`;
}

export function extractSpecifications(row) {
  const specs = [];
  const seen = new Set();

  const addSpec = (name, value) => {
    if (!name || value === undefined || value === null) return;
    const cleanName = String(name).trim();
    const cleanVal = String(value).trim();
    if (!cleanName || !cleanVal) return;
    const lowerKey = cleanName.toLowerCase();
    if (seen.has(lowerKey)) return;
    seen.add(lowerKey);
    specs.push({ name: cleanName, value: cleanVal });
  };

  // 1. Stored specifications in verification_meta
  if (Array.isArray(row?.verification_meta?.specifications)) {
    for (const s of row.verification_meta.specifications) {
      if (typeof s === 'object' && s !== null) {
        addSpec(s.name || s.key || s.title || s.label, s.value);
      }
    }
  }

  // 2. Core product attributes
  if (row?.brand) addSpec('Brand', row.brand);
  if (row?.category) addSpec('Category', row.category);
  const sku = (Array.isArray(row?.variants) && row.variants[0]?.sku) || row?.sku || '';
  const productCode = formatProductCode(sku, row?.id);
  if (productCode) addSpec('Product Code', productCode);
  if (sku && sku !== productCode) addSpec('Model / SKU', sku);
  if (row?.material) addSpec('Material', row.material);

  const colors = Array.isArray(row?.colors) ? row.colors.filter(Boolean) : [];
  if (colors.length > 0) {
    addSpec('Available Colors', colors.join(', '));
  } else if (Array.isArray(row?.variants) && row.variants[0]?.color) {
    addSpec('Color', row.variants[0].color);
  }

  // 3. Extract key-value lines from description
  if (typeof row?.description === 'string' && row.description) {
    const lines = row.description.split(/\r?\n|•|\*/);
    for (const line of lines) {
      const match = line.match(/^[\s\-–—]*([A-Za-z0-9\s/&()]{2,35})\s*[:=]\s*(.+)$/);
      if (match) {
        const k = match[1].trim();
        const v = match[2].trim().replace(/\.$/, '');
        if (k.length <= 35 && v.length > 0 && v.length < 150) {
          addSpec(k, v);
        }
      }
    }
  }

  return specs;
}

export function productToPublic(row, imageBase) {
  if (!row) return null;
  const description = row.description ?? '';
  const tagline = (description.split('.')[0] || '').trim().slice(0, 90);
  const dbStatus = String(row.status ?? 'DRAFT');
  const variants = activeVariants(row);
  const stock = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  const sku = variants[0]?.sku ?? '';
  const productCode = formatProductCode(sku, row.id);

  return {
    id: row.id,
    productCode,
    name: row.name ?? '',
    slug: slugify(row.name) || row.id,
    tagline,
    description,
    price: minVariantPrice(row),
    category: row.category ?? '',
    brand: row.brand ?? '',
    material: row.material ?? '',
    colors: Array.isArray(row.colors) ? row.colors : [],
    images: publicImageUrls(row, imageBase),
    stock,
    totalStock: stock,
    balanceStock: stock,
    soldCount: 0,
    sku,
    variants: variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      size: v.size,
      color: v.color,
      price: Number(v.price) || 0,
      stock: Number(v.stock) || 0,
    })),
    // Honest zeroes — no review system or campaign flags exist in the schema
    // yet; a rating is never invented (their phases add real values).
    rating: 0,
    reviewCount: 0,
    sellerId: row.seller_id,
    sellerName: row.seller?.full_name ?? '',
    sellerRating: 0,
    specifications: extractSpecifications(row),
    deliveryEstimateDays: 0,
    returnPolicyDays: 0,
    status: dbStatus === PUBLIC_PRODUCT_STATUS ? 'PUBLISHED' : 'DRAFT',
    approvalStatus: dbStatus,
    createdAt: row.created_at ? String(row.created_at) : '',
    updatedAt: row.updated_at ? String(row.updated_at) : '',
  };
}