import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Order } from '../../types/order';
import { RefundReason } from '../../types/refund';
import { Select } from '../common/Select';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import { refundService } from '../../services/refundService';
import { AlertCircle, FileText, CheckCircle2 } from 'lucide-react';
import { formatINR } from '../../lib/currency';

interface RefundRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onSuccess?: () => void;
}

const MISTAKE_OPTIONS: { label: string; mistake: string; reason: RefundReason }[] = [
  {
    label: 'Seller Mistake: Sent wrong item, incorrect size/color, or missing components',
    mistake: 'Seller Mistake / Fulfillment Error',
    reason: 'WRONG_ITEM_RECEIVED',
  },
  {
    label: 'Courier Mistake: Package damaged in transit, crushed box, or broken item',
    mistake: 'Courier / Transit Damage',
    reason: 'DAMAGED_ON_DELIVERY',
  },
  {
    label: 'Defect Mistake: Functional breakdown, mechanism malfunction, or defective craftsmanship',
    mistake: 'Product / Manufacturing Defect',
    reason: 'DEFECTIVE_COMPONENT',
  },
  {
    label: 'Catalog Mistake: Product differs significantly from catalog photos / description',
    mistake: 'Catalog / Specification Discrepancy',
    reason: 'NOT_AS_DESCRIBED',
  },
  {
    label: 'Customer Fit / Other Mistake: Sizing mismatch, ordered accidentally, or other issue',
    mistake: 'Customer Sizing / Other Consideration',
    reason: 'OTHER',
  },
];

export const RefundRequestModal: React.FC<RefundRequestModalProps> = ({
  isOpen,
  onClose,
  order,
  onSuccess,
}) => {
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedMistakeIndex, setSelectedMistakeIndex] = useState<number>(0);
  const [description, setDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const { showToast } = useToast();

  if (!order) return null;

  const activeItem = order.items.find((i) => i.product.id === (selectedProductId || order.items[0]?.product.id)) || order.items[0];

  const orderNumMatch = String(order.orderCode || order.orderNumber || '').match(/\d{4}$/);
  const hex = String(order.id || '').replace(/[^0-9a-f]/gi, '').slice(0, 8);
  const derivedNum = orderNumMatch ? orderNumMatch[0] : (hex ? String((parseInt(hex, 16) % 9000) + 1000) : '1001');
  const previewReturnCode = `CNRT-${derivedNum}`;
  const previewRefundCode = `CNRF-${derivedNum}`;

  const currentOption = MISTAKE_OPTIONS[selectedMistakeIndex] || MISTAKE_OPTIONS[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      showToast('Please specify the mistake or issue in detail for our review board.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const fullDescription = `[Mistake: ${currentOption.mistake}] ${description.trim()}`;
      const claim = await refundService.submitRefundClaim({
        orderId: order.id,
        orderNumber: order.orderNumber,
        productId: activeItem.product.id,
        productName: activeItem.product.name,
        productImage: activeItem.product.images[0] || '',
        customerId: order.customerId,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        sellerId: activeItem.product.sellerId,
        sellerName: activeItem.product.sellerName,
        amount: activeItem.product.price * activeItem.quantity,
        reason: currentOption.reason,
        description: fullDescription,
      });

      const retCode = claim.returnCode || previewReturnCode;
      const refCode = claim.refundCode || previewRefundCode;

      showToast(`Return claim registered! Return ID: ${retCode} • Refund Ref: ${refCode}`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to submit return & refund dossier.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Initiate Return & Refund Claim"
      subtitle={`Order Requisition ${order.orderCode || order.orderNumber}`}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Identifier Badges */}
        <div className="grid grid-cols-2 gap-3 p-3 bg-stone-50 rounded-2xl border border-stone-200">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Return Code:</span>
            <span className="px-2 py-0.5 rounded-md bg-stone-800 text-stone-100 font-mono text-xs font-bold">
              {previewReturnCode}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Refund Code:</span>
            <span className="px-2 py-0.5 rounded-md bg-burgundy text-white font-mono text-xs font-bold">
              {previewRefundCode}
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-cream-50 border border-cream-300 text-xs text-stone-700 flex items-start gap-2.5">
          <FileText className="w-4 h-4 text-burgundy shrink-0 mt-0.5" />
          <p>
            Upon submission, your return dossier (<strong>{previewReturnCode}</strong>) is audited by platform governance and the artisan seller. Once approved, the refund (<strong>{previewRefundCode}</strong>) is processed directly.
          </p>
        </div>

        {/* Select item if multiple */}
        {order.items.length > 1 && (
          <div>
            <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
              Select Item to Return
            </label>
            <div className="space-y-2">
              {order.items.map((it) => (
                <label
                  key={it.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    (selectedProductId || order.items[0]?.product.id) === it.product.id
                      ? 'bg-ivory border-burgundy'
                      : 'border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="product"
                    checked={(selectedProductId || order.items[0]?.product.id) === it.product.id}
                    onChange={() => setSelectedProductId(it.product.id)}
                    className="accent-burgundy"
                  />
                  <img src={it.product.images[0]} alt="" className="w-10 h-10 rounded-lg object-cover" />
                  <div className="flex-1 text-xs">
                    <p className="font-semibold text-stone-900">{it.product.name}</p>
                    <p className="text-stone-500">{formatINR(it.product.price)} • Qty: {it.quantity}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Question: What mistake happened? */}
        <div>
          <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
            What Mistake or Reason Occurred? (Select Issue)
          </label>
          <div className="space-y-2">
            {MISTAKE_OPTIONS.map((opt, idx) => (
              <label
                key={idx}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all text-xs ${
                  selectedMistakeIndex === idx
                    ? 'bg-ivory border-burgundy shadow-sm'
                    : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                }`}
              >
                <input
                  type="radio"
                  name="mistakeOption"
                  checked={selectedMistakeIndex === idx}
                  onChange={() => setSelectedMistakeIndex(idx)}
                  className="accent-burgundy mt-0.5"
                />
                <div>
                  <p className="font-semibold text-stone-900">{opt.mistake}</p>
                  <p className="text-stone-500 mt-0.5">{opt.label}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Question: Detailed Mistake Explanation */}
        <div>
          <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
            Describe Mistake or Condition in Detail
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            rows={4}
            placeholder="Please explain the mistake, what went wrong with the piece, and condition of packaging..."
            className="w-full bg-white border border-stone-200 rounded-lg p-3 text-sm text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-cream-200">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" isLoading={isSubmitting}>
            Submit Return ({previewReturnCode}) & Refund ({previewRefundCode})
          </Button>
        </div>
      </form>
    </Modal>
  );
};
