import React, { useState, useEffect } from 'react';
import { orderService } from '../../services/orderService';
import { Order, CODOrderStatus } from '../../types/order';
import { ErrorState } from '../../components/common/ErrorState';
import { formatINR } from '../../lib/currency';
import { ShoppingBag } from 'lucide-react';

export const SellerOrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
        <div className="bg-white rounded-3xl border border-cream-200 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-ivory border-b border-cream-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-4 px-5">Order ID</th>
                  <th className="py-4 px-4">Date</th>
                  <th className="py-4 px-4">Customer Name</th>
                  <th className="py-4 px-4">Product ID & Name</th>
                  <th className="py-4 px-4">Price & Qty</th>
                  <th className="py-4 px-4">Delivery Location</th>
                  <th className="py-4 px-5 text-right">Delivery Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-100">
                {orders.map((order) => {
                  const progress = getAdminProgressDisplay(order.orderStatus);
                  const orderCode = order.orderCode || order.orderNumber;
                  const firstItem = order.items[0];
                  const itemMatch = String(firstItem?.product?.sku || '').match(/\d{4}$/);
                  const itemHex = String(firstItem?.product?.id || '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
                  const itemDigits = itemMatch ? itemMatch[0] : (itemHex ? String((parseInt(itemHex, 16) % 9000) + 1000) : '1001');
                  const productCode = (firstItem?.product as any)?.productCode || `KNPR-${itemDigits}`;

                  return (
                    <tr key={order.id} className="hover:bg-cream-50/50">
                      {/* Order ID */}
                      <td className="py-4 px-5">
                        <span className="font-mono font-bold text-stone-900 block text-xs">
                          {orderCode}
                        </span>
                        <span className="text-[10px] text-stone-400 font-mono">
                          COD Payment
                        </span>
                      </td>

                      {/* Date */}
                      <td className="py-4 px-4 text-stone-500 text-[11px] whitespace-nowrap">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>

                      {/* Customer Name */}
                      <td className="py-4 px-4">
                        <p className="font-semibold text-stone-900 text-xs">{order.customerName}</p>
                        {order.customerBusinessId && (
                          <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-mono text-[10px]">
                            {order.customerBusinessId}
                          </span>
                        )}
                        <p className="text-[10px] text-stone-400 mt-0.5">{order.customerPhone}</p>
                      </td>

                      {/* Product ID & Name */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-burgundy/10 text-burgundy font-mono text-[10px] font-bold shrink-0">
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
                        <p className="font-bold text-stone-900 text-xs">
                          {formatINR(order.totalAmount)}
                        </p>
                        <p className="text-[10px] text-stone-500">
                          Qty: {firstItem?.quantity || 1}
                        </p>
                      </td>

                      {/* Delivery Location (Campus & Dept) */}
                      <td className="py-4 px-4 text-stone-600 text-xs max-w-xs">
                        <p className="font-medium text-stone-900 truncate">
                          {order.shippingAddress?.streetAddress || 'Campus Delivery'}
                        </p>
                        {order.shippingAddress?.apartmentSuite && order.shippingAddress.apartmentSuite !== 'Campus Delivery' && (
                          <p className="text-[10px] text-stone-400 truncate">
                            {order.shippingAddress.apartmentSuite}
                          </p>
                        )}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
