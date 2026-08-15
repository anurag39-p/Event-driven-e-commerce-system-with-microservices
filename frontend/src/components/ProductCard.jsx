import { useState } from 'react';
import { Check } from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';

export default function ProductCard({ product }) {
  const { addToCart } = useCart();
  const [isAdding, setIsAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  function handleAddToCart() {
    if (isAdding) return;
    setIsAdding(true);
    addToCart(product);
    setJustAdded(true);

    setTimeout(() => {
      setIsAdding(false);
      setJustAdded(false);
    }, 1200);
  }

  return (
    <div className="group">
      <div className="aspect-square rounded-2xl bg-[hsl(var(--muted))] overflow-hidden flex items-center justify-center p-6">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-contain transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="text-[hsl(var(--muted-foreground))] text-sm">No image</div>
        )}
      </div>

      <div className="mt-3">
        <h3 className="text-sm font-medium truncate">{product.name}</h3>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
          ₹{product.price.toLocaleString('en-IN')}
        </p>

        <button
          type="button"
          onClick={handleAddToCart}
          disabled={isAdding}
          className="mt-3 w-full text-sm font-medium py-2 rounded-full border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-70 flex items-center justify-center gap-1.5"
        >
          {justAdded ? (
            <>
              <Check className="h-4 w-4" />
              Added
            </>
          ) : (
            'Add to Cart'
          )}
        </button>
      </div>
    </div>
  );
}