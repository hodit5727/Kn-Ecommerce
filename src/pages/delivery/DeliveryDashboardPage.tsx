import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
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
  PackageCheck,
  User,
  Camera,
  Keyboard,
  ShoppingBag,
  ExternalLink
} from 'lucide-react';
import { Button } from '../../components/common/Button';
import { ErrorState } from '../../components/common/ErrorState';
import { OrderProductImage } from '../../components/order/OrderProductImage';

// Brief audio beep on scan success
const playScanSuccessSound = () => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  } catch (e) {
    // AudioContext might be restricted until user gesture; ignore
  }
};

export const DeliveryDashboardPage: React.FC = () => {
  const { user, isLoading: isLoadingAuth, logout } = useAuth();
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

  // QR Scanner modal state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<'camera' | 'manual'>('camera');
  const [scannedInput, setScannedInput] = useState('');
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // Authentication & Role Protection
  useEffect(() => {
    if (!isLoadingAuth) {
      if (!user) {
        navigate('/delivery/login', { replace: true });
        return;
      }
      const hasDeliveryAccess =
        user.role === 'ADMIN' ||
        user.role === 'DELIVERY_PERSON' ||
        user.roles?.includes('DELIVERY_PERSON') ||
        user.roles?.includes('ADMIN') ||
        user.roles?.includes('SUPER_ADMIN');

      if (!hasDeliveryAccess) {
        setError('Access restricted. Please sign in with an authorized Delivery Operator or Admin account.');
      }
    }
  }, [user, isLoadingAuth, navigate]);

  const fetchOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await deliveryService.getDeliveryOrders();
      setOrders(data);
    } catch (err: any) {
      if (err.status === 401 || err.message?.toLowerCase().includes('not signed in')) {
        navigate('/delivery/login', { replace: true });
        return;
      }
      setError(err.message || 'Unable to retrieve campus delivery orders.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchOrders();
    }
  }, [user]);

  const handleMarkDelivered = async (orderId: string) => {
    setIsUpdating(true);
    try {
      await deliveryService.markAsDelivered(orderId);
      showToast('Order confirmed as Delivered! Cash collected successfully.', 'success');
      setActiveOrder(null);
      await fetchOrders();
    } catch (err: any) {
      showToast(err.message || 'Failed to update order status.', 'error');
    } finally {
      setIsUpdating(false);
    }
  };

  // Process Scanned or Entered Code
  const handleProcessScan = async (rawCode?: string) => {
    setScannerError(null);
    const codeToTest = (rawCode || scannedInput || '').trim();
    if (!codeToTest) {
      setScannerError('Please scan a QR code or enter an Order ID.');
      return;
    }

    let targetCode = codeToTest;
    try {
      // Check if scanned input is a JSON payload
      const parsed = JSON.parse(codeToTest);
      if (parsed.orderCode) targetCode = parsed.orderCode;
      else if (parsed.orderId) targetCode = parsed.orderId;
      else if (parsed.token) targetCode = parsed.token;
    } catch (e) {
      // plain text string
    }

    const cleanTarget = targetCode.toLowerCase().replace(/^#/, '');

    // Search in current orders
    let matched = orders.find(
      (o) =>
        o.id.toLowerCase() === cleanTarget ||
        (o.orderCode && o.orderCode.toLowerCase() === cleanTarget) ||
        (o.orderNumber && o.orderNumber.toLowerCase() === cleanTarget) ||
        cleanTarget.includes(o.id.slice(0, 6).toLowerCase()) ||
        (o.customerBusinessId && o.customerBusinessId.toLowerCase() === cleanTarget)
    );

    // If not found in current local state, fetch fresh orders from backend
    if (!matched) {
      try {
        const fresh = await deliveryService.getDeliveryOrders();
        setOrders(fresh);
        matched = fresh.find(
          (o) =>
            o.id.toLowerCase() === cleanTarget ||
            (o.orderCode && o.orderCode.toLowerCase() === cleanTarget) ||
            (o.orderNumber && o.orderNumber.toLowerCase() === cleanTarget) ||
            cleanTarget.includes(o.id.slice(0, 6).toLowerCase()) ||
            (o.customerBusinessId && o.customerBusinessId.toLowerCase() === cleanTarget)
        );
      } catch (e) {
        // ignore
      }
    }

    if (matched) {
      playScanSuccessSound();
      setActiveOrder(matched);
      setIsScannerOpen(false);
      setScannedInput('');
      showToast(`Verified Order: ${matched.orderCode || matched.orderNumber}`, 'success');
    } else {
      setScannerError(`No matching order found for "${codeToTest}". Please check the ID or refresh.`);
    }
  };

  // Camera QR Scanner Lifecycle
  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;
    let isMounted = true;

    if (isScannerOpen && scannerMode === 'camera') {
      const containerId = 'qr-camera-stream';

      // Give DOM time to mount container
      const timer = setTimeout(() => {
        if (!isMounted) return;
        const elem = document.getElementById(containerId);
        if (!elem) return;

        try {
          html5QrCode = new Html5Qrcode(containerId);
          html5QrCodeRef.current = html5QrCode;

          html5QrCode
            .start(
              { facingMode: 'environment' },
              {
                fps: 10,
                qrbox: { width: 220, height: 220 },
                aspectRatio: 1.0,
              },
              (decodedText) => {
                if (html5QrCode?.isScanning) {
                  html5QrCode.stop().then(() => {
                    setIsCameraActive(false);
                  }).catch(() => {});
                }
                handleProcessScan(decodedText);
              },
              () => {
                // scanning frame ignored
              }
            )
            .then(() => {
              if (isMounted) setIsCameraActive(true);
            })
            .catch((err) => {
              console.warn('[QR Scanner] Camera start error:', err);
              if (isMounted) {
                setScannerError('Camera access denied or unavailable. You can type or paste the code below.');
                setScannerMode('manual');
                setIsCameraActive(false);
              }
            });
        } catch (e: any) {
          if (isMounted) {
            setScannerError(e?.message || 'Camera initialization error. Switching to manual input.');
            setScannerMode('manual');
          }
        }
      }, 150);

      return () => {
        isMounted = false;
        clearTimeout(timer);
        if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
          html5QrCodeRef.current.stop().catch(() => {});
          html5QrCodeRef.current = null;
        }
        setIsCameraActive(false);
      };
    } else {
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        html5QrCodeRef.current.stop().catch(() => {});
        html5QrCodeRef.current = null;
      }
      setIsCameraActive(false);
    }
  }, [isScannerOpen, scannerMode]);

  // Clean stop when closing modal
  const handleCloseScanner = () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      html5QrCodeRef.current.stop().catch(() => {});
      html5QrCodeRef.current = null;
    }
    setIsCameraActive(false);
    setIsScannerOpen(false);
    setScannerError(null);
    setScannedInput('');
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
      const name = (o.shippingAddress?.fullName || o.customerName || '').toLowerCase();
      const phone = (o.shippingAddress?.phone || o.customerPhone || '').toLowerCase();
      const dept = (o.shippingAddress?.streetAddress || '').toLowerCase();
      const custId = (o.customerBusinessId || '').toLowerCase();
      const productName = (o.items?.[0]?.product?.name || '').toLowerCase();

      return (
        code.includes(q) ||
        name.includes(q) ||
        phone.includes(q) ||
        dept.includes(q) ||
        custId.includes(q) ||
        productName.includes(q)
      );
    }

    return true;
  });

  return (
    <div className="min-h-screen bg-stone-100 pb-24 text-stone-900">
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
            <p className="text-[10px] text-cream-200 font-mono truncate max-w-[180px]">
              {user?.fullName || 'Campus Delivery Personnel'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setScannerMode('camera');
              setIsScannerOpen(true);
            }}
            className="p-2 rounded-xl bg-gold text-stone-900 hover:bg-gold/90 transition-all flex items-center gap-1 text-xs font-bold shadow-xs"
            title="Scan customer QR pass"
          >
            <QrIcon className="w-4 h-4 text-stone-900" />
            <span className="hidden sm:inline">Scan QR</span>
          </button>
          <button
            onClick={fetchOrders}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-white"
            title="Refresh orders"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={async () => {
              await logout();
              navigate('/delivery/login');
            }}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-white"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-xl mx-auto px-4 pt-4 space-y-4">
        {/* Quick QR Scanner Banner */}
        <button
          onClick={() => {
            setScannerMode('camera');
            setIsScannerOpen(true);
          }}
          className="w-full bg-gradient-to-r from-stone-900 via-stone-800 to-burgundy text-white p-4 rounded-3xl shadow-soft flex items-center justify-between hover:opacity-95 transition-all text-left border border-white/10"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gold/20 border border-gold/30 flex items-center justify-center text-gold shadow-xs">
              <Camera className="w-6 h-6" />
            </div>
            <div>
              <strong className="block text-sm font-serif font-bold text-white flex items-center gap-1.5">
                Scan Customer Pass QR <QrIcon className="w-4 h-4 text-gold" />
              </strong>
              <span className="text-[11px] text-cream-200">
                Point camera at customer's phone or slip to verify & collect cash
              </span>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-gold shrink-0" />
        </button>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Order ID (KNOR-XXXX), student name, KNCR ID..."
            className="w-full bg-white border border-stone-200 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-stone-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-burgundy/20"
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
            { id: 'Hostel', label: 'Hostel' },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => setSelectedStream(st.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedStream === st.id
                  ? 'bg-burgundy text-white shadow-sm'
                  : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* Active Tabs: Pending vs Delivered */}
        <div className="grid grid-cols-2 bg-stone-200/80 p-1 rounded-2xl text-xs font-bold">
          <button
            onClick={() => setActiveTab('PENDING')}
            className={`py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
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
            className={`py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'DELIVERED'
                ? 'bg-white text-emerald-800 shadow-sm'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Delivered ({orders.filter((o) => o.orderStatus === 'COD_DELIVERED').length})</span>
          </button>
        </div>

        {/* Orders List */}
        {error ? (
          <div className="bg-white rounded-3xl p-6 border border-rose-200 shadow-sm space-y-3 text-center">
            <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
            <h3 className="font-bold text-stone-900 text-sm">Delivery Portal Notice</h3>
            <p className="text-xs text-stone-600">{error}</p>
            <div className="flex gap-2 justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/delivery/login')}
              >
                Sign In As Operator
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="bg-burgundy text-white"
                onClick={fetchOrders}
              >
                Retry
              </Button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="py-16 text-center text-xs text-stone-500 bg-white rounded-3xl border border-stone-200 p-8">
            <div className="w-7 h-7 rounded-full border-2 border-burgundy border-t-transparent animate-spin mx-auto mb-2" />
            Loading assigned campus deliveries...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-16 text-center text-xs text-stone-400 bg-white rounded-3xl border border-stone-200 p-8 shadow-xs">
            <PackageCheck className="w-12 h-12 text-stone-300 mx-auto mb-3" />
            <strong className="block text-stone-700 text-sm mb-1">No Orders Found</strong>
            <p className="text-stone-400">
              {activeTab === 'PENDING'
                ? 'No pending orders waiting for delivery right now.'
                : 'No delivered orders recorded in this filter.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Delivery Queue List with full details */}
            <div className="space-y-3.5">
              {filteredOrders.map((order, index) => {
                const code =
                  order.orderCode ||
                  (order.orderNumber?.match(/\d{4}$/)
                    ? `KNOR-${order.orderNumber.match(/\d{4}/)![0]}`
                    : `KNOR-${order.id.slice(0, 4).toUpperCase()}`);
                const isDelivered = order.orderStatus === 'COD_DELIVERED';
                const queueNumber = index + 1;
                const customerPhone = order.shippingAddress?.phone || order.customerPhone;
                const customerName = order.shippingAddress?.fullName || order.customerName || 'Campus Customer';
                const customerBusinessId = order.customerBusinessId;
                const firstItem = order.items?.[0];

                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-3xl p-4 sm:p-5 border border-stone-200 shadow-sm hover:border-burgundy/40 transition-all space-y-3.5"
                  >
                    {/* Header Row: Queue #, Order Code, Status */}
                    <div className="flex items-center justify-between pb-2.5 border-b border-stone-100">
                      <div className="flex items-center gap-2">
                        {!isDelivered && (
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full font-sans">
                            Queue #{queueNumber}
                          </span>
                        )}
                        <span className="font-mono text-xs font-bold text-burgundy bg-burgundy/5 px-2.5 py-0.5 rounded-md border border-burgundy/10">
                          {code}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full ${
                          isDelivered
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {isDelivered ? 'DELIVERED' : order.orderStatus.replace('COD_', '')}
                      </span>
                    </div>

                    {/* Customer Info Card: Name, KNCR ID, Phone */}
                    <div className="bg-stone-50 rounded-2xl p-3 border border-stone-200/80 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <strong className="text-xs sm:text-sm font-bold text-stone-900">
                              {customerName}
                            </strong>
                            {customerBusinessId && (
                              <span className="font-mono text-[9px] font-bold text-burgundy bg-burgundy/5 px-1.5 py-0.5 rounded border border-burgundy/10">
                                {customerBusinessId}
                              </span>
                            )}
                          </div>
                          {order.customerEmail && (
                            <span className="text-[10px] text-stone-500 block truncate max-w-[200px]">
                              {order.customerEmail}
                            </span>
                          )}
                        </div>

                        {customerPhone && (
                          <a
                            href={`tel:${customerPhone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-stone-200 text-stone-800 hover:border-burgundy hover:text-burgundy text-[11px] font-bold shadow-2xs transition-colors shrink-0"
                            title="Call customer directly"
                          >
                            <Phone className="w-3 h-3 text-emerald-600" />
                            <span>Call</span>
                          </a>
                        )}
                      </div>

                      {/* Location Details (Department, Hostel, Room) */}
                      <div className="text-[11px] text-stone-700 space-y-0.5 pt-1 border-t border-stone-200/60">
                        <p className="flex items-start gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-burgundy shrink-0 mt-0.5" />
                          <span className="font-medium">
                            {order.shippingAddress?.streetAddress || 'Campus Delivery Point'}
                          </span>
                        </p>
                        {order.shippingAddress?.apartmentSuite && (
                          <p className="text-[10px] text-stone-600 pl-5">
                            <strong>Cabin / Room:</strong> {order.shippingAddress.apartmentSuite}
                          </p>
                        )}
                        {(order.shippingAddress?.city || order.shippingAddress?.postalCode) && (
                          <p className="text-[10px] text-stone-400 pl-5">
                            {[order.shippingAddress?.city, order.shippingAddress?.postalCode].filter(Boolean).join(' - ')}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Product Details & Images Preview */}
                    <div className="space-y-2">
                      <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider">
                        Package Products ({order.items.length})
                      </span>
                      <div className="space-y-2">
                        {order.items.map((it) => (
                          <div
                            key={it.id}
                            className="flex items-center justify-between text-xs gap-3 p-2 rounded-xl bg-stone-50 border border-stone-100"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <OrderProductImage
                                src={it.product?.images?.[0]}
                                alt={it.product?.name || 'Product'}
                                name={it.product?.name || 'Product'}
                                className="w-12 h-12 rounded-xl object-cover bg-white border border-stone-200 shrink-0 shadow-2xs"
                              />
                              <div className="truncate">
                                <p className="font-bold text-stone-900 truncate text-xs">
                                  {it.product?.name}
                                </p>
                                <p className="text-[10px] text-stone-500">
                                  Qty: <strong>{it.quantity}</strong> × {formatINR(it.product?.price || 0)}
                                </p>
                                {it.selectedSize && (
                                  <span className="text-[9px] text-stone-400 mr-2">
                                    Size: {it.selectedSize}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="font-mono text-stone-900 font-bold shrink-0 text-xs">
                              {formatINR((it.product?.price || 0) * it.quantity)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Bottom Action Footer: COD Due & Scan / Handover Button */}
                    <div className="flex items-center justify-between pt-2 border-t border-stone-100 gap-3">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">
                          COD Cash Due
                        </span>
                        <strong className="text-base font-serif font-bold text-stone-900">
                          {formatINR(order.totalAmount)}
                        </strong>
                      </div>

                      <div className="flex items-center gap-2">
                        {isDelivered ? (
                          <button
                            onClick={() => setActiveOrder(order)}
                            className="px-3.5 py-2 rounded-xl bg-stone-100 text-stone-700 hover:bg-stone-200 text-xs font-semibold flex items-center gap-1 transition-colors"
                          >
                            View Manifest
                          </button>
                        ) : (
                          <button
                            onClick={() => setActiveOrder(order)}
                            className="px-4 py-2.5 rounded-xl bg-gold hover:bg-gold/90 text-stone-900 text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
                          >
                            <QrIcon className="w-3.5 h-3.5" />
                            <span>Verify & Handover</span>
                          </button>
                        )}
                      </div>
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 border border-stone-200 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
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
                className="p-1.5 rounded-xl text-stone-400 hover:text-stone-700 bg-stone-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customer Details Card */}
            <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-stone-400 text-[10px] uppercase font-bold">Customer Dossier</span>
                {(activeOrder.shippingAddress?.phone || activeOrder.customerPhone) && (
                  <a
                    href={`tel:${activeOrder.shippingAddress?.phone || activeOrder.customerPhone}`}
                    className="inline-flex items-center gap-1 text-burgundy font-bold hover:underline"
                  >
                    <Phone className="w-3.5 h-3.5" /> Call Customer
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                <p className="font-bold text-stone-900 text-sm">
                  {activeOrder.shippingAddress?.fullName || activeOrder.customerName}
                </p>
                {activeOrder.customerBusinessId && (
                  <span className="font-mono text-[9px] font-bold text-burgundy bg-burgundy/5 px-1.5 py-0.5 rounded border border-burgundy/10">
                    {activeOrder.customerBusinessId}
                  </span>
                )}
              </div>
              <p className="text-stone-700 font-mono">
                {activeOrder.shippingAddress?.phone || activeOrder.customerPhone}
              </p>
              <p className="text-stone-600 pt-1">
                <strong>Delivery Location:</strong> {activeOrder.shippingAddress?.streetAddress}
              </p>
              {activeOrder.shippingAddress?.apartmentSuite && (
                <p className="text-stone-600">
                  <strong>Room / Cabin:</strong> {activeOrder.shippingAddress.apartmentSuite}
                </p>
              )}
            </div>

            {/* Order Items */}
            <div className="space-y-2">
              <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider">
                Items in Package
              </span>
              <div className="divide-y divide-stone-100 max-h-48 overflow-y-auto pr-1">
                {activeOrder.items.map((it) => (
                  <div key={it.id} className="py-2.5 flex items-center justify-between text-xs gap-3">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <OrderProductImage
                        src={it.product?.images?.[0]}
                        alt={it.product?.name || 'Product'}
                        name={it.product?.name || 'Product'}
                        className="w-10 h-10 rounded-xl object-cover bg-stone-100 border border-stone-200 shrink-0"
                      />
                      <div className="truncate">
                        <p className="font-semibold text-stone-900 truncate">{it.product?.name}</p>
                        <p className="text-[10px] text-stone-400">
                          Qty: {it.quantity} × {formatINR(it.product?.price || 0)}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-stone-900 font-bold shrink-0">
                      {formatINR((it.product?.price || 0) * it.quantity)}
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
                className="w-full py-3.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold flex items-center justify-center gap-2 rounded-2xl shadow-md text-sm"
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

      {/* Real Camera QR Scanner Modal */}
      {isScannerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 sm:p-6 border border-stone-200 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-burgundy/10 flex items-center justify-center text-burgundy">
                  <QrIcon className="w-4 h-4" />
                </div>
                <h3 className="font-serif font-bold text-sm text-stone-900">
                  Scan Customer QR Pass
                </h3>
              </div>
              <button
                onClick={handleCloseScanner}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Switcher Tabs: Camera vs Manual Input */}
            <div className="grid grid-cols-2 bg-stone-100 p-1 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setScannerMode('camera')}
                className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  scannerMode === 'camera'
                    ? 'bg-white text-burgundy shadow-xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Camera Scan</span>
              </button>
              <button
                type="button"
                onClick={() => setScannerMode('manual')}
                className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  scannerMode === 'manual'
                    ? 'bg-white text-burgundy shadow-xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                <Keyboard className="w-3.5 h-3.5" />
                <span>Type Code</span>
              </button>
            </div>

            {scannerError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{scannerError}</span>
              </div>
            )}

            {/* Camera Viewfinder */}
            {scannerMode === 'camera' ? (
              <div className="space-y-3">
                <div className="relative rounded-2xl overflow-hidden bg-black aspect-square flex items-center justify-center border-2 border-dashed border-stone-300">
                  <div id="qr-camera-stream" className="w-full h-full" />
                  {!isCameraActive && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-stone-900/90 text-white text-xs p-4 text-center">
                      <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin mb-2" />
                      Starting rear camera...
                      <span className="text-[10px] text-stone-400 mt-1">Please allow camera permissions if prompted</span>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-center text-stone-500">
                  Align customer pass QR within the frame to auto-detect
                </p>
              </div>
            ) : (
              /* Manual Input */
              <div className="space-y-3">
                <p className="text-xs text-stone-600">
                  Enter Order ID (e.g. <strong className="font-mono">KNOR-1042</strong>) or paste QR text:
                </p>
                <input
                  type="text"
                  autoFocus
                  value={scannedInput}
                  onChange={(e) => setScannedInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleProcessScan();
                    }
                  }}
                  placeholder="e.g. KNOR-1042 or customer ID"
                  className="w-full bg-white border border-stone-200 rounded-xl p-3 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-burgundy font-mono"
                />

                <Button
                  type="button"
                  variant="primary"
                  className="w-full bg-burgundy text-white hover:bg-burgundy/90 py-2.5 text-xs font-bold"
                  onClick={() => handleProcessScan()}
                >
                  Verify Order Code
                </Button>
              </div>
            )}

            <div className="pt-2 border-t border-stone-100 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleCloseScanner}
              >
                Close Scanner
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
