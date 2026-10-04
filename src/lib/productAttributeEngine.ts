/**
 * Dynamic Attribute Engine & Category Intelligence for Seller Products.
 *
 * Dynamically provides relevant attributes, options, and validation based on:
 * Category -> Subcategory -> Product Type.
 */

export interface CategoryAttributeDef {
  id: string;
  label: string;
  type: 'text' | 'select' | 'chips' | 'number' | 'multi-select';
  options?: string[];
  placeholder?: string;
  required?: boolean;
  unit?: string;
  helpText?: string;
}

export interface CategoryIntelligence {
  name: string;
  subcategories: string[];
  productTypes: string[];
  default3D: { geometry: 'watch' | 'furniture' | 'decor' | 'jewelry' | 'electronics'; color: string };
  attributes: CategoryAttributeDef[];
}

export const CATEGORIES_SCHEMA: Record<string, CategoryIntelligence> = {
  'Grocery & Beverages': {
    name: 'Grocery & Beverages',
    subcategories: ['Water & Beverages', 'Packaged Food', 'Cooking Essentials', 'Dairy & Breakfast', 'Snacks & Sweets'],
    productTypes: ['Packaged Drinking Water', 'Mineral Water', 'Soft Drink', 'Fruit Juice', 'Tea / Coffee', 'Rice', 'Wheat / Atta', 'Cooking Oil', 'Biscuits', 'Snacks'],
    default3D: { geometry: 'decor', color: '#0ea5e9' },
    attributes: [
      {
        id: 'capacity',
        label: 'Capacity / Volume',
        type: 'chips',
        options: ['250 ml', '500 ml', '750 ml', '1 L', '1.5 L', '2 L', '3 L', '5 L', '10 L', '20 L'],
        placeholder: 'e.g. 1 L',
        helpText: 'Capacity indicated on the packaging label (e.g. 1 L, 500 ml)',
      },
      {
        id: 'bottle_type',
        label: 'Bottle / Container Type',
        type: 'select',
        options: ['Disposable PET Bottle', 'Reusable Bottle', 'Glass Bottle', 'Tetra Pak', 'Can / Tin', 'Pouch', 'Dispenser Jar'],
      },
      {
        id: 'water_type',
        label: 'Water / Beverage Classification',
        type: 'select',
        options: ['Packaged Drinking Water', 'Natural Mineral Water', 'Spring Water', 'Carbonated Soft Drink', 'Fruit Juice', 'Energy Drink'],
      },
      {
        id: 'pack_quantity',
        label: 'Pack Quantity',
        type: 'select',
        options: ['Single Unit (Pack of 1)', 'Pack of 2', 'Pack of 4', 'Pack of 6', 'Pack of 12', 'Pack of 24'],
      },
      {
        id: 'dietary_type',
        label: 'Dietary Preference',
        type: 'select',
        options: ['Vegetarian', 'Non-Vegetarian', 'Vegan', 'Gluten-Free'],
      },
      {
        id: 'net_weight',
        label: 'Net Weight',
        type: 'chips',
        options: ['100 g', '250 g', '500 g', '1 kg', '2 kg', '5 kg', '10 kg'],
        placeholder: 'e.g. 5 kg',
      },
    ],
  },

  'Fashion & Apparel': {
    name: 'Fashion & Apparel',
    subcategories: ["Men's Clothing", "Women's Clothing", "Kids' Clothing", 'Footwear', 'Bags & Luggage', 'Fashion Accessories'],
    productTypes: ['Shirt', 'T-Shirt', 'Jeans', 'Trousers', 'Dress', 'Kurti / Ethnic', 'Sneakers', 'Formal Shoes', 'Sandals', 'Boots'],
    default3D: { geometry: 'decor', color: '#1e293b' },
    attributes: [
      {
        id: 'size',
        label: 'Size (From Tag)',
        type: 'chips',
        options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', 'Free Size'],
        placeholder: 'e.g. L',
        helpText: 'Primary size detected from label or packaging tag',
      },
      {
        id: 'shoe_size',
        label: 'Footwear Size (UK/India)',
        type: 'chips',
        options: ['5', '6', '7', '8', '9', '10', '11', '12'],
        placeholder: 'e.g. 8',
      },
      {
        id: 'gender',
        label: 'Ideal For (Gender)',
        type: 'select',
        options: ['Men', 'Women', 'Unisex', 'Boys', 'Girls'],
      },
      {
        id: 'color',
        label: 'Primary Color',
        type: 'text',
        placeholder: 'e.g. Navy Blue, Jet Black, Olive Green',
      },
      {
        id: 'material',
        label: 'Fabric / Material',
        type: 'select',
        options: ['100% Cotton', 'Linen', 'Polyester Blend', 'Denim', 'Rayon', 'Silk', 'Leather', 'Canvas', 'Mesh / Knit'],
      },
      {
        id: 'pattern',
        label: 'Pattern / Design',
        type: 'select',
        options: ['Solid', 'Striped', 'Checked', 'Printed', 'Floral', 'Graphic', 'Textured'],
      },
      {
        id: 'fit',
        label: 'Fit Type',
        type: 'select',
        options: ['Slim Fit', 'Regular Fit', 'Relaxed Fit', 'Oversized', 'Skinny Fit'],
      },
      {
        id: 'sleeve_type',
        label: 'Sleeve Length',
        type: 'select',
        options: ['Full Sleeve', 'Half Sleeve', 'Sleeveless', '3/4th Sleeve', 'Roll-up Sleeve'],
      },
      {
        id: 'collar_type',
        label: 'Collar / Neck Style',
        type: 'select',
        options: ['Spread Collar', 'Mandarin / Chinese Collar', 'Button-Down Collar', 'Round Neck', 'V-Neck', 'Polo Collar', 'Hooded'],
      },
    ],
  },

  'Mobiles & Tablets': {
    name: 'Mobiles & Tablets',
    subcategories: ['Smartphones', 'Feature Phones', 'Tablets', 'Mobile Accessories'],
    productTypes: ['Smartphone', 'Tablet', 'Feature Phone'],
    default3D: { geometry: 'electronics', color: '#0f172a' },
    attributes: [
      {
        id: 'ram',
        label: 'RAM (Only if on Box)',
        type: 'chips',
        options: ['4 GB', '6 GB', '8 GB', '12 GB', '16 GB'],
        placeholder: 'e.g. 8 GB',
        helpText: 'Extract only if visibly printed on box or spec label',
      },
      {
        id: 'storage',
        label: 'Internal Storage',
        type: 'chips',
        options: ['64 GB', '128 GB', '256 GB', '512 GB', '1 TB'],
        placeholder: 'e.g. 256 GB',
      },
      {
        id: 'network_type',
        label: 'Network Connectivity',
        type: 'select',
        options: ['5G', '4G LTE', '3G', 'Wi-Fi Only'],
      },
      {
        id: 'color',
        label: 'Color Variant',
        type: 'text',
        placeholder: 'e.g. Midnight Black, Titanium Silver',
      },
      {
        id: 'display_size',
        label: 'Display Screen Size',
        type: 'text',
        placeholder: 'e.g. 6.7 inch Super AMOLED',
      },
      {
        id: 'battery_capacity',
        label: 'Battery Capacity',
        type: 'text',
        placeholder: 'e.g. 5000 mAh',
      },
      {
        id: 'camera',
        label: 'Primary Camera Setup',
        type: 'text',
        placeholder: 'e.g. 50MP + 12MP + 5MP Triple Camera',
      },
    ],
  },

  'Laptops & Computers': {
    name: 'Laptops & Computers',
    subcategories: ['Laptops', 'Desktop PCs', 'Computer Monitors', 'Computer Accessories'],
    productTypes: ['Gaming Laptop', 'Thin & Light Laptop', 'Business Laptop', 'All-in-One PC'],
    default3D: { geometry: 'electronics', color: '#334155' },
    attributes: [
      {
        id: 'processor',
        label: 'Processor / CPU',
        type: 'text',
        placeholder: 'e.g. Intel Core i5 13th Gen / AMD Ryzen 5 7535HS',
        helpText: 'Identified from front keyboard sticker or retail box',
      },
      {
        id: 'ram',
        label: 'System RAM',
        type: 'chips',
        options: ['8 GB', '16 GB', '32 GB', '64 GB'],
        placeholder: 'e.g. 16 GB',
      },
      {
        id: 'storage',
        label: 'Storage Capacity',
        type: 'chips',
        options: ['256 GB SSD', '512 GB SSD', '1 TB SSD', '2 TB SSD', '1 TB HDD'],
        placeholder: 'e.g. 512 GB SSD',
      },
      {
        id: 'gpu',
        label: 'Dedicated Graphics (GPU)',
        type: 'text',
        placeholder: 'e.g. NVIDIA GeForce RTX 2050 (4GB) or Integrated',
      },
      {
        id: 'display_size',
        label: 'Screen Size & Resolution',
        type: 'select',
        options: ['13.3 inch FHD', '14 inch FHD', '15.6 inch FHD 144Hz', '16 inch WQXGA', '17.3 inch QHD'],
      },
      {
        id: 'operating_system',
        label: 'Operating System',
        type: 'select',
        options: ['Windows 11 Home', 'Windows 11 Pro', 'macOS', 'DOS / Linux', 'Chrome OS'],
      },
    ],
  },

  'Electronics & Audio': {
    name: 'Electronics & Audio',
    subcategories: ['Headphones & Earphones', 'Smartwatches', 'Televisions', 'Cameras', 'Speakers & Soundbars'],
    productTypes: ['Wireless Earbuds', 'Over-Ear Headphones', 'Smartwatch', 'Smart TV', 'Digital Camera', 'Bluetooth Speaker'],
    default3D: { geometry: 'electronics', color: '#1e1e1e' },
    attributes: [
      {
        id: 'headphone_type',
        label: 'Form Factor / Type',
        type: 'select',
        options: ['In-Ear True Wireless (TWS)', 'Over-Ear Headphones', 'On-Ear Headphones', 'Neckband', 'Smartwatch', 'Bluetooth Speaker'],
      },
      {
        id: 'connectivity',
        label: 'Connectivity',
        type: 'select',
        options: ['Bluetooth Wireless', 'Wired 3.5mm', 'Wireless + Wired (Hybrid)', 'Type-C'],
      },
      {
        id: 'noise_cancellation',
        label: 'Noise Cancellation',
        type: 'select',
        options: ['Active Noise Cancellation (ANC)', 'Environmental Noise Cancellation (ENC)', 'Passive Noise Isolation', 'None'],
      },
      {
        id: 'battery_life',
        label: 'Battery Playtime',
        type: 'text',
        placeholder: 'e.g. 40 Hours with Case',
      },
      {
        id: 'water_resistance',
        label: 'Water / Sweat Rating',
        type: 'select',
        options: ['IPX4 Sweat Resistant', 'IPX5 Water Resistant', 'IP67 Water & Dustproof', 'IP68 Swim-Proof', 'Not Water Resistant'],
      },
    ],
  },

  'Beauty & Personal Care': {
    name: 'Beauty & Personal Care',
    subcategories: ['Skincare', 'Haircare', 'Makeup & Cosmetics', 'Fragrances', 'Bath & Body'],
    productTypes: ['Face Wash', 'Moisturizer', 'Serum', 'Sunscreen', 'Shampoo', 'Conditioner', 'Lipstick', 'Perfume', 'Body Lotion'],
    default3D: { geometry: 'decor', color: '#f43f5e' },
    attributes: [
      {
        id: 'product_type',
        label: 'Product Subtype',
        type: 'select',
        options: ['Face Wash', 'Daily Moisturizer', 'Face Serum', 'Sunscreen SPF 50+', 'Shampoo', 'Hair Oil', 'Lipstick', 'Eau De Parfum (EDP)', 'Body Wash'],
      },
      {
        id: 'volume_weight',
        label: 'Volume / Net Quantity',
        type: 'chips',
        options: ['30 ml', '50 ml', '100 ml', '150 ml', '200 ml', '250 ml', '500 ml', '50 g', '100 g'],
        placeholder: 'e.g. 100 ml',
        helpText: 'Printed on product front bottle / jar',
      },
      {
        id: 'skin_type',
        label: 'Skin Type Suitability',
        type: 'select',
        options: ['All Skin Types', 'Oily & Acne Prone', 'Dry Skin', 'Combination Skin', 'Sensitive Skin'],
      },
      {
        id: 'key_ingredients',
        label: 'Key Active Ingredients',
        type: 'text',
        placeholder: 'e.g. Vitamin C, Hyaluronic Acid, Salicylic Acid, Tea Tree',
      },
      {
        id: 'fragrance_type',
        label: 'Fragrance',
        type: 'select',
        options: ['Unscented / Fragrance Free', 'Citrus & Fresh', 'Floral', 'Woody & Oriental', 'Mild Natural'],
      },
    ],
  },

  'Home & Kitchen': {
    name: 'Home & Kitchen',
    subcategories: ['Cookware', 'Kitchen Appliances', 'Storage & Containers', 'Dining & Tableware', 'Home Decor'],
    productTypes: ['Pressure Cooker', 'Frying Pan', 'Water Bottle / Flask', 'Storage Container Box', 'Mixer Grinder', 'Dinner Set'],
    default3D: { geometry: 'furniture', color: '#475569' },
    attributes: [
      {
        id: 'capacity',
        label: 'Cookware / Container Capacity',
        type: 'chips',
        options: ['1 L', '1.5 L', '2 L', '3 L', '5 L', '6.5 L', '10 L'],
        placeholder: 'e.g. 3 L',
        helpText: 'Capacity of pressure cooker, pan, or container',
      },
      {
        id: 'material',
        label: 'Body Material',
        type: 'select',
        options: ['Stainless Steel (Tri-ply)', 'Hard Anodized Aluminum', 'Cast Iron', 'Pure Copper', 'Borosilicate Glass', 'BPA-Free Plastic'],
      },
      {
        id: 'induction_compatible',
        label: 'Induction Stove Base',
        type: 'select',
        options: ['Yes (Induction & Gas Compatible)', 'Gas Stove Only', 'Electric Stove Only'],
      },
      {
        id: 'pack_quantity',
        label: 'Pack / Set Count',
        type: 'select',
        options: ['Single Piece (1)', 'Set of 2', 'Set of 3', 'Set of 4', 'Set of 6', 'Set of 12'],
      },
    ],
  },

  'Timepieces': {
    name: 'Timepieces',
    subcategories: ['Luxury Watches', 'Smart Watches', 'Wall Clocks'],
    productTypes: ['Analog Watch', 'Chronograph Watch', 'Automatic Watch', 'Digital Watch'],
    default3D: { geometry: 'watch', color: '#1e293b' },
    attributes: [
      {
        id: 'dial_color',
        label: 'Dial Face Color',
        type: 'text',
        placeholder: 'e.g. Sunray Blue, Midnight Black',
      },
      {
        id: 'strap_material',
        label: 'Strap / Band Material',
        type: 'select',
        options: ['Genuine Leather', 'Stainless Steel Link Bracelet', 'Silicone Rubber', 'Nylon / NATO', 'Ceramic'],
      },
      {
        id: 'water_resistance',
        label: 'Water Resistance Depth',
        type: 'select',
        options: ['30m (3 ATM - Splash Proof)', '50m (5 ATM - Rain/Shower)', '100m (10 ATM - Swimming)', '200m+ (Diver)'],
      },
      {
        id: 'movement_type',
        label: 'Movement Technology',
        type: 'select',
        options: ['Japanese Quartz', 'Swiss Automatic Mechanical', 'Digital Chrono', 'Solar Powered'],
      },
    ],
  },

  'Fine Jewelry': {
    name: 'Fine Jewelry',
    subcategories: ['Rings', 'Necklaces & Pendants', 'Earrings', 'Bracelets'],
    productTypes: ['Solitaire Ring', 'Gold Chain', 'Diamond Studs', 'Bangle'],
    default3D: { geometry: 'jewelry', color: '#eab308' },
    attributes: [
      {
        id: 'metal_type',
        label: 'Precious Metal Type',
        type: 'select',
        options: ['925 Sterling Silver', '18K Yellow Gold', '14K Rose Gold', 'Platinum 950', 'Gold Plated Brass'],
      },
      {
        id: 'gemstone',
        label: 'Gemstone / Stone',
        type: 'select',
        options: ['Solitaire Diamond', 'Cubic Zirconia (CZ)', 'Natural Emerald', 'Blue Sapphire', 'Ruby', 'Pearl', 'No Stone / Plain'],
      },
      {
        id: 'ring_size',
        label: 'Ring Size (Indian/US Standard)',
        type: 'chips',
        options: ['10', '12', '14', '16', '18', '20', '22', 'Adjustable Free Size'],
      },
    ],
  },

  'Stationery & Office': {
    name: 'Stationery & Office',
    subcategories: ['Writing Instruments', 'Notebooks & Paper', 'Desk Accessories', 'Art & Craft'],
    productTypes: ['Pen', 'Pencil', 'Notebook', 'Calculator', 'Highlighter', 'Geometry Box'],
    default3D: { geometry: 'decor', color: '#4338ca' },
    attributes: [
      {
        id: 'pen_type',
        label: 'Pen / Instrument Type',
        type: 'select',
        options: ['Rollerball Pen', 'Gel Ink Pen', 'Fountain Pen', 'Ballpoint Pen', 'Permanent Marker', 'Mechanical Pencil'],
      },
      {
        id: 'ink_color',
        label: 'Ink Color',
        type: 'select',
        options: ['Blue', 'Black', 'Red', 'Multicolor Set'],
      },
      {
        id: 'pack_quantity',
        label: 'Pack Quantity',
        type: 'select',
        options: ['Single Pen (1)', 'Pack of 3', 'Pack of 5', 'Pack of 10', 'Box of 20'],
      },
      {
        id: 'page_count',
        label: 'Notebook Page Count',
        type: 'chips',
        options: ['80 Pages', '120 Pages', '160 Pages', '200 Pages', '300 Pages'],
      },
    ],
  },
};

/** Get the list of main categories */
export const MAIN_CATEGORIES = Object.keys(CATEGORIES_SCHEMA);

/** Returns the category schema or a sensible generic schema */
export function getCategoryIntelligence(categoryName?: string): CategoryIntelligence {
  if (categoryName && CATEGORIES_SCHEMA[categoryName]) {
    return CATEGORIES_SCHEMA[categoryName];
  }
  // Try case-insensitive or partial match
  const lower = String(categoryName || '').toLowerCase();
  for (const [key, schema] of Object.entries(CATEGORIES_SCHEMA)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return schema;
    }
  }
  return CATEGORIES_SCHEMA['Fashion & Apparel'];
}
