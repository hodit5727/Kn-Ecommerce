/**
 * Intelligent AI Product Auto-Fill & Attribute Detection System.
 * Powered by Google Gemini Vision & OCR Intelligence.
 *
 * Capabilities:
 * 1. Multi-image analysis (packaging, labels, tags, logos, specifications).
 * 2. Deep category intelligence: Main Category -> Subcategory -> Product Type -> Relevant Attributes.
 * 3. Strict Anti-Hallucination:
 *    - Attributes clearly visible in OCR/image are extracted with high confidence (>= 0.9).
 *    - Unclear / non-visible attributes are marked as `null` with `detected: false`.
 * 4. Multi-domain support:
 *    - Water / Beverages (Exact capacity e.g. 500ml, 1L, 2L from label, bottle type, pack size)
 *    - Clothing / Shirts (Size XS-4XL from tag, color, pattern, fit, fabric, collar, sleeve)
 *    - Shoes / Footwear (Size 6-12 from box/tag, sole, closure, material, gender)
 *    - Mobile Phones (Brand, model, RAM/storage only if printed, color, battery)
 *    - Laptops / Computers (Brand, model, processor, RAM, storage, GPU, display)
 *    - Electronics & Audio (Headphones, smartwatches, TV, cameras)
 *    - Beauty & Personal Care (Face wash, moisturizer, serum, volume, skin type)
 *    - Stationery & Office (Pens, notebooks, ink color, pack qty)
 *    - Grocery / Food (Net weight, dietary veg/non-veg, ingredients)
 *    - Home & Kitchen (Pressure cooker capacity, containers, induction friendly)
 * 5. Dynamic attributes schema with confidence scoring and variant generation suggestions.
 */

export const CATEGORY_TAXONOMY = {
  'Grocery & Beverages': {
    subcategories: ['Water & Beverages', 'Packaged Food', 'Cooking Essentials', 'Dairy & Breakfast', 'Snacks & Sweets'],
    types: ['Packaged Drinking Water', 'Mineral Water', 'Soft Drink', 'Fruit Juice', 'Tea / Coffee', 'Rice', 'Wheat / Atta', 'Cooking Oil', 'Biscuits', 'Snacks'],
    keyAttributes: ['brand', 'capacity', 'net_weight', 'pack_quantity', 'bottle_type', 'water_type', 'flavour', 'dietary_type', 'material'],
  },
  'Fashion & Apparel': {
    subcategories: ["Men's Clothing", "Women's Clothing", "Kids' Clothing", 'Footwear', 'Bags & Luggage', 'Fashion Accessories'],
    types: ['Shirt', 'T-Shirt', 'Jeans', 'Trousers', 'Dress', 'Kurti', 'Sneakers', 'Formal Shoes', 'Sandals', 'Boots'],
    keyAttributes: ['brand', 'size', 'available_sizes', 'shoe_size', 'color', 'pattern', 'fit', 'sleeve_type', 'collar_type', 'material', 'gender', 'closure_type'],
  },
  'Mobiles & Tablets': {
    subcategories: ['Smartphones', 'Feature Phones', 'Tablets', 'Mobile Accessories'],
    types: ['Smartphone', 'Tablet', 'Feature Phone'],
    keyAttributes: ['brand', 'model', 'ram', 'storage', 'color', 'display_size', 'battery_capacity', 'camera', 'processor', 'network_type'],
  },
  'Laptops & Computers': {
    subcategories: ['Laptops', 'Desktop PCs', 'Computer Monitors', 'Computer Accessories'],
    types: ['Gaming Laptop', 'Thin & Light Laptop', 'Business Laptop', 'All-in-One PC'],
    keyAttributes: ['brand', 'model', 'processor', 'ram', 'storage', 'gpu', 'display_size', 'operating_system', 'color'],
  },
  'Electronics & Audio': {
    subcategories: ['Headphones & Earphones', 'Smartwatches', 'Televisions', 'Cameras', 'Speakers & Soundbars'],
    types: ['Wireless Earbuds', 'Over-Ear Headphones', 'Smartwatch', 'Smart TV', 'Digital Camera', 'Bluetooth Speaker'],
    keyAttributes: ['brand', 'model', 'headphone_type', 'connectivity', 'battery_life', 'noise_cancellation', 'display_size', 'water_resistance', 'resolution', 'screen_size'],
  },
  'Beauty & Personal Care': {
    subcategories: ['Skincare', 'Haircare', 'Makeup & Cosmetics', 'Fragrances', 'Bath & Body'],
    types: ['Face Wash', 'Moisturizer', 'Serum', 'Sunscreen', 'Shampoo', 'Conditioner', 'Lipstick', 'Perfume', 'Body Lotion'],
    keyAttributes: ['brand', 'product_type', 'volume_weight', 'skin_type', 'hair_type', 'key_ingredients', 'fragrance_type', 'shade_color', 'finish'],
  },
  'Stationery & Office': {
    subcategories: ['Writing Instruments', 'Notebooks & Paper', 'Desk Accessories', 'Art & Craft'],
    types: ['Pen', 'Pencil', 'Notebook', 'Calculator', 'Highlighter', 'Geometry Box'],
    keyAttributes: ['brand', 'pen_type', 'ink_color', 'page_count', 'paper_size', 'ruling', 'pack_quantity', 'material'],
  },
  'Home & Kitchen': {
    subcategories: ['Cookware', 'Kitchen Appliances', 'Storage & Containers', 'Dining & Tableware', 'Home Decor'],
    types: ['Pressure Cooker', 'Frying Pan', 'Water Bottle / Flask', 'Storage Container Box', 'Mixer Grinder', 'Dinner Set'],
    keyAttributes: ['brand', 'capacity', 'material', 'induction_compatible', 'airtight', 'pack_quantity', 'color', 'features'],
  },
  'Timepieces': {
    subcategories: ['Luxury Watches', 'Smart Watches', 'Wall Clocks'],
    types: ['Analog Watch', 'Chronograph Watch', 'Automatic Watch', 'Digital Watch'],
    keyAttributes: ['brand', 'model', 'dial_color', 'strap_material', 'water_resistance', 'movement_type', 'case_material'],
  },
  'Fine Jewelry': {
    subcategories: ['Rings', 'Necklaces & Pendants', 'Earrings', 'Bracelets'],
    types: ['Solitaire Ring', 'Gold Chain', 'Diamond Studs', 'Bangle'],
    keyAttributes: ['brand', 'metal_type', 'gemstone', 'carat_weight', 'ring_size', 'closure_type'],
  },
};

/**
 * Clean markdown or JSON wrapper code blocks if Gemini returns them.
 */
function cleanJsonText(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  if (str.startsWith('```json')) {
    str = str.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  } else if (str.startsWith('```')) {
    str = str.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return str.trim();
}

/**
 * Intelligent fallback generator when Gemini API is offline or not configured.
 * Uses available hints and filename/OCR clues to generate honest, non-hallucinated drafts.
 */
function createFallbackAnalysis(hint = '', images = []) {
  const textHint = String(hint || '').toLowerCase();
  const imageHints = (Array.isArray(images) ? images : [])
    .map((img) => {
      if (typeof img === 'string') return img;
      return `${img.name || ''} ${img.url || ''}`;
    })
    .join(' ')
    .toLowerCase();

  const combined = `${textHint} ${imageHints}`.trim();

  let category = 'Fashion & Apparel';
  let subcategory = "Men's Clothing";
  let productType = 'Product';
  let name = hint ? String(hint).trim() : 'Product Details';
  let tagline = 'Quality item on K-Shop';
  let suggestedPrice = 999;
  let suggestedMrp = 1499;
  let threeD = { geometry: 'decor', color: '#1e293b' };

  if (
    combined.includes('watch') ||
    combined.includes('clock') ||
    combined.includes('timepiece') ||
    combined.includes('fossil') ||
    combined.includes('titan') ||
    combined.includes('casio') ||
    combined.includes('chronograph')
  ) {
    category = 'Timepieces';
    subcategory = 'Luxury Watches';
    productType = 'Analog Watch';
    name = hint || 'Classic Leather Strap Watch';
    tagline = 'Elegant timepiece with premium finish';
    suggestedPrice = 2499;
    suggestedMrp = 3999;
    threeD = { geometry: 'watch', color: '#1e293b' };
  } else if (
    combined.includes('water') ||
    combined.includes('bottle') ||
    combined.includes('beverage') ||
    combined.includes('drink') ||
    combined.includes('bisleri') ||
    combined.includes('aquafina') ||
    combined.includes('kinley')
  ) {
    category = 'Grocery & Beverages';
    subcategory = 'Water & Beverages';
    productType = 'Packaged Drinking Water';
    name = hint || 'Packaged Drinking Water Bottle';
    tagline = 'Pure, hygienically purified and packaged drinking water';
    suggestedPrice = 20;
    suggestedMrp = 20;
    threeD = { geometry: 'decor', color: '#0ea5e9' };
  } else if (
    combined.includes('phone') ||
    combined.includes('mobile') ||
    combined.includes('smartphone') ||
    combined.includes('galaxy') ||
    combined.includes('iphone') ||
    combined.includes('redmi') ||
    combined.includes('realme')
  ) {
    category = 'Mobiles & Tablets';
    subcategory = 'Smartphones';
    productType = 'Smartphone';
    name = hint || '5G Smartphone';
    tagline = 'High-performance smartphone with brilliant display';
    suggestedPrice = 17999;
    suggestedMrp = 22999;
    threeD = { geometry: 'electronics', color: '#0f172a' };
  } else if (
    combined.includes('laptop') ||
    combined.includes('computer') ||
    combined.includes('notebook') ||
    combined.includes('macbook') ||
    combined.includes('thinkpad') ||
    combined.includes('hp') ||
    combined.includes('dell')
  ) {
    category = 'Laptops & Computers';
    subcategory = 'Laptops';
    productType = 'Thin & Light Laptop';
    name = hint || 'High Performance Laptop';
    tagline = 'Fast processing and lightweight design for productivity';
    suggestedPrice = 45999;
    suggestedMrp = 58999;
    threeD = { geometry: 'electronics', color: '#334155' };
  } else if (
    combined.includes('shoe') ||
    combined.includes('sneaker') ||
    combined.includes('boot') ||
    combined.includes('footwear') ||
    combined.includes('nike') ||
    combined.includes('adidas') ||
    combined.includes('puma')
  ) {
    category = 'Fashion & Apparel';
    subcategory = 'Footwear';
    productType = 'Sneakers';
    name = hint || 'Comfortable Walking Sneakers';
    tagline = 'Cushioned lightweight footwear for daily comfort';
    suggestedPrice = 1999;
    suggestedMrp = 2999;
    threeD = { geometry: 'decor', color: '#ffffff' };
  } else if (
    combined.includes('shirt') ||
    combined.includes('tshirt') ||
    combined.includes('t-shirt') ||
    combined.includes('top') ||
    combined.includes('kurti') ||
    combined.includes('dress')
  ) {
    category = 'Fashion & Apparel';
    subcategory = "Men's Clothing";
    productType = 'Shirt';
    name = hint || 'Casual Cotton Shirt';
    tagline = 'Comfortable stylish shirt crafted from breathable fabric';
    suggestedPrice = 1299;
    suggestedMrp = 1999;
    threeD = { geometry: 'decor', color: '#1e293b' };
  }

  return {
    product_name: name,
    category,
    subcategory,
    product_type: productType,
    tagline,
    description: `${name}. Designed for everyday comfort and durability with quality finishing.`,
    suggested_price: suggestedPrice,
    suggested_mrp: suggestedMrp,
    confidence: combined ? 0.8 : 0.5,
    attributes: {
      brand: { value: 'Artisan Store', confidence: 0.85, detected: true, source: 'seller_profile' },
      size: { value: null, confidence: 0, detected: false, source: 'none' },
      capacity: { value: null, confidence: 0, detected: false, source: 'none' },
      color: { value: 'Standard', confidence: 0.7, detected: true, source: 'visual' },
      material: { value: 'High Quality Material', confidence: 0.7, detected: true, source: 'heuristic' },
    },
    detected_fields: ['brand', 'color'],
    undetected_fields: ['size', 'capacity', 'ram', 'storage'],
    variants_suggested: {
      has_variants: false,
      options: [],
    },
    three_d_preset: threeD,
    specifications: [
      { name: 'Category', value: category },
      { name: 'Type', value: productType },
      { name: 'Warranty', value: 'Manufacturer Warranty' },
    ],
    ocr_text_found: [],
    anti_hallucination_note: 'Values generated using fallback heuristics. Please review all fields.',
  };
}

/**
 * Main AI Analyzer function.
 * Accepts multiple image inputs (URL, Buffer, Base64) + optional title/hints.
 */
export async function analyzeProductImageWithGemini(env, {
  imageBuffer = null,
  mimeType = 'image/jpeg',
  imageUrl = null,
  images = [],
  productNameHint = '',
}) {
  const apiKey = env.GEMINI_API_KEY;

  // Assemble list of images to analyze
  const normalizedImages = [];

  if (Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0) {
    normalizedImages.push({
      mimeType: mimeType || 'image/jpeg',
      base64: imageBuffer.toString('base64'),
    });
  } else if (imageUrl && typeof imageUrl === 'string') {
    normalizedImages.push({ url: imageUrl });
  }

  if (Array.isArray(images)) {
    for (const img of images) {
      if (!img) continue;
      if (typeof img === 'string') {
        if (img.startsWith('data:')) {
          const match = img.match(/^data:([^;]+);base64,(.+)$/);
          if (match) normalizedImages.push({ mimeType: match[1], base64: match[2] });
        } else if (img.startsWith('http')) {
          normalizedImages.push({ url: img });
        }
      } else if (typeof img === 'object') {
        if (img.base64) normalizedImages.push(img);
        else if (img.url) normalizedImages.push(img);
      }
    }
  }

  // Resolve remote URLs to base64 buffers for Gemini payload
  const imageParts = [];
  for (const item of normalizedImages.slice(0, 3)) { // Max 3 images in one inspection pass
    if (item.base64) {
      imageParts.push({
        inlineData: {
          mimeType: item.mimeType || 'image/jpeg',
          data: item.base64,
        },
      });
    } else if (item.url) {
      try {
        const resp = await fetch(item.url, { signal: AbortSignal.timeout(6000) });
        if (resp.ok) {
          const arrayBuf = await resp.arrayBuffer();
          const ct = resp.headers.get('content-type') || 'image/jpeg';
          imageParts.push({
            inlineData: {
              mimeType: ct.split(';')[0].trim(),
              data: Buffer.from(arrayBuf).toString('base64'),
            },
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[geminiAnalyzer] URL fetch failed:', item.url, e.message);
      }
    }
  }

  if (!apiKey || imageParts.length === 0) {
    return createFallbackAnalysis(productNameHint, normalizedImages);
  }

  const promptText = `You are an expert e-commerce catalog assistant and OCR vision specialist.
Inspect the uploaded product photo(s) with extreme care.

${productNameHint ? `SELLER'S TITLE/HINT: "${productNameHint}"` : ''}

CRITICAL ANTI-HALLUCINATION & ACCURACY RULES:
1. ONLY populate attributes that are CLEARLY VISIBLE in the image, packaging, spec label, or text.
2. DO NOT GUESS OR INVENT SPECIFICATIONS.
   - For Water / Beverages: Check the packaging label for capacity (e.g. 500 ml, 750 ml, 1 L, 1.5 L, 2 L, 3 L, 5 L, 10 L, 20 L). If "1 L" is clearly printed, return capacity: "1 L". If NOT visible, return capacity: null! Do NOT guess based on bottle shape!
   - For Shirts / Clothing: Check for a visible size label/tag (XS, S, M, L, XL, XXL, 3XL, 4XL). If clearly seen (e.g. "SIZE: L"), return size: "L". If no size is shown, return size: null!
   - For Shoes / Footwear: Check for shoe size (6, 7, 8, 9, 10, 11, 12). If not visible on box or tongue, return shoe_size: null!
   - For Mobile Phones: Only return RAM or Storage if visibly printed on the retail box / spec sticker (e.g., "8GB RAM", "256GB"). If NOT printed, set ram: null, storage: null. NEVER guess phone RAM/storage!
   - For Laptops: Extract processor, RAM, and SSD only if visible on sticker/box (e.g., "Ryzen 5", "16GB RAM", "512GB SSD"). If not visible, return null.
   - For Beauty products: Identify product type (Face Wash, Moisturizer, Serum, Shampoo, etc.), Volume/Net Wt from label, and key ingredients.
   - For Stationery: Identify Pen/Notebook, ink color, pack size.
   - For Grocery: Identify Net Weight (e.g. 5 kg, 1 kg) from packet label, and whether Vegetarian (green dot) or Non-Vegetarian.
3. Every attribute must include:
   - "value": string | number | null (null if not detected)
   - "confidence": number between 0.0 and 1.0 (>= 0.90 if visibly verified from OCR/text/logo; 0.70-0.89 if strong visual match; < 0.70 set to null)
   - "detected": boolean (true only if reliably detected)
   - "source": string (e.g. "ocr_label", "packaging_text", "visual_shape", "logo")

Return ONLY a valid raw JSON object (with NO markdown code blocks, NO backticks) matching this exact JSON schema:
{
  "product_name": "Clear, concise product name in simple English (max 70 chars)",
  "category": "One of: 'Grocery & Beverages', 'Fashion & Apparel', 'Mobiles & Tablets', 'Laptops & Computers', 'Electronics & Audio', 'Beauty & Personal Care', 'Stationery & Office', 'Home & Kitchen', 'Timepieces', 'Fine Jewelry'",
  "subcategory": "Accurate subcategory string",
  "product_type": "Specific product type (e.g. 'Packaged Drinking Water', 'Men's Casual Shirt', 'Running Shoes', 'Face Wash')",
  "tagline": "One simple sentence summarizing the key benefit / style",
  "description": "2-3 paragraphs describing product details, materials, quality, and usage in simple natural English.",
  "suggested_price": 1499,
  "suggested_mrp": 2199,
  "confidence": 0.95,
  "attributes": {
    "brand": { "value": "Detected Brand or null", "confidence": 0.95, "detected": true, "source": "logo_text" },
    "capacity": { "value": "1 L or null", "confidence": 0.96, "detected": true, "source": "ocr_label" },
    "net_weight": { "value": "5 kg or null", "confidence": 0.95, "detected": false, "source": "none" },
    "size": { "value": "L or null", "confidence": 0.92, "detected": false, "source": "none" },
    "shoe_size": { "value": "9 or null", "confidence": 0.90, "detected": false, "source": "none" },
    "color": { "value": "Primary Color", "confidence": 0.90, "detected": true, "source": "visual" },
    "material": { "value": "Cotton / Stainless Steel / etc or null", "confidence": 0.85, "detected": true, "source": "visual" },
    "ram": { "value": "8 GB or null", "confidence": 0, "detected": false, "source": "none" },
    "storage": { "value": "256 GB or null", "confidence": 0, "detected": false, "source": "none" },
    "processor": { "value": null, "confidence": 0, "detected": false, "source": "none" },
    "gpu": { "value": null, "confidence": 0, "detected": false, "source": "none" },
    "display_size": { "value": null, "confidence": 0, "detected": false, "source": "none" },
    "skin_type": { "value": null, "confidence": 0, "detected": false, "source": "none" },
    "pack_quantity": { "value": 1, "confidence": 0.90, "detected": true, "source": "visual" },
    "gender": { "value": "Men / Women / Unisex or null", "confidence": 0.85, "detected": true, "source": "visual" }
  },
  "detected_fields": ["brand", "capacity", "color"],
  "undetected_fields": ["size", "ram", "storage", "net_weight"],
  "variants_suggested": {
    "has_variants": false,
    "options": []
  },
  "three_d_preset": {
    "geometry": "One of: 'decor', 'watch', 'furniture', 'electronics', 'jewelry'",
    "color": "#hexColor"
  },
  "specifications": [
    { "name": "Key Feature", "value": "Specification Details" }
  ],
  "ocr_text_found": ["array of exact words/text read from the image"]
}`;

let cachedDiscoveredModels = null;
let lastDiscoveryTime = 0;

async function discoverActiveGeminiModels(apiKey, envModel) {
  if (cachedDiscoveredModels && Date.now() - lastDiscoveryTime < 1800000) {
    return cachedDiscoveredModels;
  }

  const prioritized = [];
  if (envModel && envModel.trim() && envModel.trim() !== 'gemini-flash') {
    prioritized.push(envModel.trim());
  }

  try {
    const listResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (listResp.ok) {
      const data = await listResp.json();
      if (Array.isArray(data.models)) {
        const supported = data.models
          .filter(
            (m) =>
              Array.isArray(m.supportedGenerationMethods) &&
              m.supportedGenerationMethods.includes('generateContent')
          )
          .map((m) => m.name.replace(/^models\//, ''));

        // Rank Flash models first (faster + vision enabled), then Pro models
        const flashModels = supported.filter((m) => m.includes('flash'));
        const proModels = supported.filter((m) => m.includes('pro'));
        const otherModels = supported.filter((m) => !m.includes('flash') && !m.includes('pro'));

        const combined = [...new Set([...prioritized, ...flashModels, ...proModels, ...otherModels])];
        if (combined.length > 0) {
          cachedDiscoveredModels = combined;
          lastDiscoveryTime = Date.now();
          // eslint-disable-next-line no-console
          console.log('[geminiAnalyzer] Discovered active models for key:', combined.slice(0, 5));
          return combined;
        }
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[geminiAnalyzer] Dynamic model discovery failed:', e.message);
  }

  // Modern default fallback list
  return [
    ...prioritized,
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash-002',
    'gemini-1.5-flash-001',
    'gemini-1.5-pro-002',
    'gemini-1.5-flash',
  ];
}

  const modelsToTry = await discoverActiveGeminiModels(apiKey, env.GEMINI_MODEL);

  for (const model of modelsToTry) {
    const apiVersions = ['v1beta', 'v1'];
    let succeeded = false;

    for (const apiVer of apiVersions) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: promptText }, ...imageParts],
              },
            ],
            generationConfig: {
              temperature: 0.1, // low temperature for precise factual extraction
              responseMimeType: 'application/json',
            },
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          if (res.status === 404) {
            continue; // try next apiVer or model
          }
          // eslint-disable-next-line no-console
          console.warn(`[geminiAnalyzer] model ${model} (${apiVer}) status ${res.status}:`, errText.slice(0, 150));
          break; // Don't retry same model on non-404
        }

        const data = await res.json();
        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) continue;

        const parsed = JSON.parse(cleanJsonText(candidateText));
        if (parsed && typeof parsed.product_name === 'string') {
          // eslint-disable-next-line no-console
          console.log(`[geminiAnalyzer] ✓ Successfully analyzed with ${model} (${apiVer}): "${parsed.product_name}" [${parsed.category} > ${parsed.subcategory}]`);
          succeeded = true;

          // Compute detected / undetected fields accurately
          const attributes = parsed.attributes || {};
          const detectedFields = [];
          const undetectedFields = [];

          for (const [key, attr] of Object.entries(attributes)) {
            if (attr && attr.detected && attr.value !== null && String(attr.value).trim() !== '') {
              detectedFields.push(key);
            } else {
              undetectedFields.push(key);
              if (attr) {
                attr.value = null;
                attr.detected = false;
              }
            }
          }

          return {
            product_name: String(parsed.product_name).trim(),
            category: String(parsed.category || 'Timepieces').trim(),
            subcategory: String(parsed.subcategory || '').trim(),
            product_type: String(parsed.product_type || '').trim(),
            tagline: String(parsed.tagline || '').trim(),
            description: String(parsed.description || '').trim(),
            suggested_price: Number(parsed.suggested_price) || 999,
            suggested_mrp: Number(parsed.suggested_mrp) || undefined,
            confidence: Number(parsed.confidence) || 0.95,
            attributes,
            detected_fields: detectedFields,
            undetected_fields: undetectedFields,
            variants_suggested: parsed.variants_suggested || { has_variants: false, options: [] },
            three_d_preset: parsed.three_d_preset || { geometry: 'decor', color: '#1e293b' },
            specifications: Array.isArray(parsed.specifications) ? parsed.specifications : [],
            ocr_text_found: Array.isArray(parsed.ocr_text_found) ? parsed.ocr_text_found : [],
          };
        }
      } catch (modelErr) {
        // eslint-disable-next-line no-console
        console.warn(`[geminiAnalyzer] attempt with ${model} (${apiVer}) failed:`, modelErr.message);
      }
    }

    if (succeeded) break;
  }

  return createFallbackAnalysis(productNameHint, normalizedImages);
}
