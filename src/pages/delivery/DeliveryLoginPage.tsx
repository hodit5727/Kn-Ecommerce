import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { deliveryService } from '../../services/deliveryService';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Truck, Lock, Mail, ArrowRight, ShieldCheck, ChevronLeft } from 'lucide-react';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';

export const DeliveryLoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { refreshSession } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please provide both staff email and password.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await deliveryService.login(email.trim().toLowerCase(), password);
      await refreshSession();
      showToast('Delivery operator authenticated successfully!');
      navigate('/delivery');
    } catch (err: any) {
      setError(err.message || 'Invalid delivery operator credentials. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-cream-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-burgundy mb-6 font-semibold"
        >
          <ChevronLeft className="w-4 h-4" /> Back to Store
        </Link>

        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-burgundy flex items-center justify-center text-white shadow-soft">
            <Truck className="w-6 h-6" />
          </div>
        </div>
        <h2 className="text-center text-2xl font-serif font-bold tracking-tight text-stone-900">
          Delivery Staff Mobile Portal
        </h2>
        <p className="mt-1 text-center text-xs text-stone-500">
          Sign in to access assigned campus orders & verify customer delivery passes
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-soft rounded-3xl border border-cream-200">
          {error && (
            <div className="mb-5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
              <span className="font-bold">Access Denied:</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
                Staff Email Address
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="delivery@kshop.ac.in"
                  className="w-full bg-white border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
                />
                <Mail className="w-4 h-4 text-stone-400 absolute right-3 top-3" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
                Operator Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
                />
                <Lock className="w-4 h-4 text-stone-400 absolute right-3 top-3" />
              </div>
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                className="w-full py-3 bg-burgundy hover:bg-burgundy/90 text-white flex items-center justify-center gap-2"
                isLoading={isLoading}
              >
                Sign In to Delivery App <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </form>

          <div className="mt-6 pt-5 border-t border-cream-100 flex items-center justify-center gap-2 text-stone-400 text-[11px]">
            <ShieldCheck className="w-4 h-4 text-burgundy" />
            <span>Authorized K-Shop Campus Operations Only</span>
          </div>
        </div>
      </div>
    </div>
  );
};
