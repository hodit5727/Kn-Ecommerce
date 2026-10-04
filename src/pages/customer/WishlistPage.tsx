import React, { useState, useEffect } from 'react';
import { useWishlist } from '../../context/WishlistContext';
import { productService } from '../../services/productService';
import { Product } from '../../types/product';
import { ProductCard } from '../../components/product/ProductCard';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { QuickViewModal } from '../../components/product/QuickViewModal';
import { Heart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CustomerSidebar } from '../../components/customer/CustomerSidebar';

import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { ShieldCheck } from 'lucide-react';

export const WishlistPage: React.FC = () => {
  const { wishlistIds } = useWishlist();
  const { user, isAuthenticated, openAuthModal } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedQuickView, setSelectedQuickView] = useState<Product | null>(null);
  const navigate = useNavigate();

  const loadWishlistItems = async () => {
    setError(null);

    // If unauthenticated or no saved items, return empty immediately
    if (!isAuthenticated || !user || wishlistIds.length === 0) {
      setProducts([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const all = await productService.getProducts();
      setProducts(all.filter((p) => wishlistIds.includes(p.id)));
    } catch (err) {
      setProducts([]);
      setError(
        err instanceof Error ? err.message : 'Unable to load your wishlist items. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadWishlistItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wishlistIds]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="border-b border-cream-200 pb-6 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
            Curated Vault
          </span>
          <h1 className="text-3xl font-serif font-bold text-stone-900">
            Personal Wishlist ({products.length})
          </h1>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-8 items-start">
        <CustomerSidebar />

        <div className="flex-1 w-full">
          {error ? (
            <ErrorState
              title="Wishlist Unreachable"
              message={error}
              onRetry={loadWishlistItems}
              isRetrying={isLoading}
            />
          ) : isLoading ? (
            <div className="py-16 text-center text-xs text-stone-500">
              <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-3" />
              Loading saved pieces...
            </div>
          ) : !isAuthenticated || !user ? (
            <div className="bg-white rounded-3xl border border-cream-200 p-8 text-center max-w-lg mx-auto space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-burgundy mx-auto shadow-soft">
                <ShieldCheck className="w-7 h-7 text-burgundy" />
              </div>
              <h3 className="font-serif font-bold text-xl text-stone-900">Sign In to View Wishlist</h3>
              <p className="text-xs text-stone-500 leading-relaxed">
                Your curated pieces are strictly isolated to your authenticated account. Please log in to view and manage your saved items.
              </p>
              <Button variant="primary" size="md" onClick={openAuthModal}>
                Sign In / Register
              </Button>
            </div>
          ) : products.length === 0 ? (
            <EmptyState
              title="Your Vault is Empty"
              description="You haven't saved any luxury timepieces or artisanal furnishings yet."
              icon={<Heart className="w-8 h-8" />}
              actionText="Explore Products"
              onAction={() => navigate('/products')}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onQuickView={(prod) => setSelectedQuickView(prod)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <QuickViewModal
        isOpen={!!selectedQuickView}
        onClose={() => setSelectedQuickView(null)}
        product={selectedQuickView}
      />
    </div>
  );
};
