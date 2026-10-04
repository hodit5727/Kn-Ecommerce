import React from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  error?: string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  options,
  error,
  className = '',
  id,
  ...props
}) => {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={`w-full bg-white border ${
          error ? 'border-rosered-500' : 'border-stone-200 focus:border-burgundy focus:ring-burgundy'
        } rounded-lg px-3.5 py-2.5 text-sm text-stone-800 transition-colors duration-150 focus:outline-none focus:ring-1 ${className}`}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1.5 text-xs text-rosered-600 font-medium">{error}</p>}
    </div>
  );
};
