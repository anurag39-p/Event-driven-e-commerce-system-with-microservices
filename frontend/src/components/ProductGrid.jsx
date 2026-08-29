import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import ProductCard from './ProductCard.jsx';

async function fetchProducts() {
  const res = await api.get('/products');
  return res.data.products;
}

const CATEGORY_SYNONYMS = {
  mobile: 'phones',
  phone: 'phones',
  phones: 'phones',
  smartphone: 'phones',
  smartphones: 'phones',
  laptop: 'laptops',
  laptops: 'laptops',
  notebook: 'laptops',
  notebooks: 'laptops',
  tablet: 'tablets',
  tablets: 'tablets',
  tab: 'tablets',
  tabs: 'tablets',
  headphone: 'audio',
  headphones: 'audio',
  earbud: 'audio',
  earbuds: 'audio',
  gaming: 'gaming',
  game: 'gaming',
  games: 'gaming',
};

function matchesSearch(product, normalizedSearch) {
  if (!normalizedSearch) return true;

  if (product.name.toLowerCase().includes(normalizedSearch)) return true;
  if ((product.description || '').toLowerCase().includes(normalizedSearch)) return true;
  if (product.category.toLowerCase().includes(normalizedSearch)) return true;

  const synonymCategory = CATEGORY_SYNONYMS[normalizedSearch];
  if (synonymCategory && product.category === synonymCategory) return true;

  return false;
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
    return matchesCategory && matchesSearch(p, normalizedSearch);
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