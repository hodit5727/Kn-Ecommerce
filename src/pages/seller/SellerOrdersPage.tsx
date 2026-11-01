import React, { useState, useEffect } from 'react';
import { orderService } from '../../services/orderService';
import { Order, CODOrderStatus } from '../../types/order';
import { ErrorState } from '../../components/common/ErrorState';
import { formatINR } from '../../lib/currency';
import { ShoppingBag, FileText } from 'lucide-react';
import { DeliveryBillModal } from '../../components/order/DeliveryBillModal';
import { formatDateDDMMYYYY, formatProductCode } from '../../lib/dateFormat';

export const SellerOrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBillOrder, setSelectedBillOrder] = useState<Order | null>(null);

  const loadOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await orderService.getOrders();
      setOrders(data);
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve customer orders.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const getAdminProgressDisplay = (status: CODOrderStatus) => {
    switch (status) {
      case 'COD_PENDING':
        return {
          label: 'Order Placed',
          desc: 'Awaiting Admin Confirmation',
          variant: 'amber' as const,
        };
      case 'COD_CONFIRMED':
        return {
          label: 'Admin Confirmed',
          desc: 'Packing in Progress',
          variant: 'blue' as const,
        };
      case 'COD_PROCESSING':
        return {
          label: 'Packed by Admin',
          desc: 'Ready for Dispatch',
          variant: 'blue' as const,
        };
      case 'COD_SHIPPED':
        return {
          label: 'Out for Delivery',
          desc: 'Admin Delivery Assigned',
          variant: 'burgundy' as const,
        };
      case 'COD_DELIVERED':
        return {
          label: 'Delivered',
          desc: 'Payment Collected',
          variant: 'emerald' as const,
        };
      case 'COD_CANCELLED':
        return {
          label: 'Cancelled',
          desc: 'Order Cancelled',
          variant: 'stone' as const,
        };
      default:
        return {
          label: String(status).replace('COD_', ''),
          desc: 'Admin Handling',
          variant: 'stone' as const,
        };
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="border-b border-cream-200 pb-5">
        <span className="text-xs font-bold uppercase tracking-wider text-burgundy block mb-1">
          Store Management
        </span>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
          My Customer Orders
        </h1>
        <p className="text-xs text-stone-500 mt-1">
          View customer orders and live delivery progress. Dispatch and delivery are managed centrally by the platform Admin.
        </p>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadOrders} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-3xl border border-cream-200 p-12 text-center shadow-soft">
          <ShoppingBag className="w-12 h-12 text-stone-300 mx-auto mb-3" />
          <h3 className="font-serif font-bold text-lg text-stone-900">No Customer Orders Yet</h3>
          <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto">
            When customers place orders for your products, order details, customer info, and live admin delivery progress will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Mobile Stacked Cards (Visible on screens < md) */}
          <div className="md:hidden space-y-3">
            {orders.map((order) => {
              const progress = getAdminProgressDisplay(order.orderStatus);
              const firstItem = order.items[0];
              const productCode = (firstItem?.product as any)?.productCode || formatProductCode(firstItem?.product?.sku, firstItem?.product?.id);

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl border border-cream-200/90 shadow-soft p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-stone-400 block tracking-wider">
                        Date
                      </span>
                      <p className="font-mono text-sm font-bold text-stone-900">
                        {formatDateDDMMYYYY(order.createdAt)}
                      </p>
                      <span className="text-[10px] text-stone-400 font-mono">
                        Cash on Delivery
                      </span>
                    </div>
                    <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold ${
                      order.orderStatus === 'COD_DELIVERED'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : order.orderStatus === 'COD_SHIPPED'
                        ? 'bg-burgundy/10 text-burgundy border border-burgundy/20'
                        : order.orderStatus === 'COD_CANCELLED'
                        ? 'bg-stone-100 text-stone-500 border border-stone-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}>
                      {progress.label}
                    </span>
                  </div>

                  <div className="bg-cream-50/70 rounded-xl p-3 text-xs space-y-2 border border-cream-200/80">
                    <div>
                      <span className="text-stone-500 block text-[10px]">Product</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="px-1.5 py-0.5 rounded bg-burgundy/10 text-burgundy font-mono text-[10px] font-bold shrink-0">
                          {productCode}
                        </span>
                        <span className="font-medium text-stone-900 truncate">
                          {firstItem?.product?.name || 'Product'}
                        </span>
                      </div>
                      {order.items.length > 1 && (
                        <span className="text-[10px] text-stone-400 block mt-0.5">
                          +{order.items.length - 1} more item(s)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <span className="text-[10px] text-stone-400 block">Total Amount</span>
                      <p className="font-mono font-bold text-stone-900 text-sm">
                        {formatINR(order.totalAmount)}
                      </p>
                      <span className="text-[10px] text-stone-500">Qty: {firstItem?.quantity || 1}</span>
                    </div>
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedBillOrder(order)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-burgundy hover:underline"
                      >
                        <FileText className="w-3 h-3" /> Invoice Slip
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Luxury Table (Visible on screens >= md) */}
          <div className="hidden md:block bg-white rounded-3xl border border-cream-200/90 shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-stone-50/80 border-b border-cream-200/80 text-stone-500 uppercase tracking-widest font-bold text-[10px]">
                    <th className="py-4 px-5">Date</th>
                    <th className="py-4 px-5">Product ID & Name</th>
                    <th className="py-4 px-4">Price & Qty</th>
                    <th className="py-4 px-4">Delivery Logistics</th>
                    <th className="py-4 px-5 text-right">Delivery Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-100">
                  {orders.map((order) => {
                    const progress = getAdminProgressDisplay(order.orderStatus);
                    const firstItem = order.items[0];
                    const productCode = (firstItem?.product as any)?.productCode || formatProductCode(firstItem?.product?.sku, firstItem?.product?.id);

                    return (
                      <tr key={order.id} className="hover:bg-cream-50/50 transition-colors">
                        {/* Date (DD/MM/YYYY) */}
                        <td className="py-4 px-5 text-stone-800 font-mono font-medium text-xs whitespace-nowrap">
                          {formatDateDDMMYYYY(order.createdAt)}
                        </td>

                        {/* Product ID & Name */}
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-burgundy/10 text-burgundy font-mono text-xs font-bold shrink-0">
                              {productCode}
                            </span>
                            <span className="font-medium text-stone-900 line-clamp-1 text-xs">
                              {firstItem?.product?.name || 'Product'}
                            </span>
                          </div>
                          {order.items.length > 1 && (
                            <span className="text-[10px] text-stone-400 block mt-0.5">
                              +{order.items.length - 1} more item(s)
                            </span>
                          )}
                        </td>

                        {/* Price & Qty */}
                        <td className="py-4 px-4">
                          <p className="font-bold font-mono text-stone-900 text-xs">
                            {formatINR(order.totalAmount)}
                          </p>
                          <p className="text-[10px] text-stone-500">
                            Qty: {firstItem?.quantity || 1}
                          </p>
                        </td>

                        {/* Delivery Logistics (Managed by Admin) */}
                        <td className="py-4 px-4 text-stone-600 text-xs max-w-xs">
                          <p className="font-medium text-stone-900 truncate">
                            Campus Fulfillment Hub
                          </p>
                          <p className="text-[10px] text-stone-400 truncate">
                            Managed by Admin Delivery
                          </p>
                        </td>

                        {/* Admin Delivery Progress */}
                        <td className="py-4 px-5 text-right whitespace-nowrap">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            order.orderStatus === 'COD_DELIVERED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : order.orderStatus === 'COD_SHIPPED'
                              ? 'bg-burgundy/10 text-burgundy border border-burgundy/20'
                              : order.orderStatus === 'COD_CANCELLED'
                              ? 'bg-stone-100 text-stone-500 border border-stone-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}>
                            {progress.label}
                          </span>
                          <span className="block text-[10px] text-stone-400 mt-1">
                            {progress.desc}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedBillOrder(order)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-burgundy hover:underline mt-1.5"
                          >
                            <FileText className="w-3 h-3" /> Invoice Slip
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {selectedBillOrder && (
        <DeliveryBillModal
          order={selectedBillOrder}
          onClose={() => setSelectedBillOrder(null)}
        />
      )}
    </div>
  );
};
