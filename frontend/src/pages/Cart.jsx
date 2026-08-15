import { Link, useNavigate } from 'react-router-dom';
import { Minus, Plus, X, ShoppingBag } from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';

export default function Cart() {
  const { items, updateQuantity, removeFromCart, subtotal, totalItemCount } = useCart();
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
          <ShoppingBag className="h-7 w-7 text-[hsl(var(--muted-foreground))]" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 text-[hsl(var(--muted-foreground))]">
          Looks like you haven't added anything yet.
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
      <h1 className="text-2xl sm:text-3xl font-semibold mb-8">Shopping Cart</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {items.map((item) => (
            <div key={item.productId} className="flex gap-4 pb-6 border-b border-[hsl(var(--border))]">
              <div className="h-24 w-24 shrink-0 rounded-2xl bg-[hsl(var(--muted))] flex items-center justify-center p-3">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="w-full h-full object-contain" />
                ) : (
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">No image</div>
                )}
              </div>

              <div className="flex-1 flex flex-col justify-between min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium truncate">{item.name}</h3>
                    <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
                      ₹{item.price.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <button
                    onClick={() => removeFromCart(item.productId)}
                    aria-label={`Remove ${item.name}`}
                    className="shrink-0 p-1.5 rounded-full hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <div className="inline-flex items-center rounded-full border border-[hsl(var(--border))]">
                    <button
                      onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                      aria-label="Decrease quantity"
                      className="p-2 hover:bg-[hsl(var(--muted))] rounded-full transition-colors"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                      aria-label="Increase quantity"
                      className="p-2 hover:bg-[hsl(var(--muted))] rounded-full transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-sm font-medium">
                    ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
            </div>
          ))}

          <Link
            to="/"
            className="text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors w-fit"
          >
            ← Continue Shopping
          </Link>
        </div>

        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-[hsl(var(--border))] p-6 lg:sticky lg:top-20">
            <h2 className="text-lg font-semibold mb-4">Order Summary</h2>
            <div className="flex justify-between text-sm text-[hsl(var(--muted-foreground))]">
              <span>Items ({totalItemCount})</span>
              <span>₹{subtotal.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between text-base font-semibold mt-4 pt-4 border-t border-[hsl(var(--border))]">
              <span>Subtotal</span>
              <span>₹{subtotal.toLocaleString('en-IN')}</span>
            </div>
            <button
              onClick={() => navigate('/checkout')}
              className="mt-6 w-full rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] py-3 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Proceed to Checkout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}