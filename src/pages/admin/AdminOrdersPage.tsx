import React, { useState, useEffect } from 'react';
import { orderService } from '../../services/orderService';
import { Order, CODOrderStatus } from '../../types/order';
import { ErrorState } from '../../components/common/ErrorState';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { DeliveryBillModal } from '../../components/order/DeliveryBillModal';
import { useToast } from '../../context/ToastContext';
import {
  ShoppingBag,
  Search,
  CheckCircle2,
  XCircle,
  Truck,
  Eye,
  ShieldAlert,
  Printer,
  Phone,
  Mail,
  Store,
  User,
  MapPin,
  Calendar,
  X,
  Package,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatINR } from '../../lib/currency';

export const AdminOrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [inspectedOrder, setInspectedOrder] = useState<Order | null>(null);
  const [billOrder, setBillOrder] = useState<Order | null>(null);
  const { showToast } = useToast();

  const loadOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await orderService.getOrders();
      setOrders(data);
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve administrative orders.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const handleUpdateStatus = async (orderId: string, status: CODOrderStatus) => {
    try {
      await orderService.updateOrderStatusBySellerOrAdmin(orderId, status);
      showToast(`Order status updated to ${status}. Seller escrow & ledger synchronized!`, 'success');
      if (inspectedOrder?.id === orderId) {
        setInspectedOrder((prev) => (prev ? { ...prev, orderStatus: status } : null));
      }
      loadOrders();
    } catch (err: any) {
      showToast(err.message || 'Failed to update order.', 'error');
    }
  };

  const filtered = orders.filter((o) => {
    const sName = (o as any).sellerName || o.items[0]?.product?.sellerName || '';
    const phone = o.customerPhone || o.shippingAddress?.phone || '';
    const matchesSearch =
      o.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customerEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      phone.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || o.orderStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="border-b border-stone-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-600 block mb-1">
            Oversight & Logistics
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Platform Order Governance
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-stone-500 bg-stone-100 px-3 py-1.5 rounded-xl border border-stone-200">
            Total Orders: <strong>{orders.length}</strong>
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-soft flex flex-col sm:flex-row items-center gap-4 justify-between">
        <div className="flex items-center gap-2 w-full sm:max-w-md bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
          <Search className="w-4 h-4 text-stone-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search order #, customer name, email, phone or seller..."
            className="w-full text-xs bg-transparent focus:outline-none text-stone-900"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto w-full sm:w-auto">
          {['ALL', 'COD_PENDING', 'COD_PROCESSING', 'COD_SHIPPED', 'COD_DELIVERED', 'COD_CANCELLED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                statusFilter === st ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              {st === 'ALL' ? 'All Orders' : st.replace('COD_', '')}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadOrders} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Accessing order index...</div>
      ) : (
        <div className="bg-white rounded-3xl border border-stone-200 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-4 px-6">Order #</th>
                  <th className="py-4 px-4">Customer</th>
                  <th className="py-4 px-4">Seller & Store</th>
                  <th className="py-4 px-4">Product Details</th>
                  <th className="py-4 px-4">Amount</th>
                  <th className="py-4 px-4">Status</th>
                  <th className="py-4 px-6 text-right">Actions & Delivery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.map((order) => {
                  const customerPhone = order.customerPhone || order.shippingAddress?.phone || '';
                  const sellerStore = order.sellerStoreName || order.sellerName || order.items[0]?.product?.sellerName || 'Store';
                  const sellerEmail = order.sellerEmail || order.items[0]?.product?.sellerEmail || '';
                  const sellerPhone = order.sellerPhone || order.items[0]?.product?.sellerPhone || '';
                  const sellerBusinessId = order.sellerBusinessId || order.items[0]?.product?.sellerBusinessId || '';
                  const orderCode = order.orderCode || (order.orderNumber?.match(/\d{4}$/) ? `KNOR-${order.orderNumber.match(/\d{4}/)![0]}` : order.orderNumber);

                  return (
                    <tr key={order.id} className="hover:bg-stone-50/50">
                      {/* Order Code */}
                      <td className="py-4 px-6 font-mono font-bold text-stone-900 whitespace-nowrap">
                        <Link to={`/orders/${order.id}`} className="hover:text-burgundy underline">
                          {orderCode}
                        </Link>
                      </td>

                      {/* Customer Details: Name, Email, Phone, ID */}
                      <td className="py-4 px-4 min-w-[200px]">
                        <p className="font-bold text-stone-900">{order.customerName}</p>
                        <p className="text-[11px] text-stone-500 flex items-center gap-1 mt-0.5">
                          <Mail className="w-3 h-3 text-stone-400 shrink-0" />
                          <span className="truncate max-w-[170px]">{order.customerEmail}</span>
                        </p>
                        {customerPhone ? (
                          <p className="text-[11px] text-stone-700 font-mono flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 text-burgundy shrink-0" />
                            <span>{customerPhone}</span>
                          </p>
                        ) : (
                          <p className="text-[10px] text-stone-400 italic mt-0.5">No phone provided</p>
                        )}
                        {order.customerBusinessId && (
                          <span className="inline-block mt-1 font-mono text-[9px] font-bold text-burgundy bg-burgundy/5 px-1.5 py-0.5 rounded border border-burgundy/10">
                            {order.customerBusinessId}
                          </span>
                        )}
                      </td>

                      {/* Seller & Store */}
                      <td className="py-4 px-4 min-w-[170px]">
                        <p className="font-semibold text-stone-900 flex items-center gap-1">
                          <Store className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>{sellerStore}</span>
                        </p>
                        {order.sellerPersonName && order.sellerPersonName !== sellerStore && (
                          <p className="text-[11px] text-stone-600 font-medium">
                            {order.sellerPersonName}
                          </p>
                        )}
                        {sellerEmail && (
                          <p className="text-[10px] text-stone-500 truncate max-w-[160px] flex items-center gap-1 mt-0.5">
                            <Mail className="w-2.5 h-2.5 text-stone-400 shrink-0" />
                            <span>{sellerEmail}</span>
                          </p>
                        )}
                        {sellerPhone && (
                          <p className="text-[10px] text-stone-600 font-mono flex items-center gap-1 mt-0.5">
                            <Phone className="w-2.5 h-2.5 text-burgundy shrink-0" />
                            <span>{sellerPhone}</span>
                          </p>
                        )}
                        {sellerBusinessId && (
                          <span className="inline-block mt-1 font-mono text-[9px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            {sellerBusinessId}
                          </span>
                        )}
                      </td>

                      {/* Product Details */}
                      <td className="py-4 px-4 text-stone-700 max-w-[220px]">
                        <p className="font-medium line-clamp-1 text-stone-900">
                          {order.items[0]?.product.name}
                        </p>
                        <p className="text-[11px] text-stone-500 mt-0.5">
                          Qty: <strong>{order.items[0]?.quantity}</strong>
                          {order.items.length > 1 && ` (+${order.items.length - 1} more items)`}
                        </p>
                      </td>

                      {/* Amount */}
                      <td className="py-4 px-4 font-bold text-stone-900 whitespace-nowrap">
                        <span className="text-sm">{formatINR(order.totalAmount)}</span>
                        <span className="block text-[9px] uppercase tracking-wider text-stone-400 font-semibold">COD</span>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <Badge
                          variant={order.orderStatus === 'COD_DELIVERED' ? 'emerald' : order.orderStatus === 'COD_CANCELLED' ? 'rosered' : 'stone'}
                          size="sm"
                          dot
                        >
                          {order.orderStatus.replace('COD_', '')}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-6 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {/* Inspect Button */}
                          <button
                            type="button"
                            onClick={() => setInspectedOrder(order)}
                            className="px-2.5 py-1 rounded-lg border border-stone-200 bg-white text-stone-700 hover:border-burgundy hover:text-burgundy text-[11px] font-semibold flex items-center gap-1 transition-colors shadow-2xs"
                            title="Inspect complete order details"
                          >
                            <Eye className="w-3.5 h-3.5 text-stone-500" />
                            <span>Inspect</span>
                          </button>

                          {/* Print Bill / Slip Button */}
                          <button
                            type="button"
                            onClick={() => setBillOrder(order)}
                            className="px-2.5 py-1 rounded-lg border border-stone-200 bg-stone-50 text-stone-700 hover:bg-cream-100 text-[11px] font-semibold flex items-center gap-1 transition-colors shadow-2xs"
                            title="Generate Delivery Bill & Tax Invoice"
                          >
                            <Printer className="w-3.5 h-3.5 text-stone-600" />
                            <span>Slip</span>
                          </button>

                          {/* Mark Delivered & Void Buttons */}
                          {order.orderStatus !== 'COD_DELIVERED' && order.orderStatus !== 'COD_CANCELLED' && (
                            <>
                              <button
                                onClick={() => handleUpdateStatus(order.id, 'COD_DELIVERED')}
                                className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold hover:bg-emerald-800 transition-colors shadow-xs"
                              >
                                Mark Delivered
                              </button>
                              <button
                                onClick={() => handleUpdateStatus(order.id, 'COD_CANCELLED')}
                                className="px-2.5 py-1 rounded-lg bg-rosered text-white text-[11px] font-semibold hover:bg-rosered-600 transition-colors shadow-xs"
                              >
                                Void
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Order Inspection Modal ────────────────────────────────────────── */}
      {inspectedOrder && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-cream-200 shadow-2xl p-6 sm:p-7 space-y-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-stone-200">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 block">
                  Detailed Inspection Dossier
                </span>
                <h3 className="font-serif font-bold text-xl text-stone-900 flex items-center gap-2 mt-0.5">
                  <span>Order {inspectedOrder.orderCode || inspectedOrder.orderNumber}</span>
                  <Badge
                    variant={inspectedOrder.orderStatus === 'COD_DELIVERED' ? 'emerald' : inspectedOrder.orderStatus === 'COD_CANCELLED' ? 'rosered' : 'stone'}
                    size="sm"
                    dot
                  >
                    {inspectedOrder.orderStatus.replace('COD_', '')}
                  </Badge>
                </h3>
              </div>
              <button
                onClick={() => setInspectedOrder(null)}
                className="p-1.5 rounded-xl hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customer & Seller Information Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Customer Box */}
              <div className="p-4 rounded-2xl bg-cream-50/80 border border-cream-200 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-burgundy flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Customer Personal Details
                </span>
                <p className="font-bold text-sm text-stone-900">{inspectedOrder.customerName}</p>
                <div className="space-y-1 text-xs text-stone-600">
                  <p className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-burgundy shrink-0" />
                    <span className="font-mono font-semibold text-stone-900">
                      {inspectedOrder.customerPhone || inspectedOrder.shippingAddress?.phone || 'Not registered'}
                    </span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span className="truncate">{inspectedOrder.customerEmail}</span>
                  </p>
                  <p className="flex items-start gap-2 pt-1 border-t border-cream-200">
                    <MapPin className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] leading-relaxed">
                      {inspectedOrder.shippingAddress?.streetAddress}
                      {inspectedOrder.shippingAddress?.apartmentSuite ? `, ${inspectedOrder.shippingAddress.apartmentSuite}` : ''}
                      , {inspectedOrder.shippingAddress?.city} - {inspectedOrder.shippingAddress?.postalCode}
                    </span>
                  </p>
                </div>
              </div>

              {/* Seller Box */}
              <div className="p-4 rounded-2xl bg-amber-50/40 border border-amber-200/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-amber-600" /> Seller & Store Identity
                  </span>
                  {(inspectedOrder.sellerBusinessId || inspectedOrder.items[0]?.product?.sellerBusinessId) && (
                    <span className="font-mono text-[9px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                      {inspectedOrder.sellerBusinessId || inspectedOrder.items[0]?.product?.sellerBusinessId}
                    </span>
                  )}
                </div>

                <div>
                  <p className="font-bold text-base text-stone-900">
                    {inspectedOrder.sellerStoreName || inspectedOrder.sellerName || inspectedOrder.items[0]?.product?.sellerName || 'Verified Store'}
                  </p>
                  {inspectedOrder.sellerPersonName && (
                    <p className="text-xs text-stone-600 font-medium mt-0.5">
                      Proprietor: {inspectedOrder.sellerPersonName}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5 text-xs text-stone-600 pt-1.5 border-t border-amber-200/60">
                  {(inspectedOrder.sellerEmail || inspectedOrder.items[0]?.product?.sellerEmail) && (
                    <p className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      <span className="font-medium text-stone-800">
                        {inspectedOrder.sellerEmail || inspectedOrder.items[0]?.product?.sellerEmail}
                      </span>
                    </p>
                  )}
                  {(inspectedOrder.sellerPhone || inspectedOrder.items[0]?.product?.sellerPhone) && (
                    <p className="flex items-center gap-2 font-mono">
                      <Phone className="w-3.5 h-3.5 text-burgundy shrink-0" />
                      <span className="font-medium text-stone-800">
                        {inspectedOrder.sellerPhone || inspectedOrder.items[0]?.product?.sellerPhone}
                      </span>
                    </p>
                  )}
                  {(inspectedOrder.sellerAddress || inspectedOrder.items[0]?.product?.sellerAddress) && (
                    <p className="flex items-start gap-2 text-[11px] text-stone-500">
                      <MapPin className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <span>{inspectedOrder.sellerAddress || inspectedOrder.items[0]?.product?.sellerAddress}</span>
                    </p>
                  )}
                  <p className="flex items-center gap-2 pt-1 text-[11px] text-emerald-700 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Seller Escrow Status: Automated Settlement</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Ordered Items List */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block">
                Line Items
              </span>
              <div className="divide-y divide-stone-100 border border-stone-200 rounded-2xl overflow-hidden bg-white">
                {inspectedOrder.items.map((item, idx) => (
                  <div key={item.id || idx} className="p-3.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {item.product.images?.[0] ? (
                        <img
                          src={item.product.images[0]}
                          alt=""
                          className="w-11 h-11 rounded-xl object-cover border border-stone-200"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center">
                          <Package className="w-5 h-5 text-stone-400" />
                        </div>
                      )}
                      <div>
                        <p className="font-semibold text-xs text-stone-900">{item.product.name}</p>
                        <p className="text-[11px] text-stone-500">
                          SKU: <span className="font-mono">{item.product.sku}</span> · Qty: <strong>{item.quantity}</strong>
                          {(item.selectedColor || item.selectedSize) && (
                            <span> · {[item.selectedColor, item.selectedSize].filter(Boolean).join(' / ')}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-xs text-stone-900 block">
                        {formatINR(item.product.price * item.quantity)}
                      </span>
                      <span className="text-[10px] text-stone-500">
                        {formatINR(item.product.price)} each
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Total and COD Badge */}
            <div className="p-4 rounded-2xl bg-cream-50/70 border border-cream-200 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-stone-600 block">Payment Protocol</span>
                <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5 mt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Cash on Delivery (COD)
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-stone-500 block">Total Reconciled Amount</span>
                <span className="text-xl font-bold font-serif text-burgundy block">
                  {formatINR(inspectedOrder.totalAmount)}
                </span>
              </div>
            </div>

            {/* Modal Bottom Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-stone-200 flex-wrap gap-2">
              <Button
                variant="outline"
                size="md"
                onClick={() => {
                  setBillOrder(inspectedOrder);
                }}
                leftIcon={<Printer className="w-4 h-4" />}
              >
                Generate Delivery Bill / Slip
              </Button>

              <div className="flex items-center gap-2">
                {inspectedOrder.orderStatus !== 'COD_DELIVERED' && inspectedOrder.orderStatus !== 'COD_CANCELLED' && (
                  <>
                    <Button
                      variant="primary"
                      size="md"
                      onClick={() => handleUpdateStatus(inspectedOrder.id, 'COD_DELIVERED')}
                      leftIcon={<CheckCircle2 className="w-4 h-4" />}
                    >
                      Mark Delivered (Credit Escrow)
                    </Button>
                    <Button
                      variant="destructive"
                      size="md"
                      onClick={() => handleUpdateStatus(inspectedOrder.id, 'COD_CANCELLED')}
                      leftIcon={<XCircle className="w-4 h-4" />}
                    >
                      Void Order
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Printable Bill / Delivery Slip Modal ──────────────────────────── */}
      {billOrder && (
        <DeliveryBillModal
          order={billOrder}
          onClose={() => setBillOrder(null)}
        />
      )}
    </div>
  );
};
