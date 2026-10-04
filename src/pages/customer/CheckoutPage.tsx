import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { orderService } from '../../services/orderService';
import { ShippingAddress } from '../../types/cart';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { ErrorState } from '../../components/common/ErrorState';
import { formatINR } from '../../lib/currency';
import {
  ShieldCheck,
  Truck,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Package,
  FileCheck
} from 'lucide-react';

import {
  CATEGORY_CONFIG,
} from '../../config/academicConfig';
import type { UserCategory } from '../../types/auth';

const DEPARTMENT_OPTIONS: Record<'Engineering' | 'Polytechnic' | 'B.Ed', readonly string[]> = {
  Engineering: CATEGORY_CONFIG.ENGINEERING.departments,
  Polytechnic: CATEGORY_CONFIG.POLYTECHNIC.departments,
  'B.Ed': CATEGORY_CONFIG.BED.departments,
};

const DEPARTMENT_DISPLAY_NAMES: Record<string, string> = {
  IT: 'IT - Information Technology',
  CSE: 'CSE - Computer Science & Engineering',
  C2C: 'C2C - Computer to Communication',
  EEE: 'EEE - Electrical & Electronics Engineering',
  ECE: 'ECE - Electronics & Communication Engineering',
  BME: 'BME - Biomedical Engineering',
  AGR: 'AGR - Agricultural Engineering',
  MECH: 'MECH - Mechanical Engineering',
  CIVIL: 'CIVIL - Civil Engineering',
  'Civil Engineering': 'Civil Engineering (Polytechnic)',
  'Automobile Engineering': 'Automobile Engineering (Polytechnic)',
  Mech: 'Mech - Mechanical Engineering (Polytechnic)',
  TAMIL: 'B.Ed Tamil',
  ENGLISH: 'B.Ed English',
  MATHS: 'B.Ed Mathematics',
};

export const CheckoutPage: React.FC = () => {
  const { items, subtotal, deliveryFee, totalAmount, clearCart } = useCart();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState<string>(user?.fullName ?? '');
  const [phone, setPhone] = useState<string>(user?.phone ?? '');
  const [campusStream, setCampusStream] = useState<'Engineering' | 'Polytechnic' | 'B.Ed'>('Engineering');
  const [department, setDepartment] = useState<string>(CATEGORY_CONFIG.ENGINEERING.departments[0]);
  const [customDept, setCustomDept] = useState<string>('');
  const [roomCabin, setRoomCabin] = useState<string>('');

  const [deliverySchedule, setDeliverySchedule] = useState<'STANDARD' | 'EXPEDITED'>('STANDARD');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Redirect unauthenticated guests to login
  useEffect(() => {
    if (!isLoading && (!isAuthenticated || !user)) {
      showToast('Please sign in to proceed to checkout.', 'info');
      navigate('/login', { state: { from: { pathname: '/checkout' } } });
    }
  }, [isLoading, isAuthenticated, user, navigate, showToast]);

  // Autofill user details from profile once loaded
  useEffect(() => {
    if (!user) return;
    if (user.fullName) setFullName((prev) => prev || user.fullName);
    if (user.phone) setPhone((prev) => prev || user.phone);

    // Map userCategory
    let targetStream: 'Engineering' | 'Polytechnic' | 'B.Ed' = 'Engineering';
    if (user.category === 'POLYTECHNIC') targetStream = 'Polytechnic';
    else if (user.category === 'BED') targetStream = 'B.Ed';
    setCampusStream(targetStream);

    // Map department
    if (user.department) {
      const opts = DEPARTMENT_OPTIONS[targetStream] || [];
      const matched = opts.find(
        (o) =>
          o.toLowerCase().includes(user.department!.toLowerCase()) ||
          user.department!.toLowerCase().includes(o.toLowerCase())
      );
      if (matched) {
        setDepartment(matched);
      } else {
        setDepartment('OTHER');
        setCustomDept((prev) => prev || user.department || '');
      }
    }

    if (user.registrationNumber && !roomCabin) {
      setRoomCabin(`Reg: ${user.registrationNumber}${user.year ? ` (Yr ${user.year})` : ''}`);
    } else if (user.staffCode && !roomCabin) {
      setRoomCabin(`Staff Code: ${user.staffCode}`);
    }
  }, [user]);

  // Redirect outside of render when the draft cart is empty
  useEffect(() => {
    if (items.length === 0) {
      navigate('/cart');
    }
  }, [items.length, navigate]);

  if (items.length === 0) {
    return null;
  }

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !phone.trim()) {
      setOrderError('Please provide your name and phone number.');
      return;
    }

    const finalDept = department === 'OTHER' ? customDept.trim() : department.trim();
    if (!finalDept) {
      setOrderError('Please specify your department.');
      return;
    }

    const finalAddress: ShippingAddress = {
      fullName: fullName.trim(),
      phone: phone.trim(),
      streetAddress: `${finalDept}, ${campusStream} Campus`,
      apartmentSuite: roomCabin.trim() ? `Room / Cabin: ${roomCabin.trim()}` : 'Campus Delivery',
      city: 'Campus',
      stateOrProvince: 'Tamil Nadu',
      postalCode: '600001',
      country: 'India',
    };

    setIsSubmitting(true);
    setOrderError(null);

    try {
      const order = await orderService.placeCODOrder(
        items,
        finalAddress,
        {
          id: user?.id ?? '',
          name: fullName.trim(),
          email: user?.email ?? '',
          phone: phone.trim(),
        }
      );

      clearCart();
      showToast('Order confirmed successfully!');
      navigate(`/orders/${order.id}`);
    } catch (err: any) {
      setOrderError(err.message || 'Unable to place Cash on Delivery order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Header */}
      <div className="border-b border-cream-200 pb-6">
        <span className="text-xs font-bold uppercase tracking-wider text-burgundy block mb-1">
          Cash on Delivery
        </span>
        <h1 className="text-3xl font-serif font-bold text-stone-900">
          Order Checkout
        </h1>
      </div>

      {orderError && (
        <ErrorState
          title="Order Submission Failed"
          message={orderError}
          onRetry={() => setOrderError(null)}
        />
      )}

      <form onSubmit={handlePlaceOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Form Steps */}
        <div className="lg:col-span-7 space-y-6">
          {/* Step 1: Destination Address */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft space-y-5">
            <div className="flex items-center gap-2 text-stone-900 pb-3 border-b border-cream-200">
              <MapPin className="w-5 h-5 text-burgundy" />
              <h2 className="font-serif font-bold text-lg">1. Campus Delivery Location</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Customer Full Name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your name"
              />
              <Input
                label="Mobile Phone Number"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10-digit mobile number"
              />
            </div>

            {/* Campus / Stream Selector: B.Ed, Polytechnic, Engineering */}
            <div>
              <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-2">
                Select College / Campus Stream
              </label>
              <div className="grid grid-cols-3 gap-3">
                {(['Engineering', 'Polytechnic', 'B.Ed'] as const).map((stream) => (
                  <button
                    key={stream}
                    type="button"
                    onClick={() => {
                      setCampusStream(stream);
                      setDepartment(DEPARTMENT_OPTIONS[stream][0]);
                    }}
                    className={`py-3 px-3 rounded-2xl border text-xs font-bold transition-all text-center ${
                      campusStream === stream
                        ? 'bg-burgundy text-white border-burgundy shadow-sm ring-1 ring-burgundy'
                        : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    {stream === 'Polytechnic' ? 'Polytechnic (Poly)' : stream}
                  </button>
                ))}
              </div>
            </div>

            {/* Department Selector */}
            <div>
              <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
                Department
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full bg-white border border-stone-200 rounded-xl p-3 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
              >
                {DEPARTMENT_OPTIONS[campusStream]?.map((dept) => (
                  <option key={dept} value={dept}>
                    {DEPARTMENT_DISPLAY_NAMES[dept] || dept}
                  </option>
                ))}
                <option value="OTHER">Other / Custom Department</option>
              </select>
            </div>

            {department === 'OTHER' && (
              <Input
                label="Specify Department Name"
                required
                value={customDept}
                onChange={(e) => setCustomDept(e.target.value)}
                placeholder="e.g. Science & Humanities, Admin Block, etc."
              />
            )}

            {/* Room / Lab / Cabin details */}
            <Input
              label="Classroom / Lab / Cabin No. (Optional)"
              value={roomCabin}
              onChange={(e) => setRoomCabin(e.target.value)}
              placeholder="e.g. Room 204, Software Lab 1, Staff Cabin"
            />
          </div>

          {/* Step 2: Delivery Schedule */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft space-y-4">
            <div className="flex items-center gap-2 text-stone-900 pb-3 border-b border-cream-200">
              <Truck className="w-5 h-5 text-burgundy" />
              <h2 className="font-serif font-bold text-lg">2. Delivery Method</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label
                className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                  deliverySchedule === 'STANDARD'
                    ? 'bg-ivory border-burgundy ring-1 ring-burgundy'
                    : 'border-stone-200 hover:bg-stone-50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-serif font-bold text-xs text-stone-900">
                      Standard Campus Delivery
                    </span>
                    <input
                      type="radio"
                      name="schedule"
                      checked={deliverySchedule === 'STANDARD'}
                      onChange={() => setDeliverySchedule('STANDARD')}
                      className="accent-burgundy"
                    />
                  </div>
                  <p className="text-xs text-stone-500">Delivered directly to your department</p>
                </div>
                <span className="text-xs font-bold text-emerald-700 mt-3">Free Delivery</span>
              </label>

              <label
                className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                  deliverySchedule === 'EXPEDITED'
                    ? 'bg-ivory border-burgundy ring-1 ring-burgundy'
                    : 'border-stone-200 hover:bg-stone-50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-serif font-bold text-xs text-stone-900">
                      Express Same-Day Priority
                    </span>
                    <input
                      type="radio"
                      name="schedule"
                      checked={deliverySchedule === 'EXPEDITED'}
                      onChange={() => setDeliverySchedule('EXPEDITED')}
                      className="accent-burgundy"
                    />
                  </div>
                  <p className="text-xs text-stone-500">Fast priority dispatch to your classroom</p>
                </div>
                <span className="text-xs font-bold text-stone-900 mt-3">+₹50</span>
              </label>
            </div>
          </div>

          {/* Step 3: Payment Method (STRICTLY CASH ON DELIVERY ONLY) */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft space-y-4">
            <div className="flex items-center gap-2 text-stone-900 pb-3 border-b border-cream-200">
              <ShieldCheck className="w-5 h-5 text-burgundy" />
              <h2 className="font-serif font-bold text-lg">3. Payment Protocol: Cash on Delivery Only</h2>
            </div>

            <div className="p-5 rounded-2xl bg-ivory border border-cream-300 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-burgundy text-white flex items-center justify-center font-bold text-sm">
                  COD
                </div>
                <div>
                  <h4 className="font-serif font-bold text-stone-900 text-sm">
                    Cash on Delivery (Physical Cash Handover)
                  </h4>
                  <p className="text-xs text-stone-500">
                    No advance online transaction. Settle cash with authorized courier.
                  </p>
                </div>
              </div>

              <ul className="text-xs text-stone-600 space-y-1.5 pt-2 border-t border-cream-200/80">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Inspect physical piece and serial number before handing over cash.</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Courier issues physical authenticated receipt on spot.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Right Column: Order Confirmation Summary */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft space-y-6 sticky top-28">
          <h3 className="font-serif font-bold text-lg text-stone-900 pb-3 border-b border-cream-200 flex items-center justify-between">
            <span>Order Summary</span>
            <span className="text-xs font-normal text-stone-500">{items.length} item(s)</span>
          </h3>

          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 text-xs">
                <img src={it.product.images[0]} alt="" className="w-12 h-12 rounded-xl object-cover" />
                <div className="flex-1 min-w-0">
                  <p className="font-serif font-semibold text-stone-900 truncate">{it.product.name}</p>
                  <p className="text-stone-500 text-[11px]">Qty: {it.quantity} • {it.product.brand}</p>
                </div>
                <span className="font-bold text-stone-900">
                  {formatINR(it.product.price * it.quantity)}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-cream-200 space-y-2 text-xs text-stone-600">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-semibold text-stone-900">{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Delivery Fee</span>
              <span>{deliveryFee === 0 ? <strong className="text-emerald-700 font-semibold">Free</strong> : formatINR(deliveryFee)}</span>
            </div>
            {deliverySchedule === 'EXPEDITED' && (
              <div className="flex justify-between">
                <span>Express Priority Handling</span>
                <span className="font-semibold text-stone-900">₹50</span>
              </div>
            )}
            <div className="flex justify-between pt-3 border-t border-cream-200 text-sm font-bold text-stone-900">
              <span>Total Cash Due upon Delivery</span>
              <span className="text-xl font-serif text-burgundy">
                {formatINR(totalAmount + (deliverySchedule === 'EXPEDITED' ? 50 : 0))}
              </span>
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            isLoading={isSubmitting}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Confirm COD Order
          </Button>

          <p className="text-center text-[11px] text-stone-400">
            Payment is collected in cash when your order arrives at your campus department.
          </p>
        </div>
      </form>
    </div>
  );
};
