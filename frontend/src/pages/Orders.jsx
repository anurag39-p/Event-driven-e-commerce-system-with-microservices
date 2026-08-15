import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown, Package } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

const STATUS_STYLES = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  CONFIRMED: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function OrderRow({ order }) {
  const [expanded, setExpanded] = useState(false);
  const itemCount = order.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-4 p-4 text-left"
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="h-10 w-10 shrink-0 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
            <Package className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">Order #{order.id}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {formatDate(order.created_at)} · {itemCount} item{itemCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[order.status] || ''}`}>
            {order.status}
          </span>
          <p className="text-sm font-semibold hidden sm:block">
            ₹{Number(order.total).toLocaleString('en-IN')}
          </p>
          <ChevronDown className={`h-4 w-4 text-[hsl(var(--muted-foreground))] transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[hsl(var(--border))] p-4 flex flex-col gap-3">
          <p className="text-sm font-semibold sm:hidden">
            Total: ₹{Number(order.total).toLocaleString('en-IN')}
          </p>
          {order.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-[hsl(var(--muted-foreground))]">
                Qty {item.quantity} × ₹{Number(item.price).toLocaleString('en-IN')}
              </span>
              <span className="font-medium">
                ₹{(item.price * item.quantity).toLocaleString('en-IN')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-16 rounded-2xl bg-[hsl(var(--muted))] animate-pulse" />
      ))}
    </div>
  );
}

export default function Orders() {
  const { user } = useAuth();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['orders', user?.id],
    queryFn: async () => {
      const res = await api.get('/orders', { params: { userId: user.id } });
      return res.data.orders;
    },
    enabled: !!user?.id,
  });

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">Sign in to view your orders</h1>
        <Link
          to="/login"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-8 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Login
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl sm:text-3xl font-semibold mb-8">Your Orders</h1>

      {isLoading && <SkeletonList />}

      {isError && (
        <div className="text-center py-16">
          <p className="text-[hsl(var(--muted-foreground))]">Something went wrong loading your orders.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 text-sm font-medium px-5 py-2 rounded-full border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {!isLoading && !isError && (!data || data.length === 0) && (
        <div className="text-center py-16">
          <p className="text-[hsl(var(--muted-foreground))]">You haven't placed any orders yet.</p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-8 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Start Shopping
          </Link>
        </div>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <div className="flex flex-col gap-4">
          {data.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}