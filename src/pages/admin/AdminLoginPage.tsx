/**
 * /admin/login — dedicated Admin Login (spec §4).
 *
 * Email + password are verified SERVER-SIDE by Express against a
 * server-provisioned admin account; the HttpOnly session cookie and the
 * ADMIN role check live in the backend. This page contains no credentials,
 * no bypass, and no fallback — an unavailable backend or wrong credentials
 * produces a real error state (AGENTS.md rules 7/8/13).
 */
import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';

export const AdminLoginPage: React.FC = () => {
  const { user, isAuthenticated, isLoading, adminLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  useEffect(() => {
    // If the real backend session confirms an authenticated ADMIN, directly open admin dashboard
    if (!isLoading && isAuthenticated && user && (user.role === 'ADMIN' || user.roles?.includes('ADMIN'))) {
      navigate(from && from.startsWith('/admin') ? from : '/admin', { replace: true });
    }
  }, [isLoading, isAuthenticated, user, from, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your admin email and password.');
      return;
    }
    setIsSubmitting(true);
    try {
      await adminLogin(email.trim(), password);
      // Success navigation only AFTER the backend confirmed the session.
      navigate(from && from.startsWith('/admin') ? from : '/admin', { replace: true });
    } catch (err) {
      // Real backend error (invalid credentials / server unreachable) surfaced
      // verbatim — no silent retries, no mock success state.
      setError(err instanceof Error ? err.message : 'Admin sign-in failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 bg-gradient-to-br from-stone-900 via-stone-800 to-stone-950">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mx-auto" />
          <p className="text-xs text-stone-400">Verifying administrator authorization…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 bg-gradient-to-br from-stone-900 via-stone-800 to-stone-950">
      <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 border border-stone-200 shadow-2xl space-y-5">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-stone-900 text-amber-300 flex items-center justify-center mx-auto shadow-soft">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-stone-900">K-Shop Control</h1>
          <p className="text-xs text-stone-500">Administrator access — authorized personnel only</p>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium text-center"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Admin Email"
            type="email"
            autoComplete="username"
            placeholder="admin@your-org.com"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            isLoading={isSubmitting}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Sign In to Admin Tower
          </Button>
        </form>

        <div className="flex items-center justify-between text-xs">
          <Link to="/" className="font-semibold text-stone-500 hover:text-stone-700 flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> Back to store
          </Link>
          <Link to="/login" className="font-semibold text-burgundy hover:underline">
            Customer sign-in
          </Link>
        </div>

        <p className="text-[11px] text-stone-400 text-center leading-relaxed">
          Admin accounts are provisioned server-side. Passwords are verified by the backend —
          no credentials are ever stored in this application.
        </p>
      </div>
    </div>
  );
};
