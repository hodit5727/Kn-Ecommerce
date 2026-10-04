import React, { useState, useEffect } from 'react';
import { adminService, AdminCoupon } from '../../services/adminService';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Select } from '../../components/common/Select';
import {
  Ticket,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Copy,
  Calendar,
  Percent,
  IndianRupee,
  ShieldCheck,
  X,
  Clock,
  Sparkles,
} from 'lucide-react';
import { formatINR } from '../../lib/currency';

export const AdminCouponsPage: React.FC = () => {
  const { showToast } = useToast();
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    code: '',
    description: '',
    couponKind: 'PERCENT' as 'PERCENT' | 'FIXED',
    discountValue: 10,
    maxDiscount: 500 as number | undefined,
    minOrderAmount: 499 as number | undefined,
    oneTimePerCustomer: true,
    expiresAt: '',
  });

  const loadCoupons = async () => {
    setIsLoading(true);
    try {
      const list = await adminService.getCoupons();
      setCoupons(list);
    } catch (err: any) {
      showToast(err.message || 'Unable to load coupons.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCoupons();
  }, []);

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code.trim()) {
      showToast('Please enter a coupon code.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await adminService.createCoupon({
        code: formData.code.trim().toUpperCase(),
        description: formData.description.trim() || undefined,
        couponKind: formData.couponKind,
        discountValue: Number(formData.discountValue),
        maxDiscount: formData.maxDiscount ? Number(formData.maxDiscount) : undefined,
        minOrderAmount: formData.minOrderAmount ? Number(formData.minOrderAmount) : undefined,
        oneTimePerCustomer: formData.oneTimePerCustomer,
        expiresAt: formData.expiresAt || undefined,
      });

      showToast(`Coupon ${formData.code.toUpperCase()} created successfully!`, 'success');
      setIsModalOpen(false);
      setFormData({
        code: '',
        description: '',
        couponKind: 'PERCENT',
        discountValue: 10,
        maxDiscount: 500,
        minOrderAmount: 499,
        oneTimePerCustomer: true,
        expiresAt: '',
      });
      loadCoupons();
    } catch (err: any) {
      showToast(err.message || 'Failed to create coupon.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggle = async (id: string, code: string) => {
    try {
      const updated = await adminService.toggleCouponStatus(id);
      showToast(`Coupon ${code} is now ${updated.is_active ? 'Active' : 'Inactive'}.`);
      setCoupons((prev) =>
        prev.map((c) => (c.id === id ? { ...c, is_active: updated.is_active } : c))
      );
    } catch (err: any) {
      showToast(err.message || 'Failed to update coupon status.', 'error');
    }
  };

  const handleDelete = async (id: string, code: string) => {
    if (!window.confirm(`Are you sure you want to delete coupon ${code}?`)) return;
    try {
      await adminService.deleteCoupon(id);
      showToast(`Coupon ${code} deleted.`);
      setCoupons((prev) => prev.filter((c) => c.id !== id));
    } catch (err: any) {
      showToast(err.message || 'Failed to delete coupon.', 'error');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast(`Copied ${text} to clipboard!`, 'info');
  };

  const activeCount = coupons.filter((c) => c.is_active).length;

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
            Platform Promotions & Marketing
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Coupon Management
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Create and govern platform discount coupons for customer checkouts and return retention.
          </p>
        </div>

        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={() => setIsModalOpen(true)}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          Create Coupon
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-stone-200 shadow-soft">
          <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Total Coupons</span>
          <p className="text-2xl font-serif font-bold text-stone-900 mt-1">{coupons.length}</p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-stone-200 shadow-soft">
          <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Active Coupons</span>
          <p className="text-2xl font-serif font-bold text-emerald-600 mt-1">{activeCount}</p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-stone-200 shadow-soft">
          <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Redemption Engine</span>
          <p className="text-xs font-semibold text-stone-800 mt-2 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" /> Race-Safe DB Enforced
          </p>
        </div>
      </div>

      {/* Coupons List */}
      {isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Loading coupons catalog...</div>
      ) : coupons.length === 0 ? (
        <div className="bg-white p-12 rounded-3xl border border-stone-200 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <Ticket className="w-6 h-6" />
          </div>
          <h3 className="font-serif font-bold text-base text-stone-800">No Coupons Created Yet</h3>
          <p className="text-xs text-stone-500 max-w-sm mx-auto">
            Create promotional discount codes for festivals, student welcome offers, or customer return recovery.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsModalOpen(true)}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Create Your First Coupon
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {coupons.map((coupon) => (
            <div
              key={coupon.id}
              className={`bg-white rounded-3xl p-6 border shadow-soft flex flex-col justify-between space-y-4 transition-all ${
                coupon.is_active ? 'border-stone-200' : 'border-stone-200/60 opacity-60 bg-stone-50/50'
              }`}
            >
              <div className="space-y-3">
                {/* Header Badge */}
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                      coupon.is_active
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-stone-100 text-stone-500 border-stone-200'
                    }`}
                  >
                    {coupon.is_active ? 'Active' : 'Disabled'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleToggle(coupon.id, coupon.code)}
                      className={`text-xs px-2 py-0.5 rounded-lg border font-semibold transition-colors ${
                        coupon.is_active
                          ? 'border-stone-200 text-stone-600 hover:bg-stone-100'
                          : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                      }`}
                    >
                      {coupon.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(coupon.id, coupon.code)}
                      className="p-1 text-stone-400 hover:text-red-600 transition-colors"
                      title="Delete coupon"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Code Pill */}
                <div className="flex items-center justify-between p-3 rounded-2xl bg-cream-50 border border-cream-200">
                  <div className="flex items-center gap-2">
                    <Ticket className="w-4 h-4 text-burgundy" />
                    <span className="font-mono font-bold text-sm tracking-wider text-stone-900">
                      {coupon.code}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(coupon.code)}
                    className="p-1 text-stone-400 hover:text-burgundy"
                    title="Copy code"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Value & Description */}
                <div>
                  <div className="text-xl font-serif font-bold text-burgundy flex items-center gap-1">
                    {coupon.coupon_kind === 'PERCENT' ? (
                      <>
                        <Percent className="w-5 h-5 text-amber-600" />
                        <span>{coupon.discount_value}% OFF</span>
                      </>
                    ) : (
                      <>
                        <IndianRupee className="w-5 h-5 text-emerald-600" />
                        <span>{formatINR(coupon.discount_value)} OFF</span>
                      </>
                    )}
                  </div>
                  {coupon.description && (
                    <p className="text-xs text-stone-600 mt-1 line-clamp-2 leading-relaxed">
                      {coupon.description}
                    </p>
                  )}
                </div>

                {/* Rules List */}
                <div className="space-y-1.5 pt-2 border-t border-stone-100 text-[11px] text-stone-500">
                  {coupon.min_order_amount && (
                    <div className="flex justify-between">
                      <span>Min Order:</span>
                      <span className="font-semibold text-stone-800">{formatINR(coupon.min_order_amount)}</span>
                    </div>
                  )}
                  {coupon.max_discount && (
                    <div className="flex justify-between">
                      <span>Max Discount:</span>
                      <span className="font-semibold text-stone-800">{formatINR(coupon.max_discount)}</span>
                    </div>
                  )}
                  {coupon.expires_at && (
                    <div className="flex justify-between items-center text-amber-700">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Expires:
                      </span>
                      <span className="font-semibold">
                        {new Date(coupon.expires_at).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Coupon Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full border border-stone-200 shadow-xl space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-burgundy/10 text-burgundy flex items-center justify-center font-bold">
                  <Ticket className="w-4 h-4" />
                </div>
                <h3 className="font-serif font-bold text-lg text-stone-900">Create New Coupon</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCoupon} className="space-y-4">
              <Input
                label="Coupon Code"
                placeholder="e.g. WELCOME10, FESTIVE25"
                required
                minLength={4}
                maxLength={24}
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              />

              <Input
                label="Description (Optional)"
                placeholder="e.g. 10% discount on first orders over ₹499"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />

              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Discount Type"
                  value={formData.couponKind}
                  onChange={(e) => setFormData({ ...formData, couponKind: e.target.value as any })}
                  options={[
                    { value: 'PERCENT', label: 'Percentage (%)' },
                    { value: 'FIXED', label: 'Flat Amount (₹)' },
                  ]}
                />
                <Input
                  label={`Discount ${formData.couponKind === 'PERCENT' ? '(%)' : '(₹)'}`}
                  type="number"
                  required
                  min={1}
                  max={formData.couponKind === 'PERCENT' ? 100 : undefined}
                  value={formData.discountValue}
                  onChange={(e) => setFormData({ ...formData, discountValue: Number(e.target.value) })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Min Order Amount (₹)"
                  type="number"
                  placeholder="Optional min total"
                  value={formData.minOrderAmount || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      minOrderAmount: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
                <Input
                  label="Max Discount Cap (₹)"
                  type="number"
                  placeholder="Optional max cap"
                  value={formData.maxDiscount || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      maxDiscount: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
              </div>

              <Input
                label="Expiry Date (Optional)"
                type="date"
                value={formData.expiresAt}
                onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
              />

              <label className="flex items-center gap-2 text-xs font-semibold text-stone-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={formData.oneTimePerCustomer}
                  onChange={(e) => setFormData({ ...formData, oneTimePerCustomer: e.target.checked })}
                  className="rounded border-stone-300 text-burgundy focus:ring-burgundy"
                />
                <span>One-time use per customer</span>
              </label>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-stone-100">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={isSubmitting}
                >
                  Save Coupon
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
