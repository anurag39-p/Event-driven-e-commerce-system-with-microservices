import { useSearchParams } from 'react-router-dom';
import Hero from '../components/Hero.jsx';
import CategoryTabs from '../components/CategoryTabs.jsx';
import ProductGrid from '../components/ProductGrid.jsx';

export default function Home() {
  const [searchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const category = searchParams.get('category') || 'all';

  return (
    <div>
      <Hero />
      <CategoryTabs />
      <ProductGrid search={search} category={category} />
    </div>
  );
}