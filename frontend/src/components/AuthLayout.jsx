import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle.jsx';

export default function AuthLayout({ title, subtitle, footerText, footerLinkText, footerLinkTo, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--muted))] p-4">
      <div className="fixed top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-5xl bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] rounded-3xl shadow-xl overflow-hidden flex flex-col md:flex-row">
        <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col">
          <div className="inline-flex items-center self-start border border-[hsl(var(--border))] rounded-full px-4 py-1.5 text-sm font-medium mb-12">
            EventCommerce
          </div>

          <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
            <h1 className="text-3xl font-semibold mb-1">{title}</h1>
            <p className="text-[hsl(var(--muted-foreground))] mb-8">{subtitle}</p>
            {children}
          </div>

          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-8 text-center">
            {footerText}{' '}
            <Link to={footerLinkTo} className="underline font-medium text-[hsl(var(--foreground))]">
              {footerLinkText}
            </Link>
          </p>
        </div>

        <div className="hidden md:block md:w-1/2 relative bg-gradient-to-br from-amber-200 via-orange-200 to-amber-100">
          { <img src="login_register.jpg" className="absolute inset-0 w-full h-full object-cover" alt="" /> }
        </div>
      </div>
    </div>
  );
}