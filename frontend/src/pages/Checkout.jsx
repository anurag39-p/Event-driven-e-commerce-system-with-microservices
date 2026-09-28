import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, Package, CheckCircle2, XCircle } from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import OrderTimeline from '../components/OrderTimeline.jsx';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

const STATUS_STYLES = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  CONFIRMED: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

export default function Checkout() {
  const { items, subtotal, totalItemCount, clearCart } = useCart();
  const { user } = useAuth();

  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [order, setOrder] = useState(null);
  const [orderPlacedAt, setOrderPlacedAt] = useState(null);
  const [error, setError] = useState('');
  const [hasClearedCart, setHasClearedCart] = useState(false);
  const [orderedItems, setOrderedItems] = useState([]);

  async function handlePlaceOrder() {
    setError('');
    setIsPlacingOrder(true);

    try {
      const orderItems = items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
      }));

      setOrderedItems(items);

      const res = await api.post('/orders', { items: orderItems });
      setOrder(res.data.order);
      setOrderPlacedAt(Date.now());
    } catch (err) {
      setError(err.message || 'Failed to place order. Please try again.');
    } finally {
      setIsPlacingOrder(false);
    }
  }

  function handleTryAgain() {
    setOrder(null);
    setOrderPlacedAt(null);
    setError('');
    setOrderedItems([]);
  }

  const { data: liveOrder } = useQuery({
    queryKey: ['order', order?.id],
    queryFn: async () => {
      const res = await api.get(`/orders/${order.id}`);
      return res.data.order;
    },
    enabled: !!order,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'CONFIRMED' || status === 'CANCELLED') return false;
      if (orderPlacedAt && Date.now() - orderPlacedAt > POLL_TIMEOUT_MS) return false;
      return POLL_INTERVAL_MS;
    },
  });

  const displayOrder = liveOrder || order;
  const currentStatus = displayOrder?.status || 'PENDING';
  const timedOut =
    currentStatus === 'PENDING' &&
    orderPlacedAt &&
    Date.now() - orderPlacedAt > POLL_TIMEOUT_MS;
  const isPolling = currentStatus === 'PENDING' && !timedOut;

  // Once an order exists, prefer the server's response over the client's
  // pre-checkout cart snapshot for anything price-related. Order Service
  // now looks up each item's real price itself (see the price-trust fix)
  // rather than trusting whatever was in the cart, so `orderedItems`
  // (captured from the cart right before the API call) can legitimately
  // differ from what was actually charged - e.g. if a price changed
  // between adding to cart and checking out. Showing the client's number
  // here would mean showing the customer a total they weren't actually
  // charged. Product images aren't stored server-side, so those still
  // come from the cart snapshot, matched up by productId.
  const serverItems = order?.items;
  const displayItems = order
    ? (serverItems || orderedItems).map((item) => ({
        ...item,
        imageUrl: orderedItems.find((i) => i.productId === item.productId)?.imageUrl,
      }))
    : items;
  const displaySubtotal = order
    ? Number(displayOrder?.total ?? order.total)
    : subtotal;
  const displayItemCount = order
    ? (serverItems || orderedItems).reduce((sum, item) => sum + item.quantity, 0)
    : totalItemCount;

  useEffect(() => {
    if (currentStatus === 'CONFIRMED' && !hasClearedCart) {
      clearCart();
      setHasClearedCart(true);
    }
  }, [currentStatus, hasClearedCart, clearCart]);

  if (items.length === 0 && !order) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 text-[hsl(var(--muted-foreground))]">
          Add something to your cart before checking out.
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-8 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Continue Shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl sm:text-3xl font-semibold mb-8">Checkout</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {user && (
            <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
              <p className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                Ordering as
              </p>
              <p className="text-sm font-medium mt-1">{user.name}</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{user.email}</p>
            </div>
          )}

          <div className="flex flex-col gap-6">
            {displayItems.map((item) => (
              <div key={item.productId} className="flex gap-4 pb-6 border-b border-[hsl(var(--border))]">
                <div className="h-20 w-20 shrink-0 rounded-2xl bg-[hsl(var(--muted))] flex items-center justify-center p-2.5">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-contain" />
                  ) : (
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">No image</div>
                  )}
                </div>
                <div className="flex-1 flex items-center justify-between min-w-0">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium truncate">{item.name}</h3>
                    <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
                      Qty {item.quantity} × ₹{item.price.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <p className="text-sm font-medium shrink-0">
                    ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {order && displayOrder?.timeline && (
            <div className="rounded-2xl border border-[hsl(var(--border))] p-5">
              <OrderTimeline timeline={displayOrder.timeline} />
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-[hsl(var(--border))] p-6 lg:sticky lg:top-20">
            <h2 className="text-lg font-semibold mb-4">Order Summary</h2>
            <div className="flex justify-between text-sm text-[hsl(var(--muted-foreground))]">
              <span>Items ({displayItemCount})</span>
              <span>₹{displaySubtotal.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between text-base font-semibold mt-4 pt-4 border-t border-[hsl(var(--border))]">
              <span>Total</span>
              <span>₹{displaySubtotal.toLocaleString('en-IN')}</span>
            </div>

            {order ? (
              <div className="mt-6 rounded-xl border border-[hsl(var(--border))] p-4 text-center">
                {currentStatus === 'CONFIRMED' && (
                  <CheckCircle2 className="h-6 w-6 mx-auto text-green-600 dark:text-green-400" />
                )}
                {currentStatus === 'CANCELLED' && (
                  <XCircle className="h-6 w-6 mx-auto text-red-600 dark:text-red-400" />
                )}
                {currentStatus === 'PENDING' && (
                  <Package className="h-6 w-6 mx-auto text-[hsl(var(--primary))]" />
                )}

                <p className="text-sm font-medium mt-2">Order #{order.id} placed</p>

                <div className="flex items-center justify-center gap-2 mt-2">
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[currentStatus]}`}>
                    {currentStatus}
                  </span>
                  {isPolling && <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--muted-foreground))]" />}
                </div>

                {currentStatus === 'CANCELLED' && displayOrder?.cancellation_reason && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
                    Reason: {displayOrder.cancellation_reason}
                  </p>
                )}

                {timedOut && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-3">
                    This is taking longer than usual. Check your Orders page for updates.
                  </p>
                )}

                {currentStatus === 'CONFIRMED' && (
                  <div className="flex flex-col gap-2 mt-4">
                    <Link
                      to="/orders"
                      className="w-full rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                      View Orders
                    </Link>
                    <Link
                      to="/"
                      className="w-full rounded-full border border-[hsl(var(--border))] py-2.5 text-sm font-medium hover:bg-[hsl(var(--muted))] transition-colors"
                    >
                      Continue Shopping
                    </Link>
                  </div>
                )}

                {currentStatus === 'CANCELLED' && (
                  <div className="flex flex-col gap-2 mt-4">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      Your items are still in your cart.
                    </p>
                    <button
                      onClick={handleTryAgain}
                      className="w-full rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                      Try Again
                    </button>
                    <Link
                      to="/cart"
                      className="w-full rounded-full border border-[hsl(var(--border))] py-2.5 text-sm font-medium hover:bg-[hsl(var(--muted))] transition-colors"
                    >
                      Back to Cart
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <>
                {error && (
                  <div className="mt-4 flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
                <button
                  onClick={handlePlaceOrder}
                  disabled={isPlacingOrder}
                  className="mt-6 w-full rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] py-3 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isPlacingOrder ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Placing order...
                    </>
                  ) : (
                    'Place Order'
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}