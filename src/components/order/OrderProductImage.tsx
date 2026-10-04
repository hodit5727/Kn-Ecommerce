import React, { useState } from 'react';
import { Package } from 'lucide-react';

interface OrderProductImageProps {
  src?: string;
  alt?: string;
  name?: string;
  className?: string;
  fallbackClassName?: string;
}

export const OrderProductImage: React.FC<OrderProductImageProps> = ({
  src,
  alt = 'Product Image',
  name = 'Product',
  className = 'w-14 h-14 rounded-xl object-cover bg-stone-100 border border-cream-200 flex-shrink-0 shadow-xs',
  fallbackClassName,
}) => {
  const [hasError, setHasError] = useState(false);

  // If no source provided or failed to load image over network
  if (!src || hasError) {
    const finalFallbackClass =
      fallbackClassName ||
      `${className} bg-gradient-to-br from-cream-100 to-cream-200 border border-cream-300 flex flex-col items-center justify-center text-center p-1 text-burgundy shadow-xs`;

    return (
      <div className={finalFallbackClass}>
        <Package className="w-5 h-5 stroke-[1.75]" />
        <span className="text-[8px] font-bold text-stone-700 truncate max-w-[50px] mt-0.5 uppercase tracking-wider">
          {name.slice(0, 10)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setHasError(true)}
      className={className}
    />
  );
};
