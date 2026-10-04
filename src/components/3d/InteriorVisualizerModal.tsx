import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Product } from '../../types/product';
import { Product3DViewer } from './Product3DViewer';
import { Sun, Moon, Lamp, Maximize2, Compass, Check } from 'lucide-react';

interface InteriorVisualizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
}

export const InteriorVisualizerModal: React.FC<InteriorVisualizerModalProps> = ({
  isOpen,
  onClose,
  product,
}) => {
  const [roomSetting, setRoomSetting] = useState<'salon' | 'penthouse' | 'gallery'>('salon');
  const [ambience, setAmbience] = useState<'daylight' | 'golden' | 'dusk'>('daylight');
  const [scaleFactor, setScaleFactor] = useState<number>(100);

  const roomBackdrops = {
    salon: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1600&q=80',
    penthouse: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=80',
    gallery: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1600&q=80',
  };

  const ambienceFilters = {
    daylight: 'backdrop-brightness-105 backdrop-contrast-100',
    golden: 'backdrop-sepia-[0.25] backdrop-brightness-100 backdrop-hue-rotate-[-10deg]',
    dusk: 'backdrop-brightness-90 backdrop-contrast-110 backdrop-saturate-80',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Spatial Architecture Visualizer"
      subtitle={`Spatial room placement simulation for ${product.name}`}
      maxWidth="4xl"
    >
      <div className="space-y-6">
        {/* Virtual Room Viewport */}
        <div className="relative h-[440px] w-full rounded-2xl overflow-hidden border border-cream-300 shadow-xl bg-stone-900">
          {/* Room Environment Photo */}
          <img
            src={roomBackdrops[roomSetting]}
            alt="Interior room setting"
            className={`w-full h-full object-cover transition-all duration-700 ${ambienceFilters[ambience]}`}
          />

          {/* Vignette & Ivory Light Reflection */}
          <div className="absolute inset-0 bg-radial from-transparent via-stone-950/20 to-stone-950/70 pointer-events-none" />

          {/* Floating 3D Item in Room Space */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-auto transition-transform duration-300"
            style={{ transform: `scale(${scaleFactor / 100})` }}
          >
            <div className="w-[320px] h-[320px] filter drop-shadow-[0_25px_35px_rgba(0,0,0,0.5)] animate-float-slow">
              <Product3DViewer product={product} autoRotate={true} className="h-full w-full" />
            </div>
          </div>

          {/* Floating Telemetry Airboard in Canvas */}
          <div className="absolute top-4 left-4 airboard px-4 py-2 rounded-xl text-xs text-stone-800 flex items-center gap-3">
            <div>
              <span className="text-[10px] uppercase font-bold text-burgundy block">Room Calibration</span>
              <span className="font-serif font-semibold">{roomSetting.toUpperCase()} • 1:1 Scale Ratio</span>
            </div>
          </div>

          <div className="absolute bottom-4 right-4 airboard px-3 py-1.5 rounded-full text-[11px] text-stone-600 flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-burgundy" />
            <span>Virtual AR Viewport</span>
          </div>
        </div>

        {/* Visualizer Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {/* Room Choice */}
          <div className="bg-ivory p-4 rounded-xl border border-cream-200">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-700 block mb-2.5">
              Interior Setting
            </span>
            <div className="flex gap-2">
              {(['salon', 'penthouse', 'gallery'] as const).map((env) => (
                <button
                  key={env}
                  onClick={() => setRoomSetting(env)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg capitalize border transition-all ${
                    roomSetting === env
                      ? 'bg-burgundy text-white border-burgundy shadow-xs'
                      : 'bg-white text-stone-700 border-cream-300 hover:bg-cream-50'
                  }`}
                >
                  {env}
                </button>
              ))}
            </div>
          </div>

          {/* Ambience Lighting */}
          <div className="bg-ivory p-4 rounded-xl border border-cream-200">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-700 block mb-2.5">
              Atmospheric Lighting
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setAmbience('daylight')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border flex items-center justify-center gap-1.5 transition-all ${
                  ambience === 'daylight'
                    ? 'bg-burgundy text-white border-burgundy shadow-xs'
                    : 'bg-white text-stone-700 border-cream-300 hover:bg-cream-50'
                }`}
              >
                <Sun className="w-3.5 h-3.5" /> Sun
              </button>
              <button
                onClick={() => setAmbience('golden')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border flex items-center justify-center gap-1.5 transition-all ${
                  ambience === 'golden'
                    ? 'bg-burgundy text-white border-burgundy shadow-xs'
                    : 'bg-white text-stone-700 border-cream-300 hover:bg-cream-50'
                }`}
              >
                <Lamp className="w-3.5 h-3.5 text-amber-500" /> Warm
              </button>
              <button
                onClick={() => setAmbience('dusk')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border flex items-center justify-center gap-1.5 transition-all ${
                  ambience === 'dusk'
                    ? 'bg-burgundy text-white border-burgundy shadow-xs'
                    : 'bg-white text-stone-700 border-cream-300 hover:bg-cream-50'
                }`}
              >
                <Moon className="w-3.5 h-3.5" /> Dusk
              </button>
            </div>
          </div>

          {/* Scale Adjustment */}
          <div className="bg-ivory p-4 rounded-xl border border-cream-200">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700">
                Spatial Scale
              </span>
              <span className="text-xs font-semibold text-burgundy">{scaleFactor}%</span>
            </div>
            <input
              type="range"
              min="70"
              max="130"
              value={scaleFactor}
              onChange={(e) => setScaleFactor(Number(e.target.value))}
              className="w-full accent-burgundy cursor-pointer"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};
