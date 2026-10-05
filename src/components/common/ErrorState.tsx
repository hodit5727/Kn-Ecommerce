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
  const isAuthError = Boolean(
    message &&
      (message.toLowerCase().includes('not signed in') ||
        message.toLowerCase().includes('session expired') ||
        message.toLowerCase().includes('not authenticated') ||
        message.toLowerCase().includes('unauthorized') ||
        message.toLowerCase().includes('401') ||
        message.toLowerCase().includes('login required') ||
        message.toLowerCase().includes('sign in'))
  );

  React.useEffect(() => {
    if (isAuthError && typeof window !== 'undefined') {
      const currentPath = window.location.pathname;
      const targetLogin = currentPath.startsWith('/admin')
        ? `/admin/login?from=${encodeURIComponent(currentPath)}`
        : currentPath.startsWith('/delivery')
        ? `/delivery/login?from=${encodeURIComponent(currentPath)}`
        : `/login?from=${encodeURIComponent(currentPath)}`;

      const timer = setTimeout(() => {
        window.location.href = targetLogin;
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [isAuthError]);

  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4 bg-rosered-50/40 border border-rosered-200/80 rounded-2xl max-w-2xl mx-auto my-8 shadow-sm">
      <div className="w-14 h-14 rounded-2xl bg-rosered-100/80 flex items-center justify-center text-rosered-600 mb-4 shadow-soft">
        <AlertTriangle className="w-7 h-7" />
      </div>
      <h3 className="text-xl font-serif font-semibold text-stone-900 mb-2">{title}</h3>
      <p className="text-sm text-stone-600 max-w-md mb-6 leading-relaxed">
        {isAuthError ? 'Your session has expired. Redirecting you to sign in...' : message}
      </p>
      {isAuthError ? (
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            const currentPath = window.location.pathname;
            const targetLogin = currentPath.startsWith('/admin')
              ? `/admin/login?from=${encodeURIComponent(currentPath)}`
              : currentPath.startsWith('/delivery')
              ? `/delivery/login?from=${encodeURIComponent(currentPath)}`
              : `/login?from=${encodeURIComponent(currentPath)}`;
            window.location.href = targetLogin;
          }}
          className="bg-burgundy text-white hover:bg-burgundy/90 shadow-sm"
        >
          Sign In Now
        </Button>
      ) : (
        onRetry && (
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
        )
      )}
    </div>
  );
};
