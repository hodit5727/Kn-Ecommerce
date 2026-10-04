import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { orderService } from '../../services/orderService';
import { authService } from '../../services/authService';
import { useAuth } from '../../auth/AuthContext';
import { Order } from '../../types/order';
import { OrderTimeline } from '../../components/orders/OrderTimeline';
import { CancelOrderModal } from '../../components/orders/CancelOrderModal';
import { RefundRequestModal } from '../../components/refunds/RefundRequestModal';
import { ErrorState } from '../../components/common/ErrorState';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { useToast } from '../../context/ToastContext';
import { formatINR } from '../../lib/currency';
import { OrderProductImage } from '../../components/order/OrderProductImage';
import {
  ChevronLeft,
  MapPin,
  Truck,
  ShieldCheck,
  RotateCcw,
  FileText,
  Printer,
  Eye,
  EyeOff,
  Lock,
  QrCode as QrIcon,
  CheckCircle2,
  Receipt,
  X,
  KeyRound
} from 'lucide-react';

export const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Security PIN unlock & QR state
  const [isPinUnlocked, setIsPinUnlocked] = useState<boolean>(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);
  const [enteredPin, setEnteredPin] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isVerifyingPin, setIsVerifyingPin] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Print mode: 'standard' or 'thermal'
  const [printMode, setPrintMode] = useState<'standard' | 'thermal'>('standard');

  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const fetchOrder = async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await orderService.getOrderById(id);
      setOrder(data);
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve order details.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
  }, [id]);

  // Normalized order code KNOR-XXXX
  const displayOrderCode = order
    ? order.orderCode ||
      (order.orderNumber?.match(/\d{4}$/)
        ? `KNOR-${order.orderNumber.match(/\d{4}/)![0]}`
        : `KNOR-${order.id.slice(0, 4).toUpperCase()}`)
    : '';

  // Generate live scannable QR code
  useEffect(() => {
    if (!order) return;
    const qrPayload = JSON.stringify({
      orderId: order.id,
      orderCode: displayOrderCode,
      customerName: order.shippingAddress.fullName,
      phone: order.shippingAddress.phone,
      campusLocation: `${order.shippingAddress.streetAddress}, ${order.shippingAddress.apartmentSuite || ''}`,
      amount: order.totalAmount,
      status: order.orderStatus,
      token: order.id.slice(0, 6).toUpperCase(),
    });

    QRCode.toDataURL(qrPayload, {
      width: 240,
      margin: 1,
      color: {
        dark: '#171717',
        light: '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('[OrderDetailPage] QR Generation failed:', err));
  }, [order, displayOrderCode]);

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredPin || enteredPin.length !== 4) {
      setPinError('Please enter your 4-digit security PIN.');
      return;
    }
    if (!user?.email) {
      setPinError('Account session not detected. Please sign in again.');
      return;
    }

    setIsVerifyingPin(true);
    setPinError(null);
    try {
      await authService.verifyPin(user.email, enteredPin);
      setIsPinUnlocked(true);
      setIsPinModalOpen(false);
      setEnteredPin('');
      showToast('PIN verified! Delivery QR Code and customer handover pass unlocked.');
    } catch (err: any) {
      setPinError(err.message || 'Incorrect PIN. Please try again.');
    } finally {
      setIsVerifyingPin(false);
    }
  };

  const handleConfirmCancel = async (orderId: string, reason: string) => {
    try {
      await orderService.cancelOrder(orderId, reason);
      showToast('Order cancelled.');
      fetchOrder();
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel order.', 'error');
    }
  };

  const triggerThermalPrint = () => {
    setPrintMode('thermal');
    setTimeout(() => {
      window.print();
    }, 150);
  };

  const triggerStandardPrint = () => {
    setPrintMode('standard');
    setTimeout(() => {
      window.print();
    }, 150);
  };

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16">
        <ErrorState title="Order Not Found" message={error} onRetry={fetchOrder} />
      </div>
    );
  }

  if (isLoading || !order) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center text-xs text-stone-500">
        <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-3" />
        Loading Order Details...
      </div>
    );
  }

  return (
    <>
      {/* Dynamic Print Styles for Standard and Thermal POS */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-order-section, #printable-order-section * {
            visibility: visible;
          }
          #printable-order-section {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          ${
            printMode === 'thermal'
              ? `
            @page {
              size: 80mm auto;
              margin: 3mm;
            }
            #printable-order-section {
              width: 76mm !important;
              max-width: 76mm !important;
              font-family: monospace !important;
              font-size: 11px !important;
              line-height: 1.3 !important;
              color: #000 !important;
              padding: 4px !important;
            }
            .hide-on-thermal {
              display: none !important;
            }
            .show-on-thermal {
              display: block !important;
            }
          `
              : `
            @page {
              size: A4 portrait;
              margin: 15mm;
            }
            .hide-on-standard {
              display: none !important;
            }
          `
          }
        }
      `}</style>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Back navigation */}
        <Link
          to="/orders"
          className="inline-flex items-center gap-1 text-xs font-semibold text-stone-600 hover:text-burgundy print:hidden"
        >
          <ChevronLeft className="w-4 h-4" /> Back to Orders
        </Link>

        {/* Printable Master Container */}
        <div id="printable-order-section" className="space-y-6">
          {/* Header Banner */}
          <div className="bg-white rounded-3xl p-6 sm:p-7 border border-cream-200 shadow-soft flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-burgundy bg-burgundy/10 px-2 py-0.5 rounded">
                  Cash On Delivery Order
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {order.orderStatus.replace('COD_', '')}
                </span>
              </div>
              <h1 className="text-2xl font-serif font-bold text-stone-900">
                Order ID: <span className="font-mono text-burgundy">{displayOrderCode}</span>
              </h1>
              <p className="text-xs text-stone-500 mt-1 flex items-center gap-2 flex-wrap">
                <span>Placed on {new Date(order.createdAt).toLocaleDateString()}</span>
                <span>•</span>
                <span>Total: <strong className="text-stone-900">{formatINR(order.totalAmount)}</strong></span>
                {order.customerBusinessId && (
                  <>
                    <span>•</span>
                    <span className="font-mono font-bold text-burgundy bg-burgundy/5 px-2 py-0.5 rounded border border-burgundy/10 text-[11px]">
                      Customer ID: {order.customerBusinessId}
                    </span>
                  </>
                )}
              </p>
            </div>

            {/* Print & Action Controls */}
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button
                onClick={triggerThermalPrint}
                className="px-3 py-2 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-50 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                title="Print 80mm POS thermal receipt"
              >
                <Receipt className="w-4 h-4 text-burgundy" /> Print POS Thermal Slip
              </button>
              <button
                onClick={triggerStandardPrint}
                className="px-3 py-2 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 text-xs flex items-center gap-1.5 transition-colors"
                title="Print standard A4 invoice"
              >
                <Printer className="w-4 h-4" /> Print Invoice
              </button>
              {order.isEligibleForCancel && (
                <Button variant="destructive" size="sm" onClick={() => setIsCancelModalOpen(true)}>
                  Cancel Order
                </Button>
              )}
              {order.isEligibleForRefund && (
                <Button variant="outline" size="sm" onClick={() => setIsRefundModalOpen(true)}>
                  Request Refund
                </Button>
              )}
            </div>
          </div>

          {/* Dedicated Handover QR Code & Campus Pass Section */}
          <div className="bg-gradient-to-br from-white to-cream-50 rounded-3xl p-6 sm:p-7 border-2 border-cream-300 shadow-soft">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-cream-200">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-burgundy/10 flex items-center justify-center text-burgundy">
                  <QrIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2">
                    Campus Delivery Handover Pass
                    {isPinUnlocked ? (
                      <span className="text-[10px] font-sans font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> VERIFIED
                      </span>
                    ) : (
                      <span className="text-[10px] font-sans font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-300 inline-flex items-center gap-1">
                        <Lock className="w-3 h-3" /> PIN PROTECTED
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-stone-500">
                    Present this pass and scan the QR code with the delivery person upon arrival on campus.
                  </p>
                </div>
              </div>

              {/* Eye Button Toggle */}
              <div className="print:hidden">
                {isPinUnlocked ? (
                  <button
                    onClick={() => setIsPinUnlocked(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-100 text-xs font-semibold transition-colors"
                  >
                    <EyeOff className="w-4 h-4 text-stone-500" /> Lock Pass
                  </button>
                ) : (
                  <button
                    onClick={() => setIsPinModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-burgundy text-white hover:bg-burgundy/90 text-xs font-semibold shadow-sm transition-all"
                  >
                    <Eye className="w-4 h-4" /> Enter PIN to Unlock QR
                  </button>
                )}
              </div>
            </div>

            {/* QR and Customer Map Container */}
            <div className="pt-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
              {/* QR Code Presentation */}
              <div className="md:col-span-5 flex flex-col items-center justify-center p-5 bg-white rounded-2xl border border-cream-200 shadow-sm text-center relative overflow-hidden">
                {isPinUnlocked ? (
                  <>
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="Order Delivery QR"
                        className="w-48 h-48 rounded-xl border border-stone-200 p-2 bg-white shadow-inner"
                      />
                    ) : (
                      <div className="w-48 h-48 rounded-xl bg-stone-100 flex items-center justify-center text-xs text-stone-400">
                        Generating QR Code...
                      </div>
                    )}
                    <span className="font-mono text-xs font-bold text-stone-700 mt-2 block tracking-wider">
                      {displayOrderCode}
                    </span>
                    <span className="text-[10px] text-stone-400">Scan via Delivery Operator App</span>
                  </>
                ) : (
                  <div className="py-6 px-4 flex flex-col items-center justify-center space-y-3">
                    <div className="relative">
                      {qrDataUrl && (
                        <img
                          src={qrDataUrl}
                          alt="Locked QR"
                          className="w-44 h-44 rounded-xl filter blur-md opacity-25 p-2"
                        />
                      )}
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-stone-900/10 backdrop-blur-[2px] rounded-xl p-4">
                        <div className="w-12 h-12 rounded-full bg-white shadow-md flex items-center justify-center text-burgundy mb-2">
                          <Lock className="w-6 h-6" />
                        </div>
                        <span className="text-xs font-bold text-stone-800 text-center">
                          QR Pass Protected
                        </span>
                        <span className="text-[10px] text-stone-600 text-center mt-1">
                          Click Eye symbol to enter your 4-digit PIN
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setIsPinModalOpen(true)}
                      className="px-4 py-2 rounded-xl bg-burgundy text-white text-xs font-bold flex items-center gap-1.5 shadow-sm hover:bg-burgundy/90 transition-all print:hidden"
                    >
                      <Eye className="w-4 h-4" /> Enter PIN to Reveal
                    </button>
                  </div>
                )}
              </div>

              {/* Mapped Customer Delivery Details */}
              <div className="md:col-span-7 space-y-3 text-xs">
                <div className="bg-white rounded-2xl p-4 sm:p-5 border border-cream-200 shadow-sm space-y-2.5">
                  <div className="flex items-center justify-between pb-2 border-b border-cream-100">
                    <span className="font-semibold text-stone-500 uppercase tracking-wider text-[10px]">
                      Customer Handover Dossier
                    </span>
                    <span className="font-mono text-[10px] text-stone-400">
                      TOKEN: {order.id.slice(0, 6).toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <span className="text-stone-400 block text-[10px]">Customer Name</span>
                      <strong className="text-stone-900 font-semibold text-sm">
                        {order.shippingAddress.fullName}
                      </strong>
                    </div>
                    <div>
                      <span className="text-stone-400 block text-[10px]">Mobile Number</span>
                      <strong className="text-stone-900 font-mono text-sm">
                        {order.shippingAddress.phone}
                      </strong>
                    </div>
                    <div>
                      <span className="text-stone-400 block text-[10px]">Campus & Department</span>
                      <p className="text-stone-800 font-medium">
                        {order.shippingAddress.streetAddress}
                      </p>
                    </div>
                    <div>
                      <span className="text-stone-400 block text-[10px]">Classroom / Cabin</span>
                      <p className="text-stone-800 font-medium">
                        {order.shippingAddress.apartmentSuite || 'Direct Campus Handover'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-cream-100 flex items-center justify-between bg-cream-50/70 p-3 rounded-xl">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-stone-500 block">
                        Cash on Delivery Due
                      </span>
                      <span className="text-xs text-stone-500">Collect physical cash upon verification</span>
                    </div>
                    <span className="text-xl font-serif font-bold text-burgundy">
                      {formatINR(order.totalAmount)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline Card */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-cream-200">
              <div>
                <h3 className="font-serif font-bold text-base text-stone-900">
                  Live Order Tracking & Delivery Progression
                </h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  Real-time milestone tracking for your campus delivery package
                </p>
              </div>
              <div className="flex items-center gap-2.5 bg-cream-50 px-3.5 py-2 rounded-2xl border border-cream-200 shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mr-1">
                  Package:
                </span>
                {order.items.slice(0, 3).map((it) => (
                  <OrderProductImage
                    key={it.id}
                    src={it.product.images?.[0]}
                    alt={it.product.name}
                    name={it.product.name}
                    className="w-10 h-10 rounded-lg object-cover bg-stone-100 border border-cream-300 shadow-2xs"
                  />
                ))}
                {order.items.length > 3 && (
                  <span className="text-[11px] font-bold text-burgundy font-mono bg-burgundy/10 px-2 py-1 rounded-md">
                    +{order.items.length - 3} more
                  </span>
                )}
              </div>
            </div>
            <OrderTimeline currentStatus={order.orderStatus} events={order.timeline} />
          </div>

          {/* Details Grid: Items and Delivery Summary */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Items List */}
            <div className="md:col-span-8 bg-white rounded-3xl p-6 sm:p-7 border border-cream-200 shadow-soft space-y-4">
              <h3 className="font-serif font-bold text-base text-stone-900 pb-3 border-b border-cream-200">
                Ordered Products
              </h3>

              <div className="space-y-4 divide-y divide-cream-100">
                {order.items.map((it) => (
                  <div key={it.id} className="pt-4 first:pt-0 flex gap-4 items-center">
                    <OrderProductImage
                      src={it.product.images?.[0]}
                      alt={it.product.name}
                      name={it.product.name}
                      className="w-14 h-14 rounded-xl object-cover bg-stone-100 border border-cream-200 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] uppercase font-bold text-burgundy block">
                        {it.product.brand}
                      </span>
                      <Link
                        to={`/products/${it.product.id}`}
                        className="font-serif font-semibold text-xs text-stone-900 hover:text-burgundy block truncate"
                      >
                        {it.product.name}
                      </Link>
                      <p className="text-[11px] text-stone-500 mt-0.5">
                        Seller: {it.product.sellerName} • SKU: {it.product.sku}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-xs text-stone-900">
                        {formatINR(it.product.price * it.quantity)}
                      </p>
                      <p className="text-[10px] text-stone-400">Qty: {it.quantity}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-cream-200 space-y-2 text-xs text-stone-600">
                <div className="flex justify-between">
                  <span>Product Subtotal</span>
                  <span className="font-semibold text-stone-900">{formatINR(order.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Campus Delivery</span>
                  <span>{order.deliveryFee === 0 ? 'Free Delivery' : formatINR(order.deliveryFee)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-cream-200 text-sm font-bold text-stone-900">
                  <span>Total Amount (Cash on Delivery)</span>
                  <span className="text-lg font-serif text-burgundy">{formatINR(order.totalAmount)}</span>
                </div>
              </div>
            </div>

            {/* Delivery Location & Security Protocol */}
            <div className="md:col-span-4 space-y-6">
              <div className="bg-white rounded-3xl p-6 border border-cream-200 shadow-soft space-y-3">
                <div className="flex items-center gap-2 text-stone-900">
                  <MapPin className="w-4 h-4 text-burgundy" />
                  <h4 className="font-serif font-bold text-xs uppercase tracking-wider">
                    Delivery Campus Address
                  </h4>
                </div>
                <div className="text-xs text-stone-600 space-y-1">
                  <p className="font-semibold text-stone-900">{order.shippingAddress.fullName}</p>
                  <p>{order.shippingAddress.streetAddress}</p>
                  {order.shippingAddress.apartmentSuite && <p>{order.shippingAddress.apartmentSuite}</p>}
                  <p>
                    {order.shippingAddress.city}, {order.shippingAddress.postalCode}
                  </p>
                  <p className="pt-1 text-stone-500 font-mono">Contact: {order.shippingAddress.phone}</p>
                </div>
              </div>

              <div className="bg-ivory rounded-3xl p-6 border border-cream-300 space-y-3">
                <div className="flex items-center gap-2 text-burgundy">
                  <ShieldCheck className="w-4 h-4" />
                  <h4 className="font-serif font-bold text-xs uppercase tracking-wider">
                    COD Handover Verification
                  </h4>
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  Delivery personnel will verify product package before accepting cash payment of{' '}
                  <strong>{formatINR(order.totalAmount)}</strong>. Present your QR code on handover.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Security PIN Verification Modal */}
        {isPinModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm">
            <div className="bg-white rounded-3xl max-w-sm w-full p-6 sm:p-7 border border-cream-200 shadow-xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-cream-200">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-burgundy/10 flex items-center justify-center text-burgundy">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <h3 className="font-serif font-bold text-sm text-stone-900">
                    Enter Security PIN
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setIsPinModalOpen(false);
                    setEnteredPin('');
                    setPinError(null);
                  }}
                  className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-stone-600 leading-relaxed">
                Please enter your 4-digit security PIN to verify your identity and generate the live
                delivery handover QR code.
              </p>

              {pinError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                  <span className="font-bold">Error:</span>
                  <span>{pinError}</span>
                </div>
              )}

              <form onSubmit={handleVerifyPin} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-600 mb-1.5 text-center">
                    4-Digit Security PIN
                  </label>
                  <input
                    type="password"
                    maxLength={4}
                    autoFocus
                    value={enteredPin}
                    onChange={(e) => setEnteredPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full text-center text-2xl font-mono tracking-[0.5em] py-3 rounded-2xl border-2 border-stone-200 focus:border-burgundy focus:outline-none transition-all"
                    placeholder="••••"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setIsPinModalOpen(false);
                      setEnteredPin('');
                      setPinError(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1 bg-burgundy hover:bg-burgundy/90 text-white"
                    isLoading={isVerifyingPin}
                    disabled={enteredPin.length !== 4}
                  >
                    Unlock QR Pass
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Cancel Order Modal */}
        <CancelOrderModal
          isOpen={isCancelModalOpen}
          onClose={() => setIsCancelModalOpen(false)}
          order={order}
          onConfirmCancel={handleConfirmCancel}
        />

        {/* Refund Request Modal */}
        <RefundRequestModal
          isOpen={isRefundModalOpen}
          onClose={() => setIsRefundModalOpen(false)}
          order={order}
          onSuccess={fetchOrder}
        />
      </div>
    </>
  );
};
