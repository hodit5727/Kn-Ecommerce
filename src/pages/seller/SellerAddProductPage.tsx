import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { productService } from '../../services/productService';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Input } from '../../components/common/Input';
import { Select } from '../../components/common/Select';
import { Button } from '../../components/common/Button';
import {
  MAIN_CATEGORIES,
  getCategoryIntelligence,
  CategoryIntelligence,
} from '../../lib/productAttributeEngine';
import {
  Package,
  IndianRupee,
  Boxes,
  Truck,
  CheckCircle2,
  Plus,
  Trash2,
  Sparkles,
  Upload,
  RefreshCw,
  Check,
  X,
  Sliders,
  Tag,
  ArrowRight,
  ArrowLeft,
  Camera,
  Layers,
} from 'lucide-react';

interface UploadedImage {
  id: string;
  url: string;
  base64?: string;
  isPrimary?: boolean;
}

interface AttributeStateItem {
  value: string;
  confidence?: number;
  detected?: boolean;
  source?: string;
}

interface VariantRow {
  sku: string;
  size?: string;
  color?: string;
  price: number;
  stock: number;
}

/**
 * Fast client-side image downscaler.
 * Reduces raw 5-10MB phone camera uploads to a crisp, high-detail 1000px JPEG (~100KB)
 * so AI vision analysis payload never exceeds network limits or body-parser caps.
 */
function compressImageForAi(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_DIM = 1000;
        let width = img.width;
        let height = img.height;
        if (width > height && width > MAX_DIM) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else if (height > MAX_DIM) {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } else {
          resolve((e.target?.result as string) || '');
        }
      };
      img.onerror = () => resolve((e.target?.result as string) || '');
      img.src = (e.target?.result as string) || '';
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

const DRAFT_STORAGE_KEY = 'kshop_seller_product_draft';

function loadSavedDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const SellerAddProductPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load draft from browser session if present (persists across page refresh)
  const savedDraft = useRef(loadSavedDraft()).current;

  // Stepper: 1 = Photos & AI Vision, 2 = Details & Attributes
  const [currentStep, setCurrentStep] = useState<1 | 2>(savedDraft?.currentStep || 1);

  // 1. Uploaded Images State
  const [images, setImages] = useState<UploadedImage[]>(savedDraft?.images || []);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // 2. Category Intelligence
  const [category, setCategory] = useState<string>(savedDraft?.category || 'Fashion & Apparel');
  const [subcategory, setSubcategory] = useState<string>(savedDraft?.subcategory || "Men's Clothing");
  const [productType, setProductType] = useState<string>(savedDraft?.productType || 'Shirt');
  const [categoryIntel, setCategoryIntel] = useState<CategoryIntelligence>(
    getCategoryIntelligence(savedDraft?.category || 'Fashion & Apparel')
  );

  // 3. Dynamic Attributes (Derived directly from Gemini AI analysis or seller additions)
  const [attributesState, setAttributesState] = useState<Record<string, AttributeStateItem>>(
    savedDraft?.attributesState || {}
  );
  const [newAttrKey, setNewAttrKey] = useState('');
  const [newAttrVal, setNewAttrVal] = useState('');

  const [name, setName] = useState(savedDraft?.name || '');
  const [brand, setBrand] = useState(savedDraft?.brand || user?.sellerStoreName || 'Artisan Store');
  const [productColor, setProductColor] = useState(savedDraft?.productColor || '');
  const [tagline, setTagline] = useState(savedDraft?.tagline || '');
  const [description, setDescription] = useState(savedDraft?.description || '');
  const [price, setPrice] = useState<number>(savedDraft?.price ?? 900);
  const [originalPrice, setOriginalPrice] = useState<number | undefined>(savedDraft?.originalPrice ?? 1000);
  const [discountPercent, setDiscountPercent] = useState<number>(savedDraft?.discountPercent ?? 10);
  const [stock, setStock] = useState<number>(savedDraft?.stock ?? 15);
  const [sku, setSku] = useState(savedDraft?.sku || '');
  const [threeDGeometry, setThreeDGeometry] = useState<'watch' | 'furniture' | 'decor' | 'jewelry' | 'electronics'>(
    savedDraft?.threeDGeometry || 'decor'
  );
  const [threeDColor, setThreeDColor] = useState(savedDraft?.threeDColor || '#1e293b');

  // Two-way reactive price & discount calculation
  const handleOriginalPriceChange = (val: number | undefined) => {
    setOriginalPrice(val);
    if (val && val > 0) {
      if (discountPercent > 0) {
        const calculatedPrice = Math.max(1, Math.round(val - (val * discountPercent) / 100));
        setPrice(calculatedPrice);
      } else if (price > 0 && val > price) {
        const calculatedDiscount = Math.round(((val - price) / val) * 100);
        setDiscountPercent(calculatedDiscount);
      }
    }
  };

  const handleDiscountPercentChange = (pct: number) => {
    const clamped = Math.max(0, Math.min(99, pct || 0));
    setDiscountPercent(clamped);
    if (originalPrice && originalPrice > 0) {
      const calculatedPrice = Math.max(1, Math.round(originalPrice - (originalPrice * clamped) / 100));
      setPrice(calculatedPrice);
    } else if (price > 0 && clamped < 100) {
      const impliedMrp = Math.round(price / (1 - clamped / 100));
      setOriginalPrice(impliedMrp);
    }
  };

  const handleSellingPriceChange = (newPrice: number) => {
    setPrice(newPrice);
    if (originalPrice && originalPrice > newPrice && originalPrice > 0) {
      const calculatedDiscount = Math.round(((originalPrice - newPrice) / originalPrice) * 100);
      setDiscountPercent(calculatedDiscount);
    } else if (originalPrice && newPrice >= originalPrice) {
      setDiscountPercent(0);
    }
  };

  // 5. Custom Specifications & Variants
  const [specifications, setSpecifications] = useState<{ name: string; value: string }[]>(
    savedDraft?.specifications || [{ name: 'Warranty', value: '1 Year Manufacturer Warranty' }]
  );
  const [hasVariants, setHasVariants] = useState(savedDraft?.hasVariants || false);
  const [variantSizes, setVariantSizes] = useState<string[]>(savedDraft?.variantSizes || []);
  const [variantColors, setVariantColors] = useState<string[]>(savedDraft?.variantColors || []);
  const [variantRows, setVariantRows] = useState<VariantRow[]>(savedDraft?.variantRows || []);

  // 6. Shipping & Policy
  const [deliveryDays, setDeliveryDays] = useState(savedDraft?.deliveryDays ?? 3);
  const [returnDays, setReturnDays] = useState(savedDraft?.returnDays ?? 14);
  const [status, setStatus] = useState<'PUBLISHED' | 'DRAFT'>(savedDraft?.status || 'PUBLISHED');

  // 7. AI Analysis Progress & Review Modal State
  const [isAnalyzingAi, setIsAnalyzingAi] = useState(false);
  const [aiProgressStage, setAiProgressStage] = useState<string>('');
  const [aiReviewSummary, setAiReviewSummary] = useState<{
    show: boolean;
    productName: string;
    category: string;
    subcategory: string;
    productType: string;
    confidence: number;
    detectedFields: string[];
    undetectedFields: string[];
    ocrWords: string[];
  } | null>(savedDraft?.aiReviewSummary || null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdProductInfo, setCreatedProductInfo] = useState<{
    name: string;
    productCode: string;
    image?: string;
  } | null>(null);

  // Auto-save form draft to browser session storage on every change
  useEffect(() => {
    if (images.length > 0 || name.trim() || Object.keys(attributesState).length > 0) {
      try {
        const draft = {
          currentStep,
          images,
          category,
          subcategory,
          productType,
          attributesState,
          name,
          brand,
          productColor,
          tagline,
          description,
          price,
          originalPrice,
          discountPercent,
          stock,
          sku,
          threeDGeometry,
          threeDColor,
          specifications,
          hasVariants,
          variantSizes,
          variantColors,
          variantRows,
          deliveryDays,
          returnDays,
          status,
          aiReviewSummary,
        };
        sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } catch {
        // Safe fail on storage cap
      }
    }
  }, [
    currentStep,
    images,
    category,
    subcategory,
    productType,
    attributesState,
    name,
    brand,
    productColor,
    tagline,
    description,
    price,
    originalPrice,
    discountPercent,
    stock,
    sku,
    threeDGeometry,
    threeDColor,
    specifications,
    hasVariants,
    variantSizes,
    variantColors,
    variantRows,
    deliveryDays,
    returnDays,
    status,
    aiReviewSummary,
  ]);

  const handleClearDraft = () => {
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {}
    setImages([]);
    setName('');
    setProductColor('');
    setTagline('');
    setDescription('');
    setPrice(900);
    setOriginalPrice(1000);
    setDiscountPercent(10);
    setStock(15);
    setAttributesState({});
    setAiReviewSummary(null);
    setCurrentStep(1);
    showToast('Product draft cleared.', 'info');
  };

  // Update Category Intelligence whenever category changes
  useEffect(() => {
    const intel = getCategoryIntelligence(category);
    setCategoryIntel(intel);
    if (!intel.subcategories.includes(subcategory)) {
      setSubcategory(intel.subcategories[0] || '');
    }
    if (!intel.productTypes.includes(productType)) {
      setProductType(intel.productTypes[0] || '');
    }
    setThreeDGeometry(intel.default3D.geometry);
    setThreeDColor(intel.default3D.color);
  }, [category]);

  // Generate a product SKU / code adhering to KNPR-4digit
  const generateSku = () => {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    setSku(`KNPR-${randomDigits}`);
  };

  useEffect(() => {
    if (!sku) generateSku();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update variant rows whenever sizes or colors change
  useEffect(() => {
    if (!hasVariants) {
      setVariantRows([]);
      return;
    }

    const sizes = variantSizes.length > 0 ? variantSizes : ['Standard'];
    const colors = variantColors.length > 0 ? variantColors : ['Standard'];

    setVariantRows((prevRows) => {
      const newRows: VariantRow[] = [];
      sizes.forEach((s) => {
        colors.forEach((c) => {
          const sizeTag = s !== 'Standard' ? s : '';
          const colorTag = c !== 'Standard' ? c : '';
          const comboSku = `${sku || 'SKU'}-${sizeTag ? sizeTag + '-' : ''}${colorTag ? colorTag : 'DEF'}`
            .toUpperCase()
            .replace(/\s+/g, '');

          // Check if seller already configured this variant to preserve their stock and price
          const existing = prevRows.find(
            (r) =>
              r.sku === comboSku ||
              (r.size === (s !== 'Standard' ? s : undefined) && r.color === (c !== 'Standard' ? c : undefined))
          );

          newRows.push({
            sku: comboSku,
            size: s !== 'Standard' ? s : undefined,
            color: c !== 'Standard' ? c : undefined,
            price: existing?.price ?? price,
            stock: existing?.stock ?? Math.max(1, stock), // Do NOT auto-divide stock into 5 & 5! Seller sets count
          });
        });
      });
      return newRows;
    });
  }, [hasVariants, variantSizes, variantColors, sku]);

  // Image upload handler
  const handleAddImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file (PNG, JPG, WEBP).', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('Image file exceeds the 10MB size limit.', 'error');
      return;
    }

    setIsUploadingImage(true);
    try {
      const compressedBase64 = await compressImageForAi(file);
      const res = await productService.uploadProductImage(file);
      const newImg: UploadedImage = {
        id: Math.random().toString(36).slice(2),
        url: res.publicUrl,
        base64: compressedBase64,
        isPrimary: images.length === 0,
      };

      const updatedImages = [...images, newImg];
      setImages(updatedImages);
      showToast('Image uploaded successfully!', 'success');

      // Auto-trigger AI auto-fill on first image
      if (images.length === 0 || !name.trim()) {
        triggerAiAutoFill(updatedImages);
      }
    } catch (err: any) {
      showToast(err.message || 'Image upload failed. Please try again.', 'error');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleRemoveImage = (id: string) => {
    const remaining = images.filter((img) => img.id !== id);
    if (remaining.length > 0 && !remaining.some((img) => img.isPrimary)) {
      remaining[0].isPrimary = true;
    }
    setImages(remaining);
  };

  const handleSetPrimaryImage = (id: string) => {
    setImages(
      images.map((img) => ({
        ...img,
        isPrimary: img.id === id,
      }))
    );
  };

  // Trigger Multi-Stage AI Vision & OCR Auto-Fill
  const triggerAiAutoFill = async (imgsToUse = images) => {
    if (imgsToUse.length === 0 && !name.trim()) {
      showToast('Please upload at least one product photo or enter a product title.', 'info');
      return;
    }

    setIsAnalyzingAi(true);
    setAiProgressStage('Analyzing product packaging with Computer Vision...');

    try {
      setTimeout(() => {
        setAiProgressStage('Reading labels, logos, and packaging text (OCR)...');
      }, 1000);

      setTimeout(() => {
        setAiProgressStage('Detecting category, subcategory & specific attributes...');
      }, 2000);

      const primaryImg = imgsToUse.find((img) => img.isPrimary) || imgsToUse[0];
      const payload = {
        imageUrl: primaryImg?.url,
        imageBase64: primaryImg?.base64,
        images: imgsToUse.map((img) => ({
          url: img.url,
          name: img.url.split('/').pop(),
        })),
        productNameHint: name.trim(),
      };

      const analysis = await productService.analyzeProductImage(payload);

      if (analysis) {
        if (analysis.product_name) setName(analysis.product_name);
        if (analysis.tagline) setTagline(analysis.tagline);
        if (analysis.description) {
          setDescription(analysis.description);
        } else if (analysis.tagline) {
          setDescription(analysis.tagline);
        }
        if (analysis.suggested_price) setPrice(analysis.suggested_price);
        if (analysis.suggested_mrp) {
          setOriginalPrice(analysis.suggested_mrp);
          if (analysis.suggested_price && analysis.suggested_mrp > analysis.suggested_price) {
            setDiscountPercent(
              Math.round(((analysis.suggested_mrp - analysis.suggested_price) / analysis.suggested_mrp) * 100)
            );
          }
        } else if (analysis.suggested_price && originalPrice && originalPrice > analysis.suggested_price) {
          setDiscountPercent(
            Math.round(((originalPrice - analysis.suggested_price) / originalPrice) * 100)
          );
        }

        // 2. Category Intelligence
        if (analysis.category && MAIN_CATEGORIES.includes(analysis.category)) {
          setCategory(analysis.category);
        }
        if (analysis.subcategory) setSubcategory(analysis.subcategory);
        if (analysis.product_type) setProductType(analysis.product_type);

        // 3. 3D Configuration
        if (analysis.three_d_preset?.geometry) {
          setThreeDGeometry(analysis.three_d_preset.geometry);
        }
        if (analysis.three_d_preset?.color) {
          setThreeDColor(analysis.three_d_preset.color);
        }

        // 4. Extract ONLY attributes detected by Gemini AI
        const newAttrState: Record<string, AttributeStateItem> = {};
        const rawAttrs = analysis.attributes || {};

        Object.entries(rawAttrs).forEach(([k, item]: [string, any]) => {
          if (
            item &&
            item.value !== null &&
            item.value !== undefined &&
            String(item.value).trim() !== '' &&
            item.detected !== false
          ) {
            newAttrState[k] = {
              value: String(item.value),
              confidence: item.confidence || 0.95,
              detected: true,
              source: item.source || 'gemini_vision',
            };
          }
        });

        setAttributesState(newAttrState);

        // 5. Specifications
        if (Array.isArray(analysis.specifications) && analysis.specifications.length > 0) {
          setSpecifications(analysis.specifications);
        }

        // Extract color if detected from AI attributes
        if (analysis.attributes?.color?.value && String(analysis.attributes.color.value).trim()) {
          setProductColor(String(analysis.attributes.color.value).trim());
        }

        // 6. Variants Suggestion - Variants MUST remain strictly under seller manual control!
        // We do NOT call setHasVariants(true), preventing auto-fill variant stock splits (e.g. 5 Black, 5 Brown)
        if (analysis.variants_suggested?.options) {
          const sizeOpt = analysis.variants_suggested.options?.find((o: any) =>
            o.name?.toLowerCase().includes('size')
          );
          if (sizeOpt?.values && sizeOpt.values.length > 0) setVariantSizes(sizeOpt.values);

          const colorOpt = analysis.variants_suggested.options?.find((o: any) =>
            o.name?.toLowerCase().includes('color')
          );
          if (colorOpt?.values && colorOpt.values.length > 0) setVariantColors(colorOpt.values);
        }

        // 7. Show AI Review Summary
        setAiReviewSummary({
          show: true,
          productName: analysis.product_name || 'Detected Product',
          category: analysis.category || category,
          subcategory: analysis.subcategory || subcategory,
          productType: analysis.product_type || productType,
          confidence: Math.round((analysis.confidence || 0.95) * 100),
          detectedFields: Object.keys(newAttrState),
          undetectedFields: analysis.undetected_fields || [],
          ocrWords: analysis.ocr_text_found || [],
        });

        showToast('✨ AI successfully analyzed your product photos!', 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'AI analysis could not complete. You can enter details manually.', 'error');
    } finally {
      setIsAnalyzingAi(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        handleAddImageFile(e.dataTransfer.files[i]);
      }
    }
  };

  // Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (images.length === 0) {
      showToast('Please upload at least one product photo.', 'error');
      setCurrentStep(1);
      return;
    }

    if (!name.trim()) {
      showToast('Product name is required.', 'error');
      setCurrentStep(2);
      return;
    }

    if (!sku.trim()) generateSku();

    // Consolidate dynamic attributes into specifications so they are fully persisted
    const mergedSpecs = [...specifications];
    if (productColor && productColor.trim()) {
      const existingColorIdx = mergedSpecs.findIndex((s) => s.name.toLowerCase() === 'color');
      if (existingColorIdx >= 0) {
        mergedSpecs[existingColorIdx].value = productColor.trim();
      } else {
        mergedSpecs.push({ name: 'Color', value: productColor.trim() });
      }
    }

    Object.entries(attributesState).forEach(([key, item]) => {
      if (item.value && item.value.trim()) {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        if (!mergedSpecs.some((s) => s.name.toLowerCase() === label.toLowerCase())) {
          mergedSpecs.push({ name: label, value: item.value.trim() });
        }
      }
    });

    const effectiveStock = hasVariants && variantRows.length > 0
      ? variantRows.reduce((sum, r) => sum + (Number(r.stock) || 0), 0)
      : stock;

    setIsSubmitting(true);
    try {
      const primaryImg = images.find((img) => img.isPrimary) || images[0];
      const allImageUrls = [primaryImg.url, ...images.filter((img) => img.id !== primaryImg.id).map((img) => img.url)];

      await productService.createProduct({
        name: name.trim(),
        tagline: tagline.trim() || name.trim(),
        brand: brand.trim() || 'Artisan Store',
        description: description.trim() || tagline.trim(),
        category,
        subcategory,
        price,
        originalPrice,
        stock: effectiveStock,
        sku: sku.trim(),
        images: allImageUrls,
        variants: hasVariants && variantRows.length > 0 ? variantRows : undefined,
        threeDConfig: {
          geometryType: threeDGeometry,
          primaryColor: threeDColor,
          metalness: 0.8,
          roughness: 0.2,
        },
        specifications: mergedSpecs.filter((s) => s.name.trim() && s.value.trim()),
        deliveryEstimateDays: deliveryDays,
        returnPolicyDays: returnDays,
        status,
      });

      try {
        sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {}

      setCreatedProductInfo({
        name: name.trim(),
        productCode: sku || 'KNPR-0001',
        image: primaryImg?.url,
      });
      showToast(`Product "${name}" registered! Please take off in IT cabin for product verification.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to save product.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const primaryImage = images.find((img) => img.isPrimary) || images[0];

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* ── Top Header & Stepper Navigation ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-cream-200">
        <div>
          <Link
            to="/seller/products"
            className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-burgundy transition-colors mb-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Product Index
          </Link>
          <h1 className="text-2xl sm:text-3xl font-serif font-extrabold text-stone-900">
            Add New Product
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              Seller ID: {user?.sellerId || (user?.businessId?.startsWith('KNSR-') ? user.businessId : user?.businessId?.replace(/^KNCR-/, 'KNSR-')) || 'KNSR-0001'}
            </span>
            <span className="text-xs text-stone-500">
              Store: <strong>{user?.sellerStoreName || 'Atelier'}</strong>
            </span>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            {currentStep === 1
              ? 'Step 1 of 2: Upload product packaging & trigger AI Vision analysis'
              : 'Step 2 of 2: Review product details, pricing, and AI-extracted attributes'}
          </p>
        </div>

        {/* Stepper Tabs (Left-to-Right Flow) */}
        <div className="flex items-center bg-cream-100/70 p-1.5 rounded-2xl border border-cream-200">
          <button
            type="button"
            onClick={() => setCurrentStep(1)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              currentStep === 1
                ? 'bg-burgundy text-white shadow-soft'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                currentStep === 1 ? 'bg-white/20 text-white' : 'bg-stone-200 text-stone-700'
              }`}
            >
              1
            </span>
            <span>Photos & AI Scan</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (images.length === 0) {
                showToast('Please upload at least one image before continuing.', 'info');
                return;
              }
              setCurrentStep(2);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              currentStep === 2
                ? 'bg-burgundy text-white shadow-soft'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                currentStep === 2 ? 'bg-white/20 text-white' : 'bg-stone-200 text-stone-700'
              }`}
            >
              2
            </span>
            <span>Details & Attributes</span>
          </button>
        </div>
      </div>

      {/* Session Draft Status Banner */}
      {savedDraft && (images.length > 0 || name.trim()) && (
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-amber-50/90 border border-amber-200 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Draft Restored:</strong> Your active product session ({images.length} photo{images.length === 1 ? '' : 's'}) was safely recovered.
            </span>
          </div>
          <button
            type="button"
            onClick={handleClearDraft}
            className="text-[11px] font-bold text-amber-800 hover:text-red-700 underline px-2 py-1 rounded transition-colors shrink-0"
          >
            Discard Draft
          </button>
        </div>
      )}

      {/* ── STEP 1: PHOTOS & AI SCAN (Left-to-Right Layout) ────────────────── */}
      {currentStep === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column (5 cols): Live Visual Preview & Gallery (Sticky) */}
          <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-6 lg:self-start space-y-4">
            <div className="bg-white rounded-3xl p-5 border border-cream-200 shadow-soft space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-cream-100">
                <span className="text-xs font-bold uppercase tracking-wider text-burgundy flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5" /> Product Showcase
                </span>
                <span className="text-[11px] font-semibold text-stone-500">
                  {images.length} Photo{images.length === 1 ? '' : 's'}
                </span>
              </div>

              {/* Main Image Large Box */}
              {primaryImage ? (
                <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-stone-900 border border-stone-200 shadow-inner group">
                  <img
                    src={primaryImage.url}
                    alt="Product preview"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute top-3 left-3 bg-burgundy/90 text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-sm">
                    Cover Photo
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(primaryImage.id)}
                    className="absolute top-3 right-3 p-1.5 bg-black/60 hover:bg-red-600 text-white rounded-xl backdrop-blur-xs transition-colors"
                    title="Remove image"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="aspect-[4/3] rounded-2xl border-2 border-dashed border-stone-200 bg-cream-50/50 flex flex-col items-center justify-center text-center p-6 space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-cream-100 text-burgundy flex items-center justify-center shadow-xs">
                    <Camera className="w-7 h-7" />
                  </div>
                  <div>
                    <p className="font-serif font-bold text-sm text-stone-800">No Image Uploaded Yet</p>
                    <p className="text-[11px] text-stone-500 max-w-xs mt-1">
                      Upload front, packaging, or specification label photos. Gemini AI will inspect them directly.
                    </p>
                  </div>
                </div>
              )}

              {/* Thumbnails Strip */}
              {images.length > 0 && (
                <div className="space-y-2 pt-2">
                  <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                    All Uploaded Images
                  </span>
                  <div className="grid grid-cols-4 gap-2">
                    {images.map((img) => (
                      <div
                        key={img.id}
                        onClick={() => handleSetPrimaryImage(img.id)}
                        className={`relative aspect-square rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${
                          img.isPrimary
                            ? 'border-burgundy ring-2 ring-burgundy/20'
                            : 'border-stone-200 hover:border-stone-400 opacity-80 hover:opacity-100'
                        }`}
                      >
                        <img src={img.url} alt="thumbnail" className="w-full h-full object-cover" />
                        {img.isPrimary && (
                          <div className="absolute inset-x-0 bottom-0 bg-burgundy/90 text-white text-[9px] font-bold text-center py-0.5">
                            Cover
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="aspect-square rounded-xl border border-dashed border-stone-300 hover:border-burgundy bg-cream-50 flex flex-col items-center justify-center text-stone-500 hover:text-burgundy transition-colors"
                    >
                      <Plus className="w-4 h-4 mb-0.5" />
                      <span className="text-[10px] font-semibold">Add</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* AI Capability Note */}
            <div className="p-4 rounded-2xl bg-cream-100/60 border border-cream-200 text-xs text-stone-700 space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-burgundy">
                <Sparkles className="w-3.5 h-3.5" /> Multi-Domain AI Vision
              </div>
              <p className="text-[11px] text-stone-600 leading-relaxed">
                Gemini Vision analyzes watches, footwear, apparel, beverages, electronics, and beauty products.
                Attributes are extracted strictly from visible labels, OCR text, and packaging.
              </p>
            </div>
          </div>

          {/* Right Column (7/8 cols): Upload Dropzone & AI Scanner Trigger */}
          <div className="lg:col-span-7 xl:col-span-8 min-w-0 space-y-6">
            {/* Upload Drop Area */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`p-8 rounded-3xl border-2 border-dashed transition-all cursor-pointer text-center space-y-3 ${
                dragActive
                  ? 'border-burgundy bg-cream-100/70 scale-[1.01]'
                  : 'border-stone-300 hover:border-burgundy/70 bg-white hover:bg-cream-50/50 shadow-soft'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    for (let i = 0; i < e.target.files.length; i++) {
                      handleAddImageFile(e.target.files[i]);
                    }
                  }
                  e.target.value = '';
                }}
              />
              <div className="w-14 h-14 rounded-2xl bg-burgundy/10 text-burgundy flex items-center justify-center mx-auto shadow-xs">
                <Upload className="w-7 h-7" />
              </div>
              <div>
                <p className="font-serif font-bold text-base text-stone-900">
                  {isUploadingImage ? 'Uploading image...' : 'Click to Upload or Drag & Drop'}
                </p>
                <p className="text-xs text-stone-500 mt-1 max-w-sm mx-auto">
                  High-resolution product photos, packaging, front dials, or spec stickers (PNG, JPG, WEBP).
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                isLoading={isUploadingImage}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Choose Photos
              </Button>
            </div>

            {/* AI Vision Scanner Action Box */}
            <div className="bg-white p-6 sm:p-7 rounded-3xl border border-cream-200 shadow-soft space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-cream-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-base text-stone-900">AI Vision & OCR Scanner</h3>
                    <p className="text-[11px] text-stone-500">Auto-detect product type, category, brand, and attributes</p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  disabled={images.length === 0 || isAnalyzingAi}
                  isLoading={isAnalyzingAi}
                  onClick={() => triggerAiAutoFill()}
                  leftIcon={<Sparkles className="w-4 h-4" />}
                >
                  {isAnalyzingAi ? 'Analyzing Image...' : 'Run AI Auto-Fill'}
                </Button>
              </div>

              {/* Live Scanning Progress Box */}
              {isAnalyzingAi && (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-3 animate-pulse text-amber-900 text-xs">
                  <RefreshCw className="w-5 h-5 text-amber-600 animate-spin shrink-0" />
                  <div>
                    <strong className="block font-semibold">Gemini AI is scanning your product...</strong>
                    <span className="text-[11px] text-amber-800">{aiProgressStage}</span>
                  </div>
                </div>
              )}

              {/* AI Scan Success Review Banner */}
              {aiReviewSummary && aiReviewSummary.show && (
                <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-50 via-teal-50/50 to-cream-50 border border-emerald-200 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                          ✓ Analysis Complete
                        </span>
                        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                          {aiReviewSummary.confidence}% Confidence
                        </span>
                      </div>
                      <h4 className="font-serif font-bold text-base text-stone-900 mt-1">
                        {aiReviewSummary.productName}
                      </h4>
                      <p className="text-xs text-stone-600 mt-0.5">
                        Classified under <span className="font-semibold text-burgundy">{aiReviewSummary.category}</span> &gt;{' '}
                        <span className="font-semibold text-stone-700">{aiReviewSummary.subcategory}</span> ({aiReviewSummary.productType})
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setAiReviewSummary(null)}
                      className="text-stone-400 hover:text-stone-600 p-1"
                      title="Dismiss summary"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Discovered Attributes Badges */}
                  {Object.keys(attributesState).length > 0 && (
                    <div className="pt-2 border-t border-emerald-200/60">
                      <span className="text-[10px] font-bold text-emerald-900 uppercase tracking-wider block mb-1.5">
                        Extracted Attributes:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(attributesState).map(([k, item]) => (
                          <span
                            key={k}
                            className="text-[11px] bg-white border border-emerald-200 text-stone-800 px-2.5 py-1 rounded-xl shadow-2xs font-medium"
                          >
                            <span className="text-stone-400 font-normal mr-1">{k.replace(/_/g, ' ')}:</span>
                            {item.value}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Bottom Continue Action */}
              <div className="pt-4 flex items-center justify-between">
                <p className="text-xs text-stone-500">
                  {images.length > 0
                    ? 'Photos ready. Proceed to Step 2 to review details.'
                    : 'Upload at least one photo to proceed.'}
                </p>
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  disabled={images.length === 0}
                  onClick={() => {
                    if (!description.trim() && tagline.trim()) {
                      setDescription(tagline.trim());
                    }
                    setCurrentStep(2);
                  }}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Continue to Details & Pricing
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: DETAILS & ATTRIBUTES (Left-to-Right Layout) ──────────────── */}
      {currentStep === 2 && (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column (4/5 cols): Sticky Product Preview (Static, pins on screen while right side scrolls) */}
          <div className="lg:col-span-5 xl:col-span-4 space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div className="bg-white rounded-3xl p-5 border border-cream-200 shadow-soft space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-cream-100">
                <span className="text-xs font-bold uppercase tracking-wider text-burgundy">
                  Product Preview
                </span>
                <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                  Live Sync
                </span>
              </div>

              {/* Cover Image Thumbnail */}
              {primaryImage ? (
                <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-stone-900 border border-stone-200 shadow-xs">
                  <img src={primaryImage.url} alt="Cover" className="w-full h-full object-cover" />
                  <div className="absolute bottom-2 left-2 bg-black/80 backdrop-blur-xs text-white text-xs px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 shadow-sm">
                    <span>₹{price.toLocaleString('en-IN')}</span>
                    {originalPrice && originalPrice > price && (
                      <span className="line-through text-stone-400 text-[10px] font-normal">
                        ₹{originalPrice.toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                  {discountPercent > 0 && (
                    <div className="absolute top-2 right-2 bg-emerald-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-full shadow-sm">
                      {discountPercent}% OFF
                    </div>
                  )}
                </div>
              ) : (
                <div className="aspect-[4/3] rounded-2xl bg-stone-100 border border-dashed border-stone-300 flex items-center justify-center text-xs text-stone-400">
                  No photo uploaded
                </div>
              )}

              {/* Product Title & Brand summary */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-burgundy font-bold">{brand || 'Brand'}</p>
                <h4 className="font-serif font-bold text-sm text-stone-900 truncate">{name || 'Untitled Product'}</h4>
                {tagline && <p className="text-xs text-stone-500 line-clamp-1">{tagline}</p>}
              </div>

              {/* Price Breakdown Preview */}
              <div className="p-3.5 rounded-2xl bg-cream-50/80 border border-cream-200 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-stone-500">Original MRP:</span>
                  <span className="font-semibold text-stone-700">
                    {originalPrice ? `₹${originalPrice.toLocaleString('en-IN')}` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-stone-500">Discount:</span>
                  <span className="font-semibold text-emerald-700">
                    {discountPercent > 0 ? `${discountPercent}% OFF` : 'None'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold pt-1.5 border-t border-cream-200">
                  <span className="text-stone-900">Final Selling Price:</span>
                  <span className="text-burgundy text-sm">₹{price.toLocaleString('en-IN')}</span>
                </div>
                {originalPrice && originalPrice > price && (
                  <div className="text-[10px] text-emerald-700 font-bold text-right pt-0.5">
                    Customer saves ₹{(originalPrice - price).toLocaleString('en-IN')}!
                  </div>
                )}
              </div>

              {/* Quick Details Badges */}
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-stone-100">
                  <span className="text-stone-500">Category</span>
                  <span className="font-semibold text-stone-800 truncate max-w-[140px]">{category}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-stone-100">
                  <span className="text-stone-500">Subcategory</span>
                  <span className="font-semibold text-stone-800 truncate max-w-[140px]">{subcategory}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-stone-100">
                  <span className="text-stone-500">Inventory Stock</span>
                  <span className="font-semibold text-emerald-700">{stock} Units</span>
                </div>
              </div>

              {/* 3D Model Preset Selector */}
              <div className="pt-2 border-t border-stone-100 space-y-2">
                <label className="text-[11px] font-bold text-stone-700 uppercase tracking-wide flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-burgundy" /> 3D Model Preset
                </label>
                <Select
                  value={threeDGeometry}
                  onChange={(e) => setThreeDGeometry(e.target.value as any)}
                  options={[
                    { value: 'watch', label: 'Watch / Timepiece' },
                    { value: 'jewelry', label: 'Fine Jewelry / Gemstone' },
                    { value: 'electronics', label: 'Electronics / Smartphone' },
                    { value: 'decor', label: 'Bottle / Container / Decor' },
                    { value: 'furniture', label: 'Furniture / Box' },
                  ]}
                />
              </div>

              {/* Step 1 Switcher */}
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="w-full py-2.5 rounded-xl border border-stone-200 text-stone-700 hover:border-burgundy text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Edit Photos / Re-scan AI
              </button>
            </div>
          </div>

          {/* Right Column (7/8 cols): Clean Details Form & Extracted Attributes (Scrollable) */}
          <div className="lg:col-span-7 xl:col-span-8 min-w-0 space-y-6 lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto lg:pr-3 lg:scroll-smooth">
            {/* 1. Basic Information */}
            <div className="bg-white p-6 sm:p-7 rounded-3xl border border-cream-200 shadow-soft space-y-5">
              <h3 className="font-serif font-bold text-base text-stone-900 pb-3 border-b border-cream-100 flex items-center gap-2">
                <Package className="w-4 h-4 text-burgundy" /> 1. Basic Information
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Input
                    label="Product Title / Name"
                    placeholder="e.g. Fossil Men's Classic Leather Watch"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <Input
                  label="Brand / Store Name"
                  placeholder="e.g. Fossil"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
                <Input
                  label="Tagline / Short Summary"
                  placeholder="e.g. Elegant timepiece with genuine leather finish"
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                />
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
                    Product Color
                  </label>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="e.g. Midnight Black, Vintage Brown, Silver, Rose Gold, Royal Blue, Transparent"
                      value={productColor}
                      onChange={(e) => setProductColor(e.target.value)}
                      className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2 text-xs sm:text-sm text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider mr-1">Quick Select:</span>
                      {['Black', 'Brown', 'Silver', 'Gold', 'Blue', 'White', 'Clear', 'Red', 'Green'].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setProductColor(c)}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all ${
                            productColor.toLowerCase() === c.toLowerCase()
                              ? 'bg-burgundy text-white border-burgundy shadow-xs'
                              : 'bg-cream-50 text-stone-700 border-stone-200 hover:border-burgundy/50'
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <span className="text-[10px] text-stone-500 mt-1 block">
                    Product color specified by seller for single product or default display.
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold tracking-wide text-stone-700 mb-1.5 uppercase">
                    Description
                  </label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Product details, material, dimensions, and usage."
                    className="w-full bg-white border border-stone-200 rounded-xl p-3 text-xs sm:text-sm text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy leading-relaxed"
                  />
                </div>
              </div>
            </div>

            {/* 2. Category Intelligence */}
            <div className="bg-white p-6 sm:p-7 rounded-3xl border border-cream-200 shadow-soft space-y-5">
              <h3 className="font-serif font-bold text-base text-stone-900 pb-3 border-b border-cream-100 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-burgundy" /> 2. Category & Classification
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  label="Main Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  options={MAIN_CATEGORIES.map((cat) => ({ value: cat, label: cat }))}
                />
                <Select
                  label="Subcategory"
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  options={categoryIntel.subcategories.map((sub) => ({ value: sub, label: sub }))}
                />
                <Input
                  label="Product Type"
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                  placeholder="e.g. Analog Watch"
                />
              </div>
            </div>

            {/* 3. Pricing, Discount & Inventory */}
            <div className="bg-white p-6 sm:p-7 rounded-3xl border border-cream-200 shadow-soft space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-cream-100 flex-wrap gap-2">
                <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2">
                  <IndianRupee className="w-4 h-4 text-burgundy" /> 3. Pricing, Discount & Inventory
                </h3>
                {discountPercent > 0 && originalPrice && originalPrice > price && (
                  <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{discountPercent}% OFF · Customer Saves ₹{(originalPrice - price).toLocaleString('en-IN')}</span>
                  </span>
                )}
              </div>

              {/* Interactive Price & Discount Box */}
              <div className="p-4 sm:p-5 rounded-2xl bg-cream-50/70 border border-cream-200 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Original MRP */}
                  <div>
                    <Input
                      label="Original Price / MRP (₹)"
                      type="number"
                      min={1}
                      placeholder="e.g. 1000"
                      value={originalPrice || ''}
                      onChange={(e) => handleOriginalPriceChange(e.target.value ? Number(e.target.value) : undefined)}
                    />
                    <span className="text-[10px] text-stone-500 mt-1 block">Printed MRP before discount</span>
                  </div>

                  {/* Discount % */}
                  <div>
                    <Input
                      label="Discount %"
                      type="number"
                      min={0}
                      max={99}
                      placeholder="e.g. 10"
                      value={discountPercent || ''}
                      onChange={(e) => handleDiscountPercentChange(Number(e.target.value))}
                    />
                    {/* Preset Discount Chips */}
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {[5, 10, 15, 20, 25, 30, 50].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => handleDiscountPercentChange(pct)}
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-all ${
                            discountPercent === pct
                              ? 'bg-burgundy text-white shadow-xs'
                              : 'bg-white border border-stone-200 text-stone-600 hover:border-burgundy hover:text-burgundy'
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Final Selling Price */}
                  <div>
                    <Input
                      label="Final Selling Price (₹)"
                      type="number"
                      required
                      min={1}
                      placeholder="e.g. 900"
                      value={price}
                      onChange={(e) => handleSellingPriceChange(Number(e.target.value))}
                    />
                    <span className="text-[10px] text-emerald-700 font-semibold mt-1 block">
                      {originalPrice && originalPrice > price
                        ? `Net customer price (₹${price})`
                        : 'Actual amount charged to buyer'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stock and SKU */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Stock Units"
                  type="number"
                  required
                  min={1}
                  value={stock}
                  onChange={(e) => setStock(Number(e.target.value))}
                />
                <Input
                  label="SKU Code"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                />
              </div>
            </div>

            {/* 4. AI-EXTRACTED ATTRIBUTES (Replaces the old 10-box static UI) */}
            <div className="bg-white p-6 sm:p-7 rounded-3xl border border-cream-200 shadow-soft space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-cream-100 flex-wrap gap-2">
                <div>
                  <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600" /> 4. AI-Detected Attributes
                  </h3>
                  <p className="text-xs text-stone-500">
                    Extracted from your product image & labels. You can adjust values or add custom attributes.
                  </p>
                </div>

                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
                  <Check className="w-3 h-3" /> AI Verified
                </span>
              </div>

              {/* Attributes Cards Grid */}
              {Object.keys(attributesState).length === 0 ? (
                <div className="p-4 rounded-2xl bg-stone-50 border border-dashed border-stone-200 text-center">
                  <p className="text-xs text-stone-500">
                    No specific attributes extracted yet. Add attributes below or re-run the AI scan in Step 1.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(attributesState).map(([key, item]) => (
                    <div
                      key={key}
                      className="p-3 rounded-2xl bg-cream-50/70 border border-cream-200 space-y-1 relative group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-stone-600 uppercase tracking-wide">
                          {key.replace(/_/g, ' ')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...attributesState };
                            delete next[key];
                            setAttributesState(next);
                          }}
                          className="text-stone-400 hover:text-red-500 p-0.5 opacity-60 group-hover:opacity-100 transition-opacity"
                          title="Remove attribute"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={item.value}
                        onChange={(e) =>
                          setAttributesState({
                            ...attributesState,
                            [key]: { ...item, value: e.target.value },
                          })
                        }
                        className="w-full bg-white border border-stone-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Quick Add Custom Attribute */}
              <div className="pt-3 border-t border-cream-100 flex flex-col sm:flex-row items-center gap-2">
                <input
                  type="text"
                  placeholder="Attribute Name (e.g. Strap Material, Dial Color)"
                  value={newAttrKey}
                  onChange={(e) => setNewAttrKey(e.target.value)}
                  className="w-full sm:flex-1 bg-white border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
                />
                <input
                  type="text"
                  placeholder="Value (e.g. Genuine Leather, 42mm)"
                  value={newAttrVal}
                  onChange={(e) => setNewAttrVal(e.target.value)}
                  className="w-full sm:flex-1 bg-white border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!newAttrKey.trim() || !newAttrVal.trim()) return;
                    setAttributesState({
                      ...attributesState,
                      [newAttrKey.trim().toLowerCase().replace(/\s+/g, '_')]: {
                        value: newAttrVal.trim(),
                        confidence: 1,
                        detected: true,
                        source: 'seller_added',
                      },
                    });
                    setNewAttrKey('');
                    setNewAttrVal('');
                  }}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Add
                </Button>
              </div>
            </div>

            {/* 5. Product Variants (Optional) */}
            <div className="bg-white p-6 sm:p-7 rounded-3xl border border-cream-200 shadow-soft space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-cream-100">
                <div className="flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-burgundy" />
                  <div>
                    <h3 className="font-serif font-bold text-base text-stone-900">Product Variants</h3>
                    <p className="text-xs text-stone-500">Enable if product has multiple sizes or colors</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasVariants}
                    onChange={(e) => setHasVariants(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-burgundy"></div>
                </label>
              </div>

              {hasVariants && (
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-stone-800">Select Sizes:</label>
                    <div className="flex flex-wrap gap-1.5">
                      {['Free Size', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            if (variantSizes.includes(s)) {
                              setVariantSizes(variantSizes.filter((x) => x !== s));
                            } else {
                              setVariantSizes([...variantSizes, s]);
                            }
                          }}
                          className={`px-3 py-1 rounded-xl text-xs font-semibold border transition-all ${
                            variantSizes.includes(s)
                              ? 'bg-burgundy text-white border-burgundy'
                              : 'bg-cream-50 text-stone-700 border-stone-200 hover:border-burgundy/50'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-stone-800">Select Colors:</label>
                    <div className="flex flex-wrap gap-1.5">
                      {['Black', 'Brown', 'Navy', 'Silver', 'Gold', 'White', 'Olive'].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            if (variantColors.includes(c)) {
                              setVariantColors(variantColors.filter((x) => x !== c));
                            } else {
                              setVariantColors([...variantColors, c]);
                            }
                          }}
                          className={`px-3 py-1 rounded-xl text-xs font-semibold border transition-all ${
                            variantColors.includes(c)
                              ? 'bg-stone-900 text-white border-stone-900'
                              : 'bg-cream-50 text-stone-700 border-stone-200 hover:border-stone-400'
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Variant Inventory Table: Seller sets custom stock & price per variant */}
                  {variantRows.length > 0 && (
                    <div className="pt-3 border-t border-cream-200 space-y-2">
                      <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                        <label className="font-bold text-stone-800">
                          Variant Stock & Price Configuration (Seller Defined):
                        </label>
                        <span className="text-[11px] text-stone-500 font-semibold">
                          Total Variant Stock:{' '}
                          <strong className="text-emerald-700 font-bold">
                            {variantRows.reduce((sum, r) => sum + (Number(r.stock) || 0), 0)} units
                          </strong>
                        </span>
                      </div>
                      <div className="overflow-x-auto border border-stone-200 rounded-xl">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-cream-50 text-stone-600 border-b border-stone-200">
                            <tr>
                              <th className="py-2.5 px-3 font-semibold">Option / Color</th>
                              <th className="py-2.5 px-3 font-semibold">SKU Code</th>
                              <th className="py-2.5 px-3 font-semibold">Price (₹)</th>
                              <th className="py-2.5 px-3 font-semibold">Stock Units</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100 bg-white">
                            {variantRows.map((row, idx) => (
                              <tr key={row.sku || idx} className="hover:bg-cream-50/40">
                                <td className="py-2.5 px-3 font-medium text-stone-900">
                                  {[row.size, row.color].filter(Boolean).join(' / ') || 'Standard'}
                                </td>
                                <td className="py-2.5 px-3">
                                  <input
                                    type="text"
                                    value={row.sku}
                                    onChange={(e) => {
                                      const updated = [...variantRows];
                                      updated[idx].sku = e.target.value;
                                      setVariantRows(updated);
                                    }}
                                    className="w-full bg-cream-50/50 border border-stone-200 rounded px-2 py-1 text-xs font-mono"
                                  />
                                </td>
                                <td className="py-2.5 px-3 w-28">
                                  <input
                                    type="number"
                                    min={1}
                                    value={row.price}
                                    onChange={(e) => {
                                      const updated = [...variantRows];
                                      updated[idx].price = Number(e.target.value) || 0;
                                      setVariantRows(updated);
                                    }}
                                    className="w-full border border-stone-200 rounded px-2 py-1 text-xs font-semibold"
                                  />
                                </td>
                                <td className="py-2.5 px-3 w-28">
                                  <input
                                    type="number"
                                    min={0}
                                    value={row.stock}
                                    onChange={(e) => {
                                      const updated = [...variantRows];
                                      updated[idx].stock = Number(e.target.value) || 0;
                                      setVariantRows(updated);
                                      const newTotal = updated.reduce(
                                        (sum, r) => sum + (Number(r.stock) || 0),
                                        0
                                      );
                                      if (newTotal > 0) setStock(newTotal);
                                    }}
                                    className="w-full border border-stone-200 rounded px-2 py-1 text-xs font-bold text-emerald-800 focus:ring-1 focus:ring-burgundy"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 6. Shipping & Policy */}
            <div className="bg-white p-6 sm:p-7 rounded-3xl border border-cream-200 shadow-soft space-y-4">
              <h3 className="font-serif font-bold text-base text-stone-900 pb-3 border-b border-cream-100 flex items-center gap-2">
                <Truck className="w-4 h-4 text-burgundy" /> 6. Shipping & Policies
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label="Estimated Delivery (Days)"
                  type="number"
                  value={deliveryDays}
                  onChange={(e) => setDeliveryDays(Number(e.target.value))}
                />
                <Input
                  label="Return Window (Days)"
                  type="number"
                  value={returnDays}
                  onChange={(e) => setReturnDays(Number(e.target.value))}
                />
                <Select
                  label="Publish Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  options={[
                    { value: 'PUBLISHED', label: 'Publish immediately to store' },
                    { value: 'DRAFT', label: 'Save as Draft' },
                  ]}
                />
              </div>
            </div>

            {/* Bottom Form Actions */}
            <div className="flex items-center justify-between pt-4">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setCurrentStep(1)}
                leftIcon={<ArrowLeft className="w-4 h-4" />}
              >
                Back to Photos
              </Button>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={isSubmitting}
                leftIcon={<CheckCircle2 className="w-4 h-4" />}
              >
                Publish Product
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* ── IT Cabin Physical Verification Handover Modal ───────────────────── */}
      {createdProductInfo && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 border border-cream-200 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto border border-amber-200 shadow-soft">
                <CheckCircle2 className="w-8 h-8 text-amber-600" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-burgundy block">
                Artifact Registration Protocol
              </span>
              <h2 className="text-xl sm:text-2xl font-serif font-extrabold text-stone-900">
                Artifact Registered Successfully
              </h2>
            </div>

            <div className="bg-cream-50 p-4 rounded-2xl border border-cream-200 space-y-3">
              <div className="flex items-center gap-3">
                {createdProductInfo.image ? (
                  <img
                    src={createdProductInfo.image}
                    alt=""
                    className="w-14 h-14 rounded-xl object-cover border border-cream-300"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-stone-200 flex items-center justify-center text-stone-500 font-bold text-xs">
                    KNPR
                  </div>
                )}
                <div>
                  <h4 className="font-serif font-bold text-sm text-stone-900 line-clamp-1">
                    {createdProductInfo.name}
                  </h4>
                  <span className="font-mono text-xs font-bold text-burgundy bg-burgundy/5 px-2 py-0.5 rounded border border-burgundy/10 inline-block mt-0.5">
                    Product Code: {createdProductInfo.productCode}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-300/40 text-stone-800 space-y-2">
              <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                🏛️ Mandatory IT Cabin Handover Protocol
              </p>
              <p className="text-xs text-amber-950/90 leading-relaxed font-semibold">
                Please take off in IT cabin for product verification.
              </p>
              <p className="text-[11px] text-stone-600 leading-relaxed">
                Your piece is currently in <strong>PENDING_VERIFICATION</strong> status. Once physically verified and hallmarked by the campus administration, it will immediately become live in the public catalog.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <Button
                variant="outline"
                size="md"
                onClick={() => {
                  setCreatedProductInfo(null);
                  handleClearDraft();
                }}
              >
                Add Another Piece
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => navigate('/seller/products')}
              >
                View in Catalog
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
