import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { deliveryService } from '../../services/deliveryService';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Order } from '../../types/order';
import { formatINR } from '../../lib/currency';
import {
  Truck,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  Search,
  QrCode as QrIcon,
  RefreshCw,
  LogOut,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  X,
  PackageCheck
} from 'lucide-react';
import { Button } from '../../components/common/Button';
import { ErrorState } from '../../components/common/ErrorState';
import { OrderProductImage } from '../../components/order/OrderProductImage';

export const DeliveryDashboardPage: React.FC = () => {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'PENDING' | 'DELIVERED'>('PENDING');
  const [selectedStream, setSelectedStream] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected Order for Handover Action
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // QR Scanner / Input modal state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedInput, setScannedInput] = useState('');
  const [scannerError, setScannerError] = useState<string | null>(null);

  const fetchOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await deliveryService.getDeliveryOrders();
      setOrders(data);
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve campus delivery orders.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleMarkDelivered = async (orderId: string) => {
    setIsUpdating(true);
    try {
      await deliveryService.markAsDelivered(orderId);
      showToast('Order confirmed as Delivered! Cash collected.');
      setActiveOrder(null);
      await fetchOrders();
    } catch (err: any) {
      showToast(err.message || 'Failed to update order status.', 'error');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleProcessScan = () => {
    setScannerError(null);
    const trimmed = scannedInput.trim();
    if (!trimmed) {
      setScannerError('Please enter or scan a valid QR code or Order ID.');
      return;
    }

    let targetCode = trimmed;
    try {
      // Check if scanned input is a JSON payload
      const parsed = JSON.parse(trimmed);
      if (parsed.orderCode) targetCode = parsed.orderCode;
      else if (parsed.orderId) targetCode = parsed.orderId;
    } catch (e) {
      // plain string
    }

    const matched = orders.find(
      (o) =>
        o.id.toLowerCase() === targetCode.toLowerCase() ||
        (o.orderCode && o.orderCode.toLowerCase() === targetCode.toLowerCase()) ||
        (o.orderNumber && o.orderNumber.toLowerCase() === targetCode.toLowerCase()) ||
        targetCode.toLowerCase().includes(o.id.slice(0, 6).toLowerCase())
    );

    if (matched) {
      setActiveOrder(matched);
      setIsScannerOpen(false);
      setScannedInput('');
      showToast(`Order found: ${matched.orderCode || matched.orderNumber}`);
    } else {
      setScannerError(`No matching order found for "${targetCode}".`);
    }
  };

  // Filter orders
  const filteredOrders = orders.filter((o) => {
    const isDelivered = o.orderStatus === 'COD_DELIVERED';
    if (activeTab === 'PENDING' && isDelivered) return false;
    if (activeTab === 'DELIVERED' && !isDelivered) return false;

    if (selectedStream !== 'ALL') {
      const address = (o.shippingAddress?.streetAddress || '').toLowerCase();
      if (!address.includes(selectedStream.toLowerCase())) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const code = (o.orderCode || o.orderNumber || '').toLowerCase();
      const name = (o.shippingAddress?.fullName || '').toLowerCase();
      const phone = (o.shippingAddress?.phone || '').toLowerCase();
      const dept = (o.shippingAddress?.streetAddress || '').toLowerCase();
      return code.includes(q) || name.includes(q) || phone.includes(q) || dept.includes(q);
    }

    return true;
  });

  return (
    <div className="min-h-screen bg-stone-50 pb-20">
      {/* Mobile Top App Bar */}
      <header className="sticky top-0 z-40 bg-burgundy text-white px-4 py-3 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">
            <Truck className="w-5 h-5 text-cream-200" />
          </div>
          <div>
            <h1 className="font-serif font-bold text-sm tracking-wide leading-tight">
              K-SHOP Delivery App
            </h1>
            <p className="text-[10px] text-cream-200 font-mono">
              Staff: {user?.fullName || 'Campus Delivery Personnel'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsScannerOpen(true)}
            className="p-2 rounded-xl bg-white/15 hover:bg-white/20 transition-all flex items-center gap-1 text-xs font-semibold"
            title="Scan customer QR code"
          >
            <QrIcon className="w-4 h-4 text-cream-100" />
            <span className="hidden sm:inline">Scan QR</span>
          </button>
          <button
            onClick={fetchOrders}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all"
            title="Refresh orders"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={async () => {
              await logout();
              navigate('/delivery/login');
            }}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Order ID (KNOR-XXXX), name, phone..."
            className="w-full bg-white border border-stone-200 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-stone-900 shadow-sm focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
          <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-3" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3 text-stone-400 hover:text-stone-600 text-xs"
            >
              ×
            </button>
          )}
        </div>

        {/* Stream Badges */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          {[
            { id: 'ALL', label: 'All Campus' },
            { id: 'Engineering', label: 'Engineering' },
            { id: 'Polytechnic', label: 'Polytechnic' },
            { id: 'B.Ed', label: 'B.Ed' },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => setSelectedStream(st.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedStream === st.id
                  ? 'bg-burgundy text-white shadow-sm'
                  : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-100'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* Active Tabs: Pending vs Delivered */}
        <div className="grid grid-cols-2 bg-stone-200/70 p-1 rounded-2xl text-xs font-bold">
          <button
            onClick={() => setActiveTab('PENDING')}
            className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'PENDING'
                ? 'bg-white text-burgundy shadow-sm'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>To Deliver ({orders.filter((o) => o.orderStatus !== 'COD_DELIVERED').length})</span>
          </button>
          <button
            onClick={() => setActiveTab('DELIVERED')}
            className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'DELIVERED'
                ? 'bg-white text-emerald-800 shadow-sm'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Delivered ({orders.filter((o) => o.orderStatus === 'COD_DELIVERED').length})</span>
          </button>
        </div>

        {/* Scan Bar Banner */}
        <button
          onClick={() => setIsScannerOpen(true)}
          className="w-full bg-gradient-to-r from-stone-900 to-stone-800 text-white p-3.5 rounded-2xl shadow-soft flex items-center justify-between hover:opacity-95 transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-cream-200">
              <QrIcon className="w-6 h-6" />
            </div>
            <div>
              <strong className="block text-xs font-serif font-bold text-white">
                Scan Customer QR Code
              </strong>
              <span className="text-[10px] text-cream-200">
                Instantly verify customer pass & collect cash
              </span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-cream-300" />
        </button>

        {/* Orders List */}
        {error ? (
          <ErrorState title="Error Loading Orders" message={error} onRetry={fetchOrders} />
        ) : isLoading ? (
          <div className="py-16 text-center text-xs text-stone-500">
            <div className="w-7 h-7 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-2" />
            Loading assigned campus deliveries...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-16 text-center text-xs text-stone-400 bg-white rounded-3xl border border-cream-200 p-8">
            <PackageCheck className="w-10 h-10 text-stone-300 mx-auto mb-2" />
            <strong className="block text-stone-700 text-sm mb-1">No Orders Found</strong>
            <p className="text-stone-400">
              {activeTab === 'PENDING'
                ? 'No pending deliveries in this category.'
                : 'No delivered orders in this category yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Highlight Next Delivery in Queue for Pending Tab */}
            {activeTab === 'PENDING' && filteredOrders.length > 0 && (
              <div className="bg-gradient-to-br from-burgundy to-burgundy-900 text-white rounded-3xl p-5 shadow-lg border border-burgundy/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-gold text-stone-900 px-2.5 py-0.5 rounded-full font-sans shadow-xs">
                    NEXT IN QUEUE • QUEUE #1
                  </span>
                  <span className="font-mono text-xs font-bold text-cream-200">
                    {filteredOrders[0].orderCode || filteredOrders[0].orderNumber}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-serif font-bold text-base text-white">
                      {filteredOrders[0].shippingAddress.fullName}
                    </h3>
                    <p className="text-xs text-cream-200 flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3.5 h-3.5 text-gold flex-shrink-0" />
                      <span>{filteredOrders[0].shippingAddress.streetAddress}</span>
                    </p>
                    {filteredOrders[0].shippingAddress.apartmentSuite && (
                      <p className="text-[11px] text-cream-300 pl-4">
                        {filteredOrders[0].shippingAddress.apartmentSuite}
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] uppercase text-cream-300 block">Collect Cash</span>
                    <strong className="text-xl font-serif font-bold text-gold">
                      {formatINR(filteredOrders[0].totalAmount)}
                    </strong>
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <a
                    href={`tel:${filteredOrders[0].shippingAddress.phone}`}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-cream-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" /> Call Customer
                  </a>
                  <button
                    onClick={() => setActiveOrder(filteredOrders[0])}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-gold hover:bg-gold/90 text-stone-900 text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                  >
                    <QrIcon className="w-4 h-4" /> Scan & Handover
                  </button>
                </div>
              </div>
            )}

            {/* Delivery Queue List */}
            <div className="space-y-3">
              {filteredOrders.map((order, index) => {
                const code =
                  order.orderCode ||
                  (order.orderNumber?.match(/\d{4}$/)
                    ? `KNOR-${order.orderNumber.match(/\d{4}/)![0]}`
                    : `KNOR-${order.id.slice(0, 4).toUpperCase()}`);
                const isDelivered = order.orderStatus === 'COD_DELIVERED';
                const queueNumber = index + 1;

                return (
                  <div
                    key={order.id}
                    onClick={() => setActiveOrder(order)}
                    className="bg-white rounded-2xl p-4 border border-cream-200 shadow-sm hover:border-burgundy/40 transition-all cursor-pointer space-y-2.5"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-cream-100">
                      <div className="flex items-center gap-2">
                        {!isDelivered && (
                          <span className="text-[10px] font-bold bg-cream-100 text-stone-700 px-2 py-0.5 rounded font-mono">
                            Queue #{queueNumber}
                          </span>
                        )}
                        <span className="font-mono text-xs font-bold text-burgundy bg-burgundy/5 px-2 py-0.5 rounded border border-burgundy/10">
                          {code}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          isDelivered
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {isDelivered ? 'DELIVERED' : order.orderStatus.replace('COD_', '')}
                      </span>
                    </div>

                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong className="text-xs font-bold text-stone-900 block">
                        {order.shippingAddress.fullName}
                      </strong>
                      <p className="text-[11px] text-stone-600 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-burgundy flex-shrink-0" />
                        <span className="truncate max-w-[220px]">
                          {order.shippingAddress.streetAddress}
                        </span>
                      </p>
                      {order.shippingAddress.apartmentSuite && (
                        <p className="text-[10px] text-stone-500 pl-4">
                          {order.shippingAddress.apartmentSuite}
                        </p>
                      )}
                    </div>

                    <div className="text-right flex-shrink-0">
                      <span className="text-[10px] text-stone-400 block uppercase">COD Due</span>
                      <strong className="text-base font-serif font-bold text-stone-900">
                        {formatINR(order.totalAmount)}
                      </strong>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-cream-100 text-[11px]">
                    <span className="text-stone-400">
                      {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                    </span>
                    <span className="text-burgundy font-semibold flex items-center gap-0.5">
                      View & Handover <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        )}
      </main>

      {/* Handover & Delivery Confirmation Modal */}
      {activeOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 border border-cream-200 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-cream-200">
              <div>
                <span className="text-[10px] uppercase font-bold text-burgundy block">
                  Delivery Handover Manifest
                </span>
                <h3 className="font-serif font-bold text-base text-stone-900">
                  {activeOrder.orderCode ||
                    (activeOrder.orderNumber?.match(/\d{4}$/)
                      ? `KNOR-${activeOrder.orderNumber.match(/\d{4}/)![0]}`
                      : `KNOR-${activeOrder.id.slice(0, 4).toUpperCase()}`)}
                </h3>
              </div>
              <button
                onClick={() => setActiveOrder(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customer Details Card */}
            <div className="bg-cream-50 p-4 rounded-2xl border border-cream-200 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-stone-500 text-[10px] uppercase font-bold">Customer</span>
                <a
                  href={`tel:${activeOrder.shippingAddress.phone}`}
                  className="inline-flex items-center gap-1 text-burgundy font-bold hover:underline"
                >
                  <Phone className="w-3.5 h-3.5" /> Call Customer
                </a>
              </div>
              <p className="font-bold text-stone-900 text-sm">
                {activeOrder.shippingAddress.fullName}
              </p>
              <p className="text-stone-700 font-mono">{activeOrder.shippingAddress.phone}</p>
              <p className="text-stone-600 pt-1">
                <strong>Location:</strong> {activeOrder.shippingAddress.streetAddress}
              </p>
              {activeOrder.shippingAddress.apartmentSuite && (
                <p className="text-stone-600">
                  <strong>Room / Cabin:</strong> {activeOrder.shippingAddress.apartmentSuite}
                </p>
              )}
            </div>

            {/* Order Items */}
            <div className="space-y-2">
              <span className="text-[10px] uppercase font-bold text-stone-500 block">
                Items in Package
              </span>
              <div className="divide-y divide-cream-100 max-h-40 overflow-y-auto pr-1">
                {activeOrder.items.map((it) => (
                  <div key={it.id} className="py-2.5 flex items-center justify-between text-xs gap-3">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <OrderProductImage
                        src={it.product.images?.[0]}
                        alt={it.product.name}
                        name={it.product.name}
                        className="w-10 h-10 rounded-lg object-cover bg-stone-100 border border-cream-200 shrink-0"
                      />
                      <div className="truncate">
                        <p className="font-semibold text-stone-900 truncate">{it.product.name}</p>
                        <p className="text-[10px] text-stone-400">Qty: {it.quantity}</p>
                      </div>
                    </div>
                    <span className="font-mono text-stone-900 font-bold shrink-0">
                      {formatINR(it.product.price * it.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* COD Cash Amount Due */}
            <div className="p-4 rounded-2xl bg-burgundy/5 border border-burgundy/20 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-burgundy block">
                  Cash to Collect (COD)
                </span>
                <span className="text-xs text-stone-500">Collect physical currency on handover</span>
              </div>
              <span className="text-2xl font-serif font-bold text-burgundy">
                {formatINR(activeOrder.totalAmount)}
              </span>
            </div>

            {/* Handover Action Buttons */}
            {activeOrder.orderStatus === 'COD_DELIVERED' ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-center text-xs text-emerald-800 font-bold flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> This order has already been delivered!
              </div>
            ) : (
              <Button
                variant="primary"
                className="w-full py-3.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold flex items-center justify-center gap-2 rounded-2xl shadow-md"
                isLoading={isUpdating}
                onClick={() => handleMarkDelivered(activeOrder.id)}
              >
                <CheckCircle2 className="w-5 h-5" /> Mark Delivered & Collect Cash (
                {formatINR(activeOrder.totalAmount)})
              </Button>
            )}
          </div>
        </div>
      )}

      {/* QR Scanner / Manual ID Input Modal */}
      {isScannerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 border border-cream-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-cream-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-burgundy/10 flex items-center justify-center text-burgundy">
                  <QrIcon className="w-4 h-4" />
                </div>
                <h3 className="font-serif font-bold text-sm text-stone-900">
                  Scan Customer QR
                </h3>
              </div>
              <button
                onClick={() => {
                  setIsScannerOpen(false);
                  setScannerError(null);
                  setScannedInput('');
                }}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-stone-600">
              Point your camera or paste the customer's QR handover token or Order ID (e.g.{' '}
              <strong className="font-mono">KNOR-1042</strong>):
            </p>

            {scannerError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-1.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{scannerError}</span>
              </div>
            )}

            <div className="space-y-3">
              <input
                type="text"
                autoFocus
                value={scannedInput}
                onChange={(e) => setScannedInput(e.target.value)}
                placeholder="Scan or enter QR data / KNOR-XXXX"
                className="w-full bg-white border border-stone-200 rounded-xl p-3 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy font-mono"
              />

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setIsScannerOpen(false);
                    setScannerError(null);
                    setScannedInput('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  className="flex-1 bg-burgundy text-white hover:bg-burgundy/90"
                  onClick={handleProcessScan}
                >
                  Verify Pass
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
