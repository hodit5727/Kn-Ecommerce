import React, { useState, useEffect } from 'react';
import { Product } from '../../types/product';
import { Product3DViewer } from './Product3DViewer';
import { productService } from '../../services/productService';
import { Sun, Moon, Lamp, Compass, Sparkles } from 'lucide-react';
import { ErrorState } from '../common/ErrorState';
import { EmptyState } from '../common/EmptyState';
import { formatINR } from '../../lib/currency';

/**
 * Interactive interior visualizer. Products come from the REAL backend
 * (loaded on mount) instead of the removed INITIAL_PRODUCTS fixture list;
 * API failures render a real error state with retry, and an empty catalog
 * renders an empty state instead of fake artifacts.
 */
export const LiveInteriorVisualizer: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [roomSetting, setRoomSetting] = useState<'salon' | 'penthouse' | 'gallery'>('salon');
  const [ambience, setAmbience] = useState<'daylight' | 'golden' | 'dusk'>('golden');
  const [scaleFactor, setScaleFactor] = useState<number>(100);

  const loadProducts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await productService.getProducts();
      setProducts(list);
      setSelectedProductId((prev) =>
        prev && list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? '')
      );
    } catch (err) {
      setProducts([]);
      setSelectedProductId('');
      setError(
        err instanceof Error ? err.message : 'Unable to load products for the visualizer.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeProduct = products.find((p) => p.id === selectedProductId) ?? null;

  const roomBackdrops = {
    salon: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1600&q=80',
    penthouse: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=80',
    gallery: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1600&q=80',
  };

  const ambienceFilters = {
    daylight: 'brightness-105 contrast-100',
    golden: 'sepia-[0.3] brightness-100 contrast-105 hue-rotate-[-10deg]',
    dusk: 'brightness-75 contrast-125 saturate-90 hue-rotate-[15deg]',
  };

  const roomLabels = {
    salon: 'Grand Salon Parquet',
    penthouse: 'Mayfair High-Rise Penthouse',
    gallery: 'Minimalist Curatorial Gallery',
  };

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-10 border border-cream-200 shadow-xl space-y-6">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-cream-200">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy flex items-center gap-1.5 mb-1">
            <Sparkles className="w-3.5 h-3.5" /> Spatial Architecture Simulation
          </span>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Interactive 3D Interior Visualizer
          </h2>
          <p className="text-xs sm:text-sm text-stone-500 mt-1">
            Observe pieces placed into architectural rooms with dynamic lighting and interactive 3D rotation.
          </p>
        </div>

        {/* Product Switcher Dropdown (real catalog) */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-stone-600 hidden sm:inline">
            Active Artifact:
          </span>
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            disabled={isLoading || !!error || products.length === 0}
            className="bg-ivory border border-cream-300 rounded-xl px-3 py-2 text-xs font-semibold text-stone-800 focus:outline-none focus:ring-1 focus:ring-burgundy disabled:opacity-60"
          >
            {products.length === 0 ? (
              <option value="">No products available</option>
            ) : (
              products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({formatINR(p.price)})
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Data states: error / loading / empty — never fixture products */}
      {error ? (
        <ErrorState
          title="Unable to Load Products"
          message={error}
          onRetry={loadProducts}
          isRetrying={isLoading}
        />
      ) : isLoading ? (
        <div className="py-24 text-center text-xs text-stone-500">
          <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-3" />
          Loading live catalog...
        </div>
      ) : !activeProduct ? (
        <EmptyState
          title="No Products Available"
          description="There are no products in the catalog to visualize yet. Published products will appear here automatically."
        />
      ) : (
        <>
          {/* Main Visualizer Stage */}
          <div className="relative h-[480px] sm:h-[540px] w-full rounded-2xl overflow-hidden border border-cream-300 shadow-2xl bg-stone-950">
            {/* Background Room Photo with Ambient Lighting Filter */}
            <img
              src={roomBackdrops[roomSetting]}
              alt={roomLabels[roomSetting]}
              className={`w-full h-full object-cover transition-all duration-700 ${ambienceFilters[ambience]}`}
            />

            {/* Cinematic Vignette */}
            <div className="absolute inset-0 bg-radial from-transparent via-stone-950/20 to-stone-950/70 pointer-events-none" />

            {/* Animated Floating 3D Product in Room */}
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-auto transition-transform duration-300"
              style={{ transform: `scale(${scaleFactor / 100})` }}
            >
              <div className="w-[320px] h-[320px] sm:w-[400px] sm:h-[400px] filter drop-shadow-[0_25px_35px_rgba(0,0,0,0.5)] animate-float-slow">
                <Product3DViewer
                  product={activeProduct}
                  autoRotate={true}
                  className="w-full h-full"
                />
              </div>
            </div>

            {/* Top-Left Telemetry Airboard */}
            <div className="absolute top-4 left-4 airboard px-4 py-2.5 rounded-2xl text-xs text-stone-800 shadow-airboard flex items-center gap-3">
              <div className="p-2 rounded-xl bg-burgundy-50 text-burgundy">
                <Compass className="w-5 h-5 animate-spin" style={{ animationDuration: '12s' }} />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-burgundy block">
                  Spatial Calibration
                </span>
                <span className="font-serif font-bold text-xs sm:text-sm text-stone-900 block">
                  {roomLabels[roomSetting]}
                </span>
                <span className="text-[10px] text-stone-500 font-mono">
                  1:1 AR Perspective • Scale {scaleFactor}%
                </span>
              </div>
            </div>

            {/* Top-Right Ambient Lighting Indicator */}
            <div className="absolute top-4 right-4 airboard px-3 py-1.5 rounded-full text-xs font-semibold text-stone-700 flex items-center gap-1.5 shadow-sm">
              {ambience === 'daylight' ? (
                <Sun className="w-4 h-4 text-amber-500" />
              ) : ambience === 'golden' ? (
                <Lamp className="w-4 h-4 text-amber-500" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-400" />
              )}
              <span className="capitalize">{ambience} Mood</span>
            </div>

            {/* Bottom Instructional Helper */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 airboard px-4 py-1.5 rounded-full text-[11px] font-medium text-stone-700 shadow-md pointer-events-none">
              Click & Drag on Artifact to Rotate in 360° Interior Space
            </div>
          </div>

          {/* Interactive Controls Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {/* Room Environment Selection */}
            <div className="bg-ivory p-4 rounded-2xl border border-cream-200 space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700 block">
                1. Select Interior Estate
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(['salon', 'penthouse', 'gallery'] as const).map((env) => (
                  <button
                    key={env}
                    onClick={() => setRoomSetting(env)}
                    className={`py-2 px-2 text-xs font-semibold rounded-xl capitalize border transition-all text-center ${
                      roomSetting === env
                        ? 'bg-burgundy text-white border-burgundy shadow-sm'
                        : 'bg-white text-stone-700 border-cream-300 hover:bg-cream-50'
                    }`}
                  >
                    {env}
                  </button>
                ))}
              </div>
            </div>

            {/* Atmospheric Lighting Selection */}
            <div className="bg-ivory p-4 rounded-2xl border border-cream-200 space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700 block">
                2. Atmospheric Lighting
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => setAmbience('daylight')}
                  className={`py-2 px-2 text-xs font-semibold rounded-xl border flex items-center justify-center gap-1 transition-all ${
                    ambience === 'daylight'
                      ? 'bg-burgundy text-white border-burgundy shadow-sm'
                      : 'bg-white text-stone-700 border-cream-300 hover:bg-cream-50'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" /> Sunlight
                </button>
                <button
                  onClick={() => setAmbience('golden')}
                  className={`py-2 px-2 text-xs font-semibold rounded-xl border flex items-center justify-center gap-1 transition-all ${
                    ambience === 'golden'
                      ? 'bg-burgundy text-white border-burgundy shadow-sm'
                      : 'bg-white text-stone-700 border-cream-300 hover:bg-cream-50'
                  }`}
                >
                  <Lamp className="w-3.5 h-3.5" /> Golden
                </button>
                <button
                  onClick={() => setAmbience('dusk')}
                  className={`py-2 px-2 text-xs font-semibold rounded-xl border flex items-center justify-center gap-1 transition-all ${
                    ambience === 'dusk'
                      ? 'bg-burgundy text-white border-burgundy shadow-sm'
                      : 'bg-white text-stone-700 border-cream-300 hover:bg-cream-50'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" /> Dusk
                </button>
              </div>
            </div>

            {/* Spatial Scale Slider */}
            <div className="bg-ivory p-4 rounded-2xl border border-cream-200 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-700">
                  3. Spatial Scale
                </span>
                <span className="text-xs font-mono font-bold text-burgundy">{scaleFactor}%</span>
              </div>
              <input
                type="range"
                min="70"
                max="135"
                value={scaleFactor}
                onChange={(e) => setScaleFactor(Number(e.target.value))}
                className="w-full accent-burgundy cursor-pointer mt-2"
              />
              <div className="flex justify-between text-[10px] text-stone-400">
                <span>Compact (70%)</span>
                <span>Standard (100%)</span>
                <span>Grand (135%)</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
