import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'burgundy' | 'cream' | 'emerald' | 'amber' | 'rosered' | 'stone';
  size?: 'sm' | 'md';
  className?: string;
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'stone',
  size = 'md',
  className = '',
  dot = false,
}) => {
  const variantStyles = {
    burgundy: 'bg-burgundy-50 text-burgundy border-burgundy-200',
    cream: 'bg-cream-100 text-stone-800 border-cream-300',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    rosered: 'bg-rosered-50 text-rosered-800 border-rosered-200',
    stone: 'bg-stone-100 text-stone-700 border-stone-200',
  };

  const dotColors = {
    burgundy: 'bg-burgundy',
    cream: 'bg-amber-600',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rosered: 'bg-rosered-500',
    stone: 'bg-stone-400',
  };

  const sizeStyles = {
    sm: 'text-[10px] px-2 py-0.5 tracking-wider uppercase font-semibold',
    md: 'text-xs px-2.5 py-1 font-medium',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />}
      {children}
    </span>
  );
};
