import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Order } from '../../types/order';
import { Select } from '../common/Select';
import { Button } from '../common/Button';
import { AlertCircle } from 'lucide-react';

interface CancelOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onConfirmCancel: (orderId: string, reason: string) => Promise<void>;
}

export const CancelOrderModal: React.FC<CancelOrderModalProps> = ({
  isOpen,
  onClose,
  order,
  onConfirmCancel,
}) => {
  const [reason, setReason] = useState<string>('CHANGED_MIND');
  const [additionalNotes, setAdditionalNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!order) return null;

  const handleCancel = async () => {
    setIsSubmitting(true);
    try {
      const fullReason = `${reason.replace(/_/g, ' ')}${additionalNotes ? `: ${additionalNotes}` : ''}`;
      await onConfirmCancel(order.id, fullReason);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cancel Cash on Delivery Order"
      subtitle={`Requisition ${order.orderNumber}`}
      maxWidth="md"
    >
      <div className="space-y-4">
        <div className="p-3.5 rounded-xl bg-rosered-50 border border-rosered-200 text-xs text-rosered-800 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rosered-600 shrink-0 mt-0.5" />
          <p>
            Cancellation is instantaneous prior to courier dispatch. Because this is a COD order,
            no financial debits have taken place.
          </p>
        </div>

        <Select
          label="Primary Reason for Cancellation"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          options={[
            { value: 'CHANGED_MIND', label: 'Changed my mind / Postponed acquisition' },
            { value: 'ORDERED_BY_MISTAKE', label: 'Ordered incorrect specification or duplicate' },
            { value: 'DELIVERY_TIME_LONG', label: 'Delivery window does not align with schedule' },
            { value: 'FOUND_ALTERNATIVE', label: 'Acquired alternative piece' },
            { value: 'OTHER', label: 'Other personal consideration' },
          ]}
        />

        <div>
          <label className="block text-xs font-semibold tracking-wider text-stone-700 uppercase mb-1.5">
            Additional Comments (Optional)
          </label>
          <textarea
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            rows={3}
            placeholder="Share any specific notes for the atelier concierge..."
            className="w-full bg-white border border-stone-200 rounded-lg p-3 text-sm text-stone-900 focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-cream-200">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            Keep Order Active
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleCancel}
            isLoading={isSubmitting}
          >
            Confirm Cancellation
          </Button>
        </div>
      </div>
    </Modal>
  );
};
