function formatTimestamp(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

const EVENT_LABELS = {
  OrderCreated: 'Order Created',
  PaymentInitiated: 'Payment Initiated',
  PaymentSuccessful: 'Payment Successful',
  PaymentFailed: 'Payment Failed',
  StockReservationFailed: 'Stock Reservation Failed',
  OrderConfirmed: 'Order Confirmed',
  OrderCancelled: 'Order Cancelled',
};

export default function OrderTimeline({ timeline }) {
  if (!timeline || timeline.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">Order Timeline</h3>
      <div className="flex flex-col">
        {timeline.map((step, i) => {
          const isLast = i === timeline.length - 1;
          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`h-2.5 w-2.5 rounded-full mt-1.5 shrink-0 ${
                    step.success ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                {!isLast && <span className="w-px flex-1 bg-[hsl(var(--border))] my-1" />}
              </div>
              <div className="pb-4">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-sm font-medium">
                    {EVENT_LABELS[step.event_name] || step.event_name}
                  </p>
                  <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono">
                    {formatTimestamp(step.occurred_at)}
                  </span>
                </div>
                {step.detail && (
                  <p
                    className={`text-xs mt-0.5 ${
                      step.success ? 'text-[hsl(var(--muted-foreground))]' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {step.detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}