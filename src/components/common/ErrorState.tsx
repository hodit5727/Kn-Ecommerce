import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Service Interruption',
  message = 'Unable to load products. Please try again.',
  onRetry,
  isRetrying = false,
}) => {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4 bg-rosered-50/40 border border-rosered-200/80 rounded-2xl max-w-2xl mx-auto my-8 shadow-sm">
      <div className="w-14 h-14 rounded-2xl bg-rosered-100/80 flex items-center justify-center text-rosered-600 mb-4 shadow-soft">
        <AlertTriangle className="w-7 h-7" />
      </div>
      <h3 className="text-xl font-serif font-semibold text-stone-900 mb-2">{title}</h3>
      <p className="text-sm text-stone-600 max-w-md mb-6 leading-relaxed">
        {message}
      </p>
      {onRetry && (
        <Button
          variant="outline"
          size="md"
          onClick={onRetry}
          isLoading={isRetrying}
          leftIcon={<RefreshCw className="w-4 h-4" />}
          className="border-stone-300 text-stone-800 hover:bg-white"
        >
          Try Again
        </Button>
      )}
    </div>
  );
};
