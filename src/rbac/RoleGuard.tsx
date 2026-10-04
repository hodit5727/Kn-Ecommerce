import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { UserRole } from '../types/auth';
import { IS_UI_PREVIEW, buildPreviewRoleProfile } from '../lib/uiPreview';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ children, allowedRoles }) => {
  const { user, isAuthenticated, activeRole, switchRole, isPreviewSession, isLoading, startPreviewSession } = useAuth();
  const location = useLocation();

  const isApprovedSeller = Boolean(
    user && (user.isSellerApproved || user.role === 'SELLER' || user.roles?.includes('SELLER'))
  );

  useEffect(() => {
    // If accessing seller routes as an accredited seller, ensure activeRole is SELLER
    if (isApprovedSeller && allowedRoles.includes('SELLER') && activeRole !== 'SELLER') {
      switchRole('SELLER');
    }
  }, [isApprovedSeller, allowedRoles, activeRole, switchRole]);

  // UI preview mode (DEV + ?uiPreview=1 only; stripped from production builds):
  // attach a clearly-labeled local preview session carrying this route's
  // required role so the seller/admin dashboards can be inspected before the
  // backend exists. Never runs without the flag — production still redirects
  // to /login, and a real (non-preview) session is never overwritten.
  const needsPreviewSession =
    IS_UI_PREVIEW &&
    (!user || (isPreviewSession && user.role !== 'ADMIN' && !allowedRoles.includes(activeRole)));

  useEffect(() => {
    if (needsPreviewSession) {
      startPreviewSession(buildPreviewRoleProfile(allowedRoles[0]));
    }
    // `user`/`activeRole` are required deps: AuthContext's role-sync effect
    // runs after child effects with stale state (user=null) and can reset
    // activeRole to CUSTOMER in the same commit — without these deps the
    // boolean `needsPreviewSession` stays unchanged and this effect would
    // never re-fire, leaving the route blank forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPreviewSession, user, activeRole, allowedRoles, startPreviewSession]);

  if (needsPreviewSession) {
    // One render tick: the preview session is attached in the effect above.
    return null;
  }

  if (isLoading) {
    // AuthContext boots with user=null and restores the session asynchronously
    // via /auth/session. Redirecting during that window would log the user out
    // on every refresh (§5-17/81: auth state inconsistent after refresh).
    // Wait for the server-verified session before deciding where to send them.
    return (
      <div className="min-h-screen grid place-items-center bg-stone-50">
        <div className="text-xs text-stone-500 animate-pulse">Verifying session…</div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    // Admin-only guards lead to the dedicated admin login page; everything
    // else uses the shared customer flow. Never a client-side bypass.
    const loginPath =
      allowedRoles.length === 1 && allowedRoles[0] === 'ADMIN' ? '/admin/login' : '/login';
    return <Navigate to={loginPath} state={{ from: location }} replace />;
  }

  // Check if active role or verified permissions allow access
  const hasAccess =
    user.role === 'ADMIN' ||
    allowedRoles.includes(activeRole) ||
    (allowedRoles.includes('SELLER') && isApprovedSeller);

  if (!hasAccess) {
    return <Navigate to="/unauthorized" state={{ attemptedPath: location.pathname, requiredRoles: allowedRoles }} replace />;
  }

  return <>{children}</>;
};
