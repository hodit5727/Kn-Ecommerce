import React from 'react';
import { Order } from '../../types/order';
import { formatINR } from '../../lib/currency';
import { Printer, X, ShieldCheck, CheckCircle2, Building, Phone, Mail, MapPin, Calendar, Package } from 'lucide-react';
import { Button } from '../common/Button';

interface DeliveryBillModalProps {
  order: Order | null;
  onClose: () => void;
}

export const DeliveryBillModal: React.FC<DeliveryBillModalProps> = ({ order, onClose }) => {
  if (!order) return null;

  const handlePrint = () => {
    window.print();
  };

  const orderCode = order.orderCode || (order.orderNumber?.match(/\d{4}$/) ? `KNOR-${order.orderNumber.match(/\d{4}/)![0]}` : order.orderNumber);
  const customerPhone = order.customerPhone || order.shippingAddress?.phone || 'Not provided';
  const customerName = order.customerName || order.shippingAddress?.fullName || 'Campus Patron';
  const customerEmail = order.customerEmail || 'N/A';
  const sellerStore = order.sellerStoreName || order.sellerName || order.items[0]?.product?.sellerName || 'Store';
  const sellerEmail = order.sellerEmail || order.items[0]?.product?.sellerEmail || '';
  const sellerPhone = order.sellerPhone || order.items[0]?.product?.sellerPhone || '';
  const sellerAddress = order.sellerAddress || order.items[0]?.product?.sellerAddress || '';

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-3xl max-w-2xl w-full border border-cream-200 shadow-2xl overflow-hidden print:border-none print:shadow-none print:max-w-none">
        {/* Modal Controls - Hidden during Print */}
        <div className="p-4 bg-stone-900 text-white flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-amber-400" />
            <span className="font-serif font-bold text-sm tracking-wide">
              Delivery Challan & Tax Invoice #{orderCode}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              leftIcon={<Printer className="w-3.5 h-3.5" />}
              className="bg-white text-stone-900 hover:bg-stone-100 border-none font-semibold text-xs"
            >
              Print Slip / PDF
            </Button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Invoice & Delivery Slip Content */}
        <div className="p-6 sm:p-8 space-y-6 text-stone-900 bg-white" id="printable-bill">
          {/* Slip Header */}
          <div className="flex items-start justify-between border-b-2 border-stone-900 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-serif font-extrabold text-2xl tracking-wider text-burgundy">
                  K-SHOP
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                  Campus Marketplace
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-1">
                Official Campus Commerce · COD Delivery Slip & Tax Receipt
              </p>
            </div>

            <div className="text-right">
              <span className="font-mono font-bold text-lg text-stone-900 block">
                {orderCode}
              </span>
              <span className="text-[11px] text-stone-500 flex items-center justify-end gap-1 mt-0.5">
                <Calendar className="w-3 h-3" />
                {new Date(order.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>

          {/* Delivery & Seller Grid */}
          <div className="grid grid-cols-2 gap-6 text-xs pb-4 border-b border-stone-200">
            {/* Customer Details */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block">
                Delivered To (Customer)
              </span>
              <p className="font-bold text-sm text-stone-900">{customerName}</p>
              <p className="text-stone-600 flex items-center gap-1.5">
                <Phone className="w-3 h-3 text-burgundy shrink-0" />
                <span className="font-mono font-semibold">{customerPhone}</span>
              </p>
              <p className="text-stone-600 flex items-center gap-1.5">
                <Mail className="w-3 h-3 text-stone-400 shrink-0" />
                <span>{customerEmail}</span>
              </p>
              <p className="text-stone-600 flex items-start gap-1.5 pt-1">
                <MapPin className="w-3 h-3 text-stone-400 shrink-0 mt-0.5" />
                <span>
                  {order.shippingAddress?.streetAddress}
                  {order.shippingAddress?.apartmentSuite ? `, ${order.shippingAddress.apartmentSuite}` : ''}
                  , {order.shippingAddress?.city} - {order.shippingAddress?.postalCode}
                </span>
              </p>
              {order.customerBusinessId && (
                <span className="inline-block font-mono text-[9px] font-bold text-burgundy bg-burgundy/5 px-2 py-0.5 rounded border border-burgundy/20 mt-1">
                  ID: {order.customerBusinessId}
                </span>
              )}
            </div>

            {/* Seller & Dispatch Details */}
            <div className="space-y-1 text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block">
                Sold & Dispatched By
              </span>
              <p className="font-bold text-sm text-stone-900">{sellerStore}</p>
              {order.sellerPersonName && order.sellerPersonName !== sellerStore && (
                <p className="text-stone-600 text-[11px] font-medium">
                  Proprietor: {order.sellerPersonName}
                </p>
              )}
              {sellerEmail && (
                <p className="text-stone-600 flex items-center justify-end gap-1.5 text-xs">
                  <Mail className="w-3 h-3 text-stone-400" />
                  <span>{sellerEmail}</span>
                </p>
              )}
              {sellerPhone && (
                <p className="text-stone-600 font-mono flex items-center justify-end gap-1.5 text-xs">
                  <Phone className="w-3 h-3 text-burgundy" />
                  <span>{sellerPhone}</span>
                </p>
              )}
              {sellerAddress && (
                <p className="text-stone-500 text-[10px] flex items-center justify-end gap-1.5 max-w-[240px] ml-auto">
                  <MapPin className="w-3 h-3 text-stone-400 shrink-0" />
                  <span className="truncate">{sellerAddress}</span>
                </p>
              )}
              <div className="pt-2 flex justify-end">
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Escrow Verified
                </span>
              </div>
            </div>
          </div>

          {/* Itemized Table */}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block mb-2">
              Order Specification & Items
            </span>
            <table className="w-full text-left text-xs border border-stone-200 rounded-xl overflow-hidden">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 uppercase font-semibold text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Item Description</th>
                  <th className="py-2.5 px-3">SKU</th>
                  <th className="py-2.5 px-3 text-center">Qty</th>
                  <th className="py-2.5 px-3 text-right">Unit Price</th>
                  <th className="py-2.5 px-3 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {order.items.map((item, idx) => (
                  <tr key={item.id || idx}>
                    <td className="py-2.5 px-3 font-medium text-stone-900">
                      {item.product.name}
                      {(item.selectedColor || item.selectedSize) && (
                        <span className="block text-[10px] text-stone-500 font-normal">
                          {[item.selectedColor, item.selectedSize].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-stone-600">
                      {item.product.sku || 'KNPR-DEF'}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold">
                      {item.quantity}
                    </td>
                    <td className="py-2.5 px-3 text-right text-stone-600">
                      {formatINR(item.product.price)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-stone-900">
                      {formatINR(item.product.price * item.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Payment & Amount Summary */}
          <div className="bg-cream-50/80 rounded-2xl p-4 border border-cream-200 flex items-center justify-between flex-wrap gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block">
                Payment Protocol:
              </span>
              <div className="flex items-center gap-1.5 font-bold text-stone-900 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Cash on Delivery (COD) Collected</span>
              </div>
              <p className="text-[11px] text-stone-500">
                Authorized platform delivery handover completed.
              </p>
            </div>

            <div className="text-right space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block">
                Total Amount Paid
              </span>
              <span className="text-xl font-bold font-serif text-burgundy block">
                {formatINR(order.totalAmount)}
              </span>
              <span className="text-[10px] text-emerald-700 font-bold block">
                ✓ Full Balance Reconciled
              </span>
            </div>
          </div>

          {/* Signatures & Footer Note */}
          <div className="pt-6 border-t border-stone-200 flex items-end justify-between text-[11px] text-stone-500">
            <div>
              <p className="font-semibold text-stone-700">Campus Logistics Verification</p>
              <p>Physical package inspected and accepted by recipient.</p>
              <p className="text-[9px] text-stone-400 mt-1">Generated by K-Shop Central Ledger</p>
            </div>

            <div className="text-right border-t border-dashed border-stone-400 pt-2 w-44">
              <span className="text-[10px] uppercase font-bold text-stone-700 block">
                Courier / Signatory
              </span>
              <span className="text-[9px] text-stone-400">Verified & Delivered</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
