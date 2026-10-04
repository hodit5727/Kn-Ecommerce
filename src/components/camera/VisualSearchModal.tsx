import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '../common/Modal';
import { Camera, UploadCloud, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '../common/Button';
import { ErrorState } from '../common/ErrorState';
import { EmptyState } from '../common/EmptyState';
import { productService } from '../../services/productService';
import { Product } from '../../types/product';
import { useNavigate } from 'react-router-dom';
import { formatINR } from '../../lib/currency';

interface VisualSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Visual search modal — loads the REAL catalog via productService when
 * opened. There is no backend visual-matching endpoint yet, so instead of
 * faking "detected tags"/"matches" from hardcoded fixtures, the modal shows
 * an honest notice after an upload and offers the live catalog to browse.
 * Failures surface as a real error state with retry.
 */
export const VisualSearchModal: React.FC<VisualSearchModalProps> = ({ isOpen, onClose }) => {
  const [scannedImage, setScannedImage] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const loadCatalog = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await productService.getProducts();
      setProducts(list);
    } catch (err) {
      setProducts([]);
      setError(
        err instanceof Error ? err.message : 'Unable to load the product catalog. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Load real products every time the modal is opened.
  useEffect(() => {
    if (isOpen) {
      loadCatalog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setScannedImage(url);
    // Honest state — no fabricated scan results.
    setNotice(
      'Optical matching is not available yet: the backend visual-search service has not been implemented. Browse the live catalog below to find your piece.'
    );
  };

  const handleProductClick = (productId: string) => {
    onClose();
    navigate(`/products/${productId}`);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Optical AI Visual Search"
      subtitle="Identify luxury artifacts by silhouette, texture, and horological geometry"
      maxWidth="2xl"
    >
      <div className="space-y-6">
        {/* Scanner Viewport */}
        <div className="relative h-64 w-full rounded-2xl overflow-hidden border border-cream-300 bg-stone-950 flex items-center justify-center">
          {scannedImage ? (
            <img
              src={scannedImage}
              alt="Scanned subject"
              className="w-full h-full object-cover filter brightness-90"
            />
          ) : (
            <div className="text-center p-6">
              <Camera className="w-12 h-12 text-cream-300/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-cream-200">
                Point camera or drag high-resolution luxury piece
              </p>
              <p className="text-xs text-stone-500 mt-1">Supports PNG, JPG, WEBP</p>
            </div>
          )}

          {/* Scanner Corner Markers */}
          <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-cream-300/80" />
          <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-cream-300/80" />
          <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-cream-300/80" />
          <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-cream-300/80" />
        </div>

        {/* Input Trigger (camera/upload only — no sample fixtures) */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            leftIcon={<UploadCloud className="w-4 h-4" />}
          >
            Upload Photo
          </Button>
        </div>

        {/* Honest capability notice after an upload */}
        {notice && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-xl text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>{notice}</p>
          </div>
        )}

        {/* Live catalog (real products from the backend) */}
        {error ? (
          <ErrorState
            title="Catalog Unreachable"
            message={error}
            onRetry={loadCatalog}
            isRetrying={isLoading}
          />
        ) : isLoading ? (
          <div className="py-8 text-center text-xs text-stone-500">
            <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-3" />
            Loading live catalog...
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            title="No Products Available"
            description="The catalog is currently empty, so there is nothing to reference yet."
          />
        ) : (
          <div>
            <h4 className="text-sm font-serif font-semibold text-stone-900 mb-3">
              Live Catalog Reference
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {products.map((p) => (
                <div
                  key={p.id}
                  onClick={() => handleProductClick(p.id)}
                  className="flex items-center gap-3 p-3 bg-white rounded-xl border border-cream-200 hover:border-burgundy/50 shadow-soft cursor-pointer transition-all hover:translate-x-1"
                >
                  {p.images[0] ? (
                    <img
                      src={p.images[0]}
                      alt={p.name}
                      className="w-16 h-16 rounded-lg object-cover bg-stone-100"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-stone-100 flex items-center justify-center text-stone-400">
                      <Camera className="w-5 h-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h5 className="text-xs font-serif font-semibold text-stone-900 truncate">
                      {p.name}
                    </h5>
                    <p className="text-[11px] text-stone-500">{p.brand}</p>
                    <p className="text-xs font-semibold text-burgundy mt-1">
                      {formatINR(p.price)}
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
