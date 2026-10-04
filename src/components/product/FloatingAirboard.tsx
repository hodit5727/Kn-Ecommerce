import React from 'react';
import { Sparkles, Shield, Clock } from 'lucide-react';

interface FloatingAirboardProps {
  badge?: string;
  title: string;
  metric?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  variant?: 'light' | 'dark';
  animationVariant?: 'default' | 'delayed';
  className?: string;
}

export const FloatingAirboard: React.FC<FloatingAirboardProps> = ({
  badge = 'AUTHENTICATED',
  title,
  metric,
  subtitle,
  icon,
  variant = 'light',
  animationVariant = 'default',
  className = '',
}) => {
  const animClass = animationVariant === 'delayed' ? 'airboard-landing-float-delayed' : 'airboard-landing-float';

  return (
    <div
      className={`${animClass} transition-all duration-300 ${
        variant === 'dark' ? 'airboard-dark text-white' : 'airboard text-stone-900'
      } rounded-2xl p-4 max-w-xs shadow-airboard ${className}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className={`text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full ${
            variant === 'dark'
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
              : 'bg-burgundy-50 text-burgundy border border-burgundy-200'
          }`}
        >
          {badge}
        </span>
        <div className={variant === 'dark' ? 'text-cream-300' : 'text-burgundy'}>
          {icon || <Sparkles className="w-3.5 h-3.5" />}
        </div>
      </div>

      <div className="space-y-0.5">
        <p className="text-xs font-serif font-semibold truncate">{title}</p>
        {metric && (
          <p className="text-lg font-bold tracking-tight text-burgundy">{metric}</p>
        )}
        {subtitle && (
          <p className={`text-[11px] ${variant === 'dark' ? 'text-stone-300' : 'text-stone-500'}`}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
};
