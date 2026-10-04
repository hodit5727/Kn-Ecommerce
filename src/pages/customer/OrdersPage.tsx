import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { orderService } from '../../services/orderService';
import { authService } from '../../services/authService';
import { Order, CODOrderStatus } from '../../types/order';
import { useAuth } from '../../auth/AuthContext';
import { CancelOrderModal } from '../../components/orders/CancelOrderModal';
import { RefundRequestModal } from '../../components/refunds/RefundRequestModal';
import { OrderTimeline } from '../../components/orders/OrderTimeline';
import { ErrorState } from '../../components/common/ErrorState';
import { EmptyState } from '../../components/common/EmptyState';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { useToast } from '../../context/ToastContext';
import { formatINR } from '../../lib/currency';
import {
  Package,
  Clock,
  Truck,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ArrowRight,
  ShieldCheck,
  Eye,
  EyeOff,
  Lock,
  QrCode as QrIcon,
  Store,
  KeyRound,
  X,
  MapPin,
  Phone
} from 'lucide-react';
import { CustomerSidebar } from '../../components/customer/CustomerSidebar';
import { OrderProductImage } from '../../components/order/OrderProductImage';

export const OrdersPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<'ALL' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUND'>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Security PIN unlock & QR state (unlocked in-place per card)
  const [unlockedOrderIds, setUnlockedOrderIds] = useState<Set<string>>(new Set());
  const [activePinOrder, setActivePinOrder] = useState<Order | null>(null);
  const [enteredPin, setEnteredPin] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isVerifyingPin, setIsVerifyingPin] = useState<boolean>(false);
  const [qrCodeUrls, setQrCodeUrls] = useState<Record<string, string>>({});

  // Modals
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
  const [orderToRefund, setOrderToRefund] = useState<Order | null>(null);

  const fetchOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await orderService.getOrders(user?.id);
      setOrders(data);
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve orders from the server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [user]);

  // Pre-generate QR codes for scannable delivery handover
  useEffect(() => {
    if (!orders.length) return;
    const generateAllQrs = async () => {
      const urls: Record<string, string> = {};
      for (const order of orders) {
        const orderCode =
          order.orderCode ||
          (order.orderNumber?.match(/\d{4}$/)
            ? `KNOR-${order.orderNumber.match(/\d{4}/)![0]}`
            : `KNOR-${order.id.slice(0, 4).toUpperCase()}`);

        const qrPayload = JSON.stringify({
          orderId: order.id,
          orderCode,
          customerName: order.shippingAddress.fullName,
          phone: order.shippingAddress.phone,
          campusLocation: `${order.shippingAddress.streetAddress}, ${order.shippingAddress.apartmentSuite || ''}`,
          amount: order.totalAmount,
          status: order.orderStatus,
          token: order.id.slice(0, 6).toUpperCase(),
        });

        try {
          const url = await QRCode.toDataURL(qrPayload, {
            width: 220,
            margin: 1,
            color: { dark: '#171717', light: '#ffffff' },
          });
          urls[order.id] = url;
        } catch (e) {
          // ignore
        }
      }
      setQrCodeUrls(urls);
    };

    generateAllQrs();
  }, [orders]);

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredPin || enteredPin.length !== 4) {
      setPinError('Please enter your 4-digit security PIN.');
      return;
    }
    if (!user?.email) {
      setPinError('Session not detected. Please sign in again.');
      return;
    }

    setIsVerifyingPin(true);
    setPinError(null);
    try {
      await authService.verifyPin(user.email, enteredPin);
      if (activePinOrder) {
        setUnlockedOrderIds((prev) => new Set([...prev, activePinOrder.id]));
      }
      setActivePinOrder(null);
      setEnteredPin('');
      showToast('Security PIN verified! Handover QR code unlocked on this screen.');
    } catch (err: any) {
      setPinError(err.message || 'Incorrect PIN. Please try again.');
    } finally {
      setIsVerifyingPin(false);
    }
  };

  const handleConfirmCancel = async (orderId: string, reason: string) => {
    try {
      await orderService.cancelOrder(orderId, reason);
      showToast('Order cancelled successfully.');
      fetchOrders();
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel order.', 'error');
    }
  };

  // Filter orders based on active tab
  const filteredOrders = orders.filter((order) => {
    if (activeTab === 'ALL') return true;
    if (activeTab === 'PROCESSING')
      return (
        order.orderStatus === 'COD_PROCESSING' ||
        order.orderStatus === 'COD_PENDING' ||
        order.orderStatus === 'COD_CONFIRMED'
      );
    if (activeTab === 'SHIPPED') return order.orderStatus === 'COD_SHIPPED';
    if (activeTab === 'DELIVERED') return order.orderStatus === 'COD_DELIVERED';
    if (activeTab === 'CANCELLED') return order.orderStatus === 'COD_CANCELLED';
    if (activeTab === 'REFUND') return order.isEligibleForRefund;
    return true;
  });

  // Calculate active order notification count
  const activeOrdersCount = orders.filter(
    (o) => o.orderStatus !== 'COD_CANCELLED' && o.orderStatus !== 'COD_DELIVERED'
  ).length;

  const getStatusBadge = (status: CODOrderStatus) => {
    switch (status) {
      case 'COD_PENDING':
        return <Badge variant="amber" dot>COD Pending Confirmation</Badge>;
      case 'COD_CONFIRMED':
        return <Badge variant="stone" dot>Confirmed by Atelier</Badge>;
      case 'COD_PROCESSING':
        return <Badge variant="cream" dot>Artisan Preparation</Badge>;
      case 'COD_SHIPPED':
        return <Badge variant="burgundy" dot>Courier in Transit</Badge>;
      case 'COD_DELIVERED':
        return <Badge variant="emerald" dot>Delivered • Cash Settled</Badge>;
      case 'COD_CANCELLED':
        return <Badge variant="rosered" dot>Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Title with Active Orders Power Badge */}
      <div className="border-b border-cream-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
            Patron Orders
          </span>
          <h1 className="text-3xl font-serif font-bold text-stone-900 flex items-center gap-3">
            <span>My Orders</span>
            {activeOrdersCount > 0 && (
              <span className="bg-burgundy text-white text-xs font-sans font-bold px-2.5 py-1 rounded-full shadow-xs animate-pulse">
                {activeOrdersCount} Active
              </span>
            )}
          </h1>
        </div>
        {user && (
          <span className="font-mono text-xs font-bold text-burgundy bg-burgundy/5 px-3 py-1.5 rounded-xl border border-burgundy/10 self-start sm:self-auto">
            Patron ID: {user.customerId || (user.businessId?.startsWith('KNCR-') ? user.businessId : user.businessId?.replace(/^KNSR-/, 'KNCR-')) || 'KNCR-0001'}
          </span>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-8 items-start">
        {/* Customer Left Sidebar with notification count badge */}
        <CustomerSidebar activeOrdersCount={activeOrdersCount} />

        <div className="flex-1 w-full space-y-6">
          {/* Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none border-b border-cream-200">
            {[
              { id: 'ALL', label: 'All Orders' },
              { id: 'PROCESSING', label: 'In Preparation' },
              { id: 'SHIPPED', label: 'Courier Transit' },
              { id: 'DELIVERED', label: 'Delivered' },
              { id: 'CANCELLED', label: 'Cancelled' },
              { id: 'REFUND', label: 'Eligible for Refund' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-burgundy text-white shadow-xs'
                    : 'text-stone-600 hover:text-stone-900 hover:bg-cream-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Error state */}
          {error ? (
            <ErrorState
              title="Orders Unreachable"
              message={error}
              onRetry={fetchOrders}
              isRetrying={isLoading}
            />
          ) : isLoading ? (
            <div className="py-16 text-center text-xs text-stone-500">
              <div className="w-8 h-8 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-3" />
              Loading your orders...
            </div>
          ) : filteredOrders.length === 0 ? (
            <EmptyState
              title="No Orders in this Category"
              description="You do not have any orders matching the selected status filter."
              actionText="Explore Products"
              onAction={() => navigate('/products')}
            />
          ) : (
            <div className="space-y-6">
              {filteredOrders.map((order) => {
                const code =
                  order.orderCode ||
                  (order.orderNumber?.match(/\d{4}$/)
                    ? `KNOR-${order.orderNumber.match(/\d{4}/)![0]}`
                    : `KNOR-${order.id.slice(0, 4).toUpperCase()}`);
                const isUnlocked = unlockedOrderIds.has(order.id);
                const qrUrl = qrCodeUrls[order.id];

                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-3xl p-6 sm:p-8 border border-cream-200 shadow-soft space-y-6 transition-all"
                  >
                    {/* 1. Order Header: ID, Status, Date, Due Price */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-cream-200">
                      <div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-serif font-bold text-lg text-stone-900 tracking-wide font-mono">
                            {code}
                          </span>
                          {getStatusBadge(order.orderStatus)}
                        </div>
                        <p className="text-xs text-stone-500 mt-1 flex items-center gap-2">
                          <span>
                            Logged on {new Date(order.createdAt).toLocaleDateString()} at{' '}
                            {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {order.customerBusinessId && (
                            <>
                              <span>•</span>
                              <span className="font-mono text-stone-600">ID: {order.customerBusinessId}</span>
                            </>
                          )}
                        </p>
                      </div>

                      <div className="text-left sm:text-right">
                        <span className="text-[11px] text-stone-500 block uppercase font-bold tracking-wider">
                          Due via Cash on Delivery:
                        </span>
                        <span className="text-2xl font-serif font-bold text-burgundy">
                          {formatINR(order.totalAmount)}
                        </span>
                      </div>
                    </div>

                    {/* 2. Items in Order with Reliable Product Image */}
                    <div className="space-y-4">
                      {order.items.map((it) => (
                        <div key={it.id} className="flex items-center gap-4">
                          <OrderProductImage
                            src={it.product.images[0]}
                            alt={it.product.name}
                            name={it.product.name}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] uppercase font-bold text-burgundy block">
                              {it.product.brand || 'Artisan Marketplace'}
                            </span>
                            <h4 className="font-serif font-semibold text-xs sm:text-sm text-stone-900 truncate">
                              {it.product.name}
                            </h4>
                            <p className="text-[11px] text-stone-500 mt-0.5">
                              Quantity: {it.quantity} • Seller: {it.product.sellerName || 'Verified Campus Store'}
                            </p>
                          </div>
                          <span className="font-bold text-xs sm:text-sm text-stone-900">
                            {formatINR(it.product.price * it.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* 3. Live Order Progressing Timeline (In-Place) */}
                    <div className="bg-cream-50/60 rounded-2xl p-4 sm:p-5 border border-cream-200">
                      <h4 className="font-serif font-bold text-xs text-stone-900 mb-4 flex items-center gap-2">
                        <Truck className="w-4 h-4 text-burgundy" /> Order Delivery Progression
                      </h4>
                      <OrderTimeline currentStatus={order.orderStatus} events={order.timeline} />
                    </div>

                    {/* 4. Single-Page Live Delivery Handover Pass & QR Code */}
                    <div className="bg-gradient-to-br from-white to-cream-50 rounded-2xl p-5 sm:p-6 border-2 border-cream-300 shadow-xs">
                      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
                        <div className="flex items-center gap-2">
                          <QrIcon className="w-5 h-5 text-burgundy" />
                          <div>
                            <strong className="font-serif font-bold text-xs sm:text-sm text-stone-900 block">
                              Campus Delivery Handover Pass
                            </strong>
                            <p className="text-[11px] text-stone-500">
                              Present this pass on your phone to the delivery personnel upon delivery.
                            </p>
                          </div>
                        </div>

                        {/* In-Place Eye Unlock Button */}
                        <div>
                          {isUnlocked ? (
                            <button
                              onClick={() => {
                                setUnlockedOrderIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(order.id);
                                  return next;
                                });
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-100 text-xs font-semibold"
                            >
                              <EyeOff className="w-3.5 h-3.5" /> Lock Pass
                            </button>
                          ) : (
                            <button
                              onClick={() => setActivePinOrder(order)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-burgundy text-white hover:bg-burgundy/90 text-xs font-semibold shadow-xs"
                            >
                              <Eye className="w-3.5 h-3.5" /> Unlock QR Pass
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Unlocked QR Pass Details or Locked Preview */}
                      <div className="pt-4 grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                        <div className="sm:col-span-5 flex flex-col items-center justify-center p-3 bg-white rounded-xl border border-cream-200 text-center">
                          {isUnlocked ? (
                            <>
                              {qrUrl ? (
                                <img
                                  src={qrUrl}
                                  alt="Delivery QR"
                                  className="w-36 h-36 rounded-lg border border-stone-200 p-1.5 bg-white shadow-inner"
                                />
                              ) : (
                                <div className="w-36 h-36 rounded-lg bg-stone-100 flex items-center justify-center text-[10px] text-stone-400">
                                  Generating QR...
                                </div>
                              )}
                              <span className="font-mono text-xs font-bold text-stone-800 mt-1.5 block">
                                {code}
                              </span>
                              <span className="text-[9px] text-stone-400 uppercase tracking-wider">
                                Scannable by Campus Delivery App
                              </span>
                            </>
                          ) : (
                            <div className="py-4 px-2 flex flex-col items-center justify-center space-y-2">
                              <div className="w-10 h-10 rounded-full bg-cream-100 flex items-center justify-center text-burgundy">
                                <Lock className="w-5 h-5" />
                              </div>
                              <span className="text-xs font-bold text-stone-800">
                                Delivery Pass Locked
                              </span>
                              <span className="text-[10px] text-stone-500 max-w-[160px]">
                                Click "Unlock QR Pass" to verify your 4-digit PIN
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Mapped Customer Delivery Details */}
                        <div className="sm:col-span-7 space-y-2 text-xs">
                          <div className="bg-white p-3.5 rounded-xl border border-cream-200 space-y-1.5">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <span className="text-stone-400 text-[10px] block">Customer Name</span>
                                <strong className="text-stone-900 font-semibold">
                                  {order.shippingAddress.fullName}
                                </strong>
                              </div>
                              <div>
                                <span className="text-stone-400 text-[10px] block">Mobile Phone</span>
                                <strong className="text-stone-900 font-mono">
                                  {order.shippingAddress.phone}
                                </strong>
                              </div>
                              <div className="col-span-2">
                                <span className="text-stone-400 text-[10px] block">Campus & Department</span>
                                <p className="text-stone-800 font-medium">
                                  {order.shippingAddress.streetAddress}
                                  {order.shippingAddress.apartmentSuite && ` • ${order.shippingAddress.apartmentSuite}`}
                                </p>
                              </div>
                            </div>

                            <div className="pt-2 border-t border-cream-100 flex items-center justify-between">
                              <span className="text-[10px] uppercase font-bold text-stone-500">
                                COD Cash Due:
                              </span>
                              <span className="font-serif font-bold text-base text-burgundy">
                                {formatINR(order.totalAmount)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 5. Footer Actions (Cancel / Refund) */}
                    <div className="flex items-center justify-between pt-2 text-xs">
                      <span className="text-stone-400 text-[11px]">
                        Protocol: Cash on Delivery ({order.paymentStatus})
                      </span>

                      <div className="flex items-center gap-2">
                        {order.isEligibleForCancel && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setOrderToCancel(order)}
                          >
                            Cancel Order
                          </Button>
                        )}
                        {order.isEligibleForRefund && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setOrderToRefund(order)}
                          >
                            Request Refund
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Security PIN Verification Modal */}
      {activePinOrder && (
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
                  setActivePinOrder(null);
                  setEnteredPin('');
                  setPinError(null);
                }}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              Enter your 4-digit security PIN to reveal your live delivery handover pass and QR code
              for{' '}
              <strong className="font-mono text-burgundy">
                {activePinOrder.orderCode || activePinOrder.orderNumber}
              </strong>
              .
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
                    setActivePinOrder(null);
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
      {orderToCancel && (
        <CancelOrderModal
          isOpen={true}
          onClose={() => setOrderToCancel(null)}
          order={orderToCancel}
          onConfirmCancel={handleConfirmCancel}
        />
      )}

      {/* Refund Request Modal */}
      {orderToRefund && (
        <RefundRequestModal
          isOpen={true}
          onClose={() => setOrderToRefund(null)}
          order={orderToRefund}
          onSuccess={fetchOrders}
        />
      )}
    </div>
  );
};
