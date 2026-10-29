import React from 'react';
import { Order } from '../../types/order';
import { formatINR } from '../../lib/currency';
import {
  Printer,
  X,
  User,
  Mail,
  MapPin,
  ShoppingCart,
  Package,
  Gift,
  Briefcase,
  Check,
} from 'lucide-react';
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

  // Format order date: e.g. "28 Oct 2026"
  const orderDate = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });

  // Year for invoice numbering
  const orderYear = order.createdAt ? new Date(order.createdAt).getFullYear() : new Date().getFullYear();

  // Generate KS invoice number matching Image 2 KS-2026-01330 format
  const rawDigits = (order.orderNumber || order.id || '1001').replace(/\D/g, '');
  const invoiceSuffix = rawDigits.length >= 4 ? rawDigits.slice(-5).padStart(5, '0') : order.id.slice(0, 5).toUpperCase();
  const invoiceNumber = `KS-${orderYear}-${invoiceSuffix}`;

  // Customer details
  const customerName = order.customerName || order.shippingAddress?.fullName || 'Campus Patron';
  const customerEmail = order.customerEmail || 'customer@k-shop.example';
  const streetAddress = order.shippingAddress?.streetAddress || 'Campus Hostel / Delivery Point';
  const apartmentSuite = order.shippingAddress?.apartmentSuite;
  const city = order.shippingAddress?.city || 'Campus';
  const postalCode = order.shippingAddress?.postalCode || '600028';
  const formattedAddress = `${streetAddress}${apartmentSuite ? `, ${apartmentSuite}` : ''}`;
  const formattedCityPin = `${city}${postalCode ? `, ${postalCode}` : ''}`;

  // Payment status
  const isPaid = order.orderStatus === 'COD_DELIVERED' || Boolean(order.receivedAmount && order.receivedAmount > 0);
  const paymentStatusLabel = isPaid ? 'PAID' : 'CASH ON DELIVERY';

  // Subtotal, discount, tax, total
  const subtotal = order.subtotal || order.items?.reduce((acc, it) => acc + (it.product?.price || 0) * it.quantity, 0) || order.totalAmount;
  const discount = order.discount || 0;
  const tax = 0; // ₹0.00
  const totalAmount = order.totalAmount || (subtotal - discount);

  // Transaction reference ID
  const transactionId = (order as any).transactionId || (order as any).paymentReference || (order as any).txn_ref || (order.id ? `TXN-${order.id.slice(0, 10).toUpperCase()}` : '—');

  // Helper to pick item icon
  const getItemIcon = (index: number) => {
    switch (index % 3) {
      case 0:
        return <Package className="w-5 h-5 text-burgundy" />;
      case 1:
        return <Gift className="w-5 h-5 text-burgundy" />;
      default:
        return <Briefcase className="w-5 h-5 text-burgundy" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto print:p-0 print:bg-white print:static">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #kshop-invoice-root, #kshop-invoice-root * {
            visibility: visible;
          }
          #kshop-invoice-root {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 16px !important;
            border: none !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      <div className="bg-white rounded-3xl max-w-3xl w-full border border-cream-200 shadow-2xl overflow-hidden print:border-none print:shadow-none print:max-w-none my-6">
        {/* Modal Controls - Hidden during Print */}
        <div className="p-4 bg-stone-900 text-white flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-amber-400" />
            <span className="font-serif font-bold text-sm tracking-wide">
              Official Tax Invoice & Delivery Bill · {invoiceNumber}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              leftIcon={<Printer className="w-3.5 h-3.5" />}
              className="bg-white text-stone-900 hover:bg-stone-100 border-none font-semibold text-xs shadow-xs"
            >
              Print Invoice / PDF
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

        {/* ========================================================================= */}
        {/* Printable Official Tax Invoice matching Image 2 visual design             */}
        {/* ========================================================================= */}
        <div
          id="kshop-invoice-root"
          className="p-6 sm:p-10 bg-white text-stone-900 space-y-6 select-text"
        >
          {/* Top Header Row */}
          <div className="flex items-start justify-between gap-4">
            {/* Left: Burgundy K logo + K-SHOP branding */}
            <div className="flex items-center gap-3.5">
              <div className="w-14 h-14 rounded-2xl bg-[#7A1C28] flex items-center justify-center text-white font-serif font-black text-3xl shadow-sm shrink-0">
                K
              </div>
              <div>
                <h1 className="font-serif font-extrabold text-3xl sm:text-4xl tracking-tight text-stone-900">
                  K-SHOP
                </h1>
                <p className="text-[10px] sm:text-[11px] font-semibold tracking-widest text-[#7A1C28] uppercase mt-0.5">
                  QUALITY PRODUCTS • BETTER EVERYDAY
                </p>
              </div>
            </div>

            {/* Right: Curved Burgundy INVOICE Badge */}
            <div className="text-right">
              <div className="inline-block bg-[#7A1C28] text-white px-7 py-2 rounded-2xl shadow-sm">
                <span className="font-serif font-bold tracking-widest text-xl sm:text-2xl uppercase">
                  INVOICE
                </span>
              </div>
              <p className="text-[10px] font-bold tracking-widest text-stone-500 uppercase mt-1">
                SHOP • ORDER • ENJOY
              </p>
            </div>
          </div>

          {/* Metadata Row: Invoice Details on Left, Thank You on Right */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-2">
            {/* Left: Invoice Number, Date, Status */}
            <div className="sm:col-span-7 space-y-2 text-xs sm:text-sm">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-stone-700 w-32 shrink-0">
                  Invoice Number
                </span>
                <span className="text-stone-300">|</span>
                <span className="font-serif font-bold text-[#7A1C28] text-base tracking-wide">
                  {invoiceNumber}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="font-semibold text-stone-700 w-32 shrink-0">
                  Invoice Date
                </span>
                <span className="text-stone-300">|</span>
                <span className="text-stone-800 font-medium">{orderDate}</span>
              </div>

              <div className="flex items-center gap-3">
                <span className="font-semibold text-stone-700 w-32 shrink-0">
                  Payment Status
                </span>
                <span className="text-stone-300">|</span>
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]">
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                  <span>{paymentStatusLabel}</span>
                </span>
              </div>
            </div>

            {/* Right: Thank you badge with cart icon */}
            <div className="sm:col-span-5 flex items-center justify-start sm:justify-end gap-3 sm:pl-4 sm:border-l sm:border-stone-200">
              <div className="w-12 h-12 rounded-full bg-[#FCF4F3] border border-[#F5D5D3] flex items-center justify-center text-[#7A1C28] shrink-0">
                <ShoppingCart className="w-5 h-5 text-[#7A1C28]" />
              </div>
              <div>
                <h3 className="font-serif font-bold text-base text-[#7A1C28] leading-tight">
                  Thank you
                </h3>
                <p className="text-xs font-semibold text-stone-800">
                  for shopping with K-SHOP!
                </p>
                <p className="text-[11px] text-stone-500">
                  Your support helps us grow
                </p>
                <div className="w-8 h-[2px] bg-[#7A1C28] mt-1.5" />
              </div>
            </div>
          </div>

          {/* Burgundy Separator Bar */}
          <div className="h-[1.5px] bg-[#8B1E2D] w-full" />

          {/* Bill To Section */}
          <div className="space-y-2.5">
            <h2 className="font-serif font-bold text-base sm:text-lg text-[#7A1C28]">
              Bill To:
            </h2>
            <div className="space-y-1.5 text-xs sm:text-sm text-stone-700">
              <div className="flex items-center gap-2.5 font-semibold text-stone-900">
                <div className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 shrink-0">
                  <User className="w-3.5 h-3.5 text-stone-600" />
                </div>
                <span>{customerName}</span>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 shrink-0">
                  <Mail className="w-3.5 h-3.5 text-stone-600" />
                </div>
                <span>{customerEmail}</span>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 shrink-0 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-stone-600" />
                </div>
                <div>
                  <p>{formattedAddress}</p>
                  <p className="text-stone-500">{formattedCityPin}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Itemized Table */}
          <div className="overflow-hidden border border-[#F2DEDE] rounded-xl">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead className="bg-[#FCF4F3] border-b border-[#F2DEDE] text-[#7A1C28] font-serif font-bold">
                <tr>
                  <th className="py-3 px-4 w-[46%]">Item</th>
                  <th className="py-3 px-3 text-center w-[12%]">Qty</th>
                  <th className="py-3 px-3 text-right w-[14%]">Unit Price</th>
                  <th className="py-3 px-3 text-right w-[12%]">Tax</th>
                  <th className="py-3 px-4 text-right w-[16%]">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F6E8E8]">
                {order.items && order.items.length > 0 ? (
                  order.items.map((item, index) => {
                    const unitPrice = item.product?.price || 0;
                    const lineAmount = unitPrice * item.quantity;
                    const subDesc =
                      [
                        item.product?.category,
                        item.product?.sku ? `SKU: ${item.product.sku}` : null,
                        item.selectedColor ? `Color: ${item.selectedColor}` : null,
                        item.selectedSize ? `Size: ${item.selectedSize}` : null,
                      ]
                        .filter(Boolean)
                        .join(' • ') || 'Standard Product Package';

                    return (
                      <tr key={item.id || index} className="hover:bg-cream-50/40">
                        {/* Item column with icon */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-[#FCF4F3] border border-[#F5D5D3] flex items-center justify-center shrink-0">
                              {getItemIcon(index)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-stone-900 truncate">
                                {item.product?.name || 'K-Shop Product'}
                              </p>
                              <p className="text-[11px] text-stone-500 truncate">
                                {subDesc}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Qty */}
                        <td className="py-3.5 px-3 text-center text-stone-800 font-medium">
                          {item.quantity}
                        </td>

                        {/* Unit Price */}
                        <td className="py-3.5 px-3 text-right text-stone-700 font-mono">
                          {formatINR(unitPrice)}
                        </td>

                        {/* Tax */}
                        <td className="py-3.5 px-3 text-right text-stone-700 font-mono">
                          ₹0.00
                        </td>

                        {/* Amount */}
                        <td className="py-3.5 px-4 text-right font-bold text-stone-900 font-mono">
                          {formatINR(lineAmount)}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-4 px-4 text-center text-stone-500">
                      No order items recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Payment Method & Totals Breakdown Section */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-start pt-2">
            {/* Left: Payment Method and Transaction ID */}
            <div className="sm:col-span-6 space-y-3.5">
              <div>
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#7A1C28]">
                  Payment Method
                </h3>
                <p className="text-xs sm:text-sm text-stone-800 mt-1">
                  Cash on Delivery / Online Payment
                </p>
              </div>

              <div className="border-t border-stone-200 pt-3">
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#7A1C28]">
                  Transaction ID
                </h3>
                <p className="font-mono text-xs sm:text-sm text-stone-800 mt-1">
                  {transactionId}
                </p>
              </div>
            </div>

            {/* Right: Subtotal, Discount, Tax and Burgundy Total Block */}
            <div className="sm:col-span-6 space-y-2">
              <div className="space-y-1.5 text-xs sm:text-sm text-stone-700 px-2">
                <div className="flex justify-between">
                  <span className="font-semibold text-stone-700">Subtotal:</span>
                  <span className="font-mono font-medium text-stone-900">
                    {formatINR(subtotal)}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="font-semibold text-stone-700">Discount:</span>
                  <span className="font-mono font-medium text-stone-900">
                    {discount > 0 ? `-${formatINR(discount)}` : '₹0.00'}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="font-semibold text-stone-700">Tax:</span>
                  <span className="font-mono font-medium text-stone-900">
                    {formatINR(tax)}
                  </span>
                </div>
              </div>

              {/* Solid Burgundy Total Pill */}
              <div className="bg-[#7A1C28] text-white rounded-xl px-5 py-3.5 flex items-center justify-between shadow-xs">
                <span className="font-serif font-bold text-lg sm:text-xl">
                  Total:
                </span>
                <span className="font-serif font-extrabold text-xl sm:text-2xl tracking-wide">
                  {formatINR(totalAmount)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer Note */}
          <div className="pt-6 border-t border-stone-200 grid grid-cols-1 sm:grid-cols-12 gap-4 text-xs">
            {/* Left side with burgundy vertical accent */}
            <div className="sm:col-span-7 flex items-start gap-2.5">
              <div className="w-1 self-stretch bg-[#7A1C28] rounded-full shrink-0" />
              <div>
                <p className="font-serif font-bold text-stone-900 text-xs sm:text-sm">
                  Thank you for shopping with K-SHOP!
                </p>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  For support: support@k-shop.example
                </p>
              </div>
            </div>

            {/* Right side note */}
            <div className="sm:col-span-5 text-stone-500 text-[11px] sm:text-right sm:border-l sm:border-stone-200 sm:pl-4">
              <p>This is a computer-generated invoice.</p>
              <p className="mt-0.5">
                If you have any questions, please contact our support team.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
