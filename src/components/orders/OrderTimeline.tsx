import React from 'react';
import { OrderTimelineEvent, CODOrderStatus } from '../../types/order';
import { CheckCircle2, Clock, Truck, Package, XCircle } from 'lucide-react';

interface OrderTimelineProps {
  currentStatus: CODOrderStatus;
  events: OrderTimelineEvent[];
}

export const OrderTimeline: React.FC<OrderTimelineProps> = ({ currentStatus, events }) => {
  const steps: { status: CODOrderStatus; label: string; icon: React.ReactNode }[] = [
    { status: 'COD_PENDING', label: 'Order Logged', icon: <Clock className="w-4 h-4" /> },
    { status: 'COD_CONFIRMED', label: 'Confirmed', icon: <CheckCircle2 className="w-4 h-4" /> },
    { status: 'COD_PROCESSING', label: 'Artisan Prep', icon: <Package className="w-4 h-4" /> },
    { status: 'COD_SHIPPED', label: 'In Transit', icon: <Truck className="w-4 h-4" /> },
    { status: 'COD_DELIVERED', label: 'Delivered (COD Settled)', icon: <CheckCircle2 className="w-4 h-4" /> },
  ];

  if (currentStatus === 'COD_CANCELLED') {
    return (
      <div className="p-4 rounded-xl bg-rosered-50 border border-rosered-200 flex items-center gap-3">
        <XCircle className="w-6 h-6 text-rosered-600 shrink-0" />
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-rosered-800">Order Voided</h4>
          <p className="text-xs text-rosered-700 mt-0.5">
            This COD requisition was cancelled. No delivery or cash transfer will occur.
          </p>
        </div>
      </div>
    );
  }

  const getStepIndex = (status: CODOrderStatus) => {
    return steps.findIndex((s) => s.status === status);
  };

  const currentIndex = getStepIndex(currentStatus);

  return (
    <div className="py-4">
      {/* Horizontal Step Indicator */}
      <div className="flex items-center justify-between relative">
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-stone-200 -translate-y-1/2 z-0" />
        <div
          className="absolute top-1/2 left-0 h-0.5 bg-burgundy -translate-y-1/2 z-0 transition-all duration-500"
          style={{ width: `${(Math.max(0, currentIndex) / (steps.length - 1)) * 100}%` }}
        />

        {steps.map((step, idx) => {
          const isDone = idx <= currentIndex;
          const isCurrent = idx === currentIndex;

          return (
            <div key={step.status} className="relative z-10 flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  isCurrent
                    ? 'bg-burgundy text-white ring-4 ring-burgundy-100 shadow-md'
                    : isDone
                    ? 'bg-burgundy text-white'
                    : 'bg-white text-stone-400 border-2 border-stone-200'
                }`}
              >
                {step.icon}
              </div>
              <span
                className={`text-[10px] font-semibold mt-2 text-center max-w-[80px] hidden sm:block ${
                  isCurrent ? 'text-burgundy font-bold' : isDone ? 'text-stone-800' : 'text-stone-400'
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Log events list */}
      <div className="mt-6 space-y-2 border-t border-cream-200/80 pt-4">
        <h5 className="text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-2">
          Courier & Fulfillment Log
        </h5>
        {events.map((evt, i) => (
          <div key={i} className="flex items-start gap-2.5 text-xs text-stone-600">
            <span className="w-1.5 h-1.5 rounded-full bg-burgundy mt-1.5 shrink-0" />
            <div className="flex-1">
              <span className="font-medium text-stone-900">{evt.description}</span>
              <span className="text-[10px] text-stone-400 ml-2">
                {new Date(evt.timestamp).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
