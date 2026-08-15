import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import ProductCard from './ProductCard.jsx';

async function fetchProducts() {
  const res = await api.get('/products');
  return res.data.products;
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-square rounded-2xl bg-[hsl(var(--muted))] animate-pulse" />
          <div className="mt-3 h-4 w-3/4 rounded bg-[hsl(var(--muted))] animate-pulse" />
          <div className="mt-2 h-4 w-1/3 rounded bg-[hsl(var(--muted))] animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export default function ProductGrid({ search = '', category = 'all' }) {
  const { data: products, isLoading, isError, refetch } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <SkeletonGrid />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 text-center">
        <p className="text-[hsl(var(--muted-foreground))]">
          Something went wrong loading products.
        </p>
        <button
          onClick={() => refetch()}
          className="mt-4 text-sm font-medium px-5 py-2 rounded-full border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = (products || []).filter((p) => {
    const matchesCategory = category === 'all' || !category || p.category === category;
    const matchesSearch =
      !normalizedSearch ||
      p.name.toLowerCase().includes(normalizedSearch) ||
      (p.description || '').toLowerCase().includes(normalizedSearch);
    return matchesCategory && matchesSearch;
  });

  if (filtered.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 text-center">
        <p className="text-[hsl(var(--muted-foreground))]">
          No products found{normalizedSearch ? ` for "${search}"` : ''}.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
        {filtered.map((product) => (
          <ProductCard key={product._id} product={product} />
        ))}
      </div>
    </div>
  );
}