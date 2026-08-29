import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Hero from '../components/Hero.jsx';
import CategoryTabs from '../components/CategoryTabs.jsx';
import ProductGrid from '../components/ProductGrid.jsx';

export default function Home() {
  const [searchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const category = searchParams.get('category') || 'all';

  useEffect(() => {
    if (category !== 'all' || search) {
      document.getElementById('products-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [category, search]);

  return (
    <div>
      <Hero />
      <CategoryTabs />
      <section id="products-section">
        <ProductGrid search={search} category={category} />
      </section>
    </div>
  );
}