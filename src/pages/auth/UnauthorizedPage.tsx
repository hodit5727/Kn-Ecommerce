import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowLeft, LogIn, Store } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { useAuth } from '../../auth/AuthContext';

export const UnauthorizedPage: React.FC = () => {
  const { user, activeRole, switchRole, openAuthModal } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const attemptedPath = (location.state as any)?.attemptedPath || '';

  const isApprovedSeller = Boolean(
    user && (user.isSellerApproved || user.role === 'SELLER' || user.roles?.includes('SELLER'))
  );
  const isSellerTarget = attemptedPath.startsWith('/seller') || attemptedPath === '';
  const canSwitchToSeller = isApprovedSeller && isSellerTarget;

  return (
    <div className="min-h-[75vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 sm:p-10 border border-cream-200 shadow-xl text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto border border-red-200">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-red-500 block mb-1">
            Access Restricted
          </span>
          <h1 className="text-2xl font-serif font-bold text-stone-900">
            {canSwitchToSeller ? 'Switch to Seller Mode' : "You don't have access"}
          </h1>
          <p className="text-xs text-stone-600 mt-2 leading-relaxed">
            {canSwitchToSeller ? (
              <>
                You are an accredited seller! You are currently browsing in{' '}
                <strong className="text-burgundy uppercase">{activeRole}</strong> mode. Click below
                to activate your Seller Portal.
              </>
            ) : user ? (
              <>
                Your current role (<strong className="text-burgundy uppercase">{activeRole}</strong>) does not
                have permission to access{' '}
                <span className="font-mono text-stone-800 font-semibold">
                  {attemptedPath || 'this area'}
                </span>.
              </>
            ) : (
              <>Please sign in to access this page.</>
            )}
          </p>
        </div>

        <div className="space-y-3 pt-2">
          {canSwitchToSeller && (
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={() => {
                switchRole('SELLER');
                navigate('/seller');
              }}
              leftIcon={<Store className="w-4 h-4" />}
            >
              Switch to Seller Mode & Enter
            </Button>
          )}

          {!user && (
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={openAuthModal}
              leftIcon={<LogIn className="w-4 h-4" />}
            >
              Sign In
            </Button>
          )}

          <Button
            variant="outline"
            size="md"
            className="w-full"
            onClick={() => navigate('/')}
            leftIcon={<ArrowLeft className="w-4 h-4" />}
          >
            Return to Home
          </Button>
        </div>
      </div>
    </div>
  );
};
