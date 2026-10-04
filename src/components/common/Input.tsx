import React, { forwardRef } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  helperText,
  leftElement,
  rightElement,
  className = '',
  id,
  ...props
}, ref) => {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leftElement && (
          <div className="absolute left-3.5 flex items-center pointer-events-none text-stone-400">
            {leftElement}
          </div>
        )}
        <input
          id={inputId}
          ref={ref}
          className={`w-full bg-white border ${
            error ? 'border-rosered-500 focus:ring-rosered-500' : 'border-stone-200 focus:border-burgundy focus:ring-burgundy'
          } rounded-lg px-4 py-2.5 text-sm text-stone-900 placeholder-stone-400 transition-colors duration-150 focus:outline-none focus:ring-1 ${
            leftElement ? 'pl-10' : ''
          } ${rightElement ? 'pr-10' : ''} ${className}`}
          {...props}
        />
        {rightElement && (
          <div className="absolute right-3.5 flex items-center text-stone-400">
            {rightElement}
          </div>
        )}
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-rosered-600 font-medium">{error}</p>
      ) : helperText ? (
        <p className="mt-1.5 text-xs text-stone-500">{helperText}</p>
      ) : null}
    </div>
  );
});

Input.displayName = 'Input';
