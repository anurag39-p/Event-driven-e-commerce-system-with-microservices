import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShoppingBag, Menu, X, User, Package } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const CATEGORIES = [
  { label: 'Phones', slug: 'phones' },
  { label: 'Laptops', slug: 'laptops' },
  { label: 'Audio', slug: 'audio' },
  { label: 'Gaming', slug: 'gaming' },
  { label: 'Accessories', slug: 'accessories' },
  { label: 'Tablets', slug: 'tablets' },
];

const CART_COUNT_PLACEHOLDER = 0;

export default function Navbar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();

  function handleSearchSubmit(e) {
    e.preventDefault();
    if (searchValue.trim()) {
      navigate(`/products?search=${encodeURIComponent(searchValue.trim())}`);
    }
    setSearchOpen(false);
    setSearchValue('');
  }

  function handleLogout() {
    logout();
    setMobileMenuOpen(false);
    navigate('/');
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-[hsl(var(--card))]/90 backdrop-blur border-b border-[hsl(var(--border))]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="h-14 flex items-center justify-between gap-4">
            <Link to="/" className="font-semibold text-sm tracking-tight shrink-0">
              EventCommerce
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-sm text-[hsl(var(--muted-foreground))]">
              {CATEGORIES.map((cat) => (
                <Link
                  key={cat.slug}
                  to={`/products?category=${cat.slug}`}
                  className="hover:text-[hsl(var(--foreground))] transition-colors"
                >
                  {cat.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={() => setSearchOpen((s) => !s)}
                aria-label="Search"
                className="p-2 rounded-full hover:bg-[hsl(var(--muted))] transition-colors"
              >
                <Search className="h-[18px] w-[18px]" />
              </button>

              <Link
                to="/orders"
                aria-label="Orders"
                className="hidden md:inline-flex p-2 rounded-full hover:bg-[hsl(var(--muted))] transition-colors"
              >
                <Package className="h-[18px] w-[18px]" />
              </Link>

              <Link
                to="/cart"
                aria-label="Cart"
                className="relative p-2 rounded-full hover:bg-[hsl(var(--muted))] transition-colors"
              >
                <ShoppingBag className="h-[18px] w-[18px]" />
                {CART_COUNT_PLACEHOLDER > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-[10px] flex items-center justify-center">
                    {CART_COUNT_PLACEHOLDER}
                  </span>
                )}
              </Link>

              <div className="hidden md:flex items-center gap-1">
                {isAuthenticated ? (
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full hover:bg-[hsl(var(--muted))] transition-colors"
                  >
                    <User className="h-4 w-4" />
                    {user?.name?.split(' ')[0] || 'Account'}
                  </button>
                ) : (
                  <Link
                    to="/login"
                    className="text-sm px-3 py-1.5 rounded-full hover:bg-[hsl(var(--muted))] transition-colors"
                  >
                    Login
                  </Link>
                )}
                <ThemeToggle />
              </div>

              <button
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open menu"
                className="md:hidden p-2 rounded-full hover:bg-[hsl(var(--muted))] transition-colors"
              >
                <Menu className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>

          {searchOpen && (
            <div className="pb-3">
              <form onSubmit={handleSearchSubmit} className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                <input
                  autoFocus
                  type="text"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder="Search products..."
                  className="w-full h-10 pl-10 pr-10 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]"
                />
                <button
                  type="button"
                  onClick={() => setSearchOpen(false)}
                  aria-label="Close search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-[hsl(var(--muted))]"
                >
                  <X className="h-4 w-4" />
                </button>
              </form>
            </div>
          )}
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute top-0 right-0 h-full w-72 bg-[hsl(var(--card))] shadow-xl p-6 flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <span className="font-semibold text-sm">Menu</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
                className="p-2 rounded-full hover:bg-[hsl(var(--muted))]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-col gap-1">
              {CATEGORIES.map((cat) => (
                <Link
                  key={cat.slug}
                  to={`/products?category=${cat.slug}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="py-2.5 text-sm border-b border-[hsl(var(--border))]"
                >
                  {cat.label}
                </Link>
              ))}
              <Link
                to="/orders"
                onClick={() => setMobileMenuOpen(false)}
                className="py-2.5 text-sm border-b border-[hsl(var(--border))]"
              >
                Orders
              </Link>
            </nav>

            <div className="mt-auto flex items-center justify-between pt-6">
              {isAuthenticated ? (
                <button onClick={handleLogout} className="text-sm font-medium">
                  Logout ({user?.name?.split(' ')[0] || 'Account'})
                </button>
              ) : (
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-sm font-medium"
                >
                  Login
                </Link>
              )}
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
    </>
  );
}