import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export default function Hero() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 md:py-28">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-8 items-center">
        <div className="text-center md:text-left">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
            Discover Premium
            <br />
            Electronics
          </h1>
          <p className="mt-5 text-lg text-[hsl(var(--muted-foreground))] max-w-md mx-auto md:mx-0">
            Curated phones, laptops, audio and more — built for people who care about quality.
          </p>
          <Link
            to="/products"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-8 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Shop Now
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="relative w-full max-w-md mx-auto md:max-w-none">
          <svg viewBox="0 0 560 560" className="w-full h-auto" role="img" aria-label="Illustration of a laptop, smartphone, headphones and smartwatch">
            <defs>
              <radialGradient id="heroGlow" cx="50%" cy="45%" r="60%">
                <stop offset="0%" stopColor="hsl(24, 90%, 60%)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="hsl(24, 90%, 60%)" stopOpacity="0" />
              </radialGradient>
            </defs>

            <circle cx="280" cy="270" r="230" fill="url(#heroGlow)" />

            <g transform="translate(60,230) rotate(-4)">
              <rect x="0" y="0" width="260" height="165" rx="14" fill="#64748b" opacity="0.9" />
              <rect x="14" y="14" width="232" height="137" rx="6" fill="#0f172a" />
              <path d="M-15 165 L275 165 L295 200 L-35 200 Z" fill="#475569" />
            </g>

            <g transform="translate(360,60)">
              <path d="M20 90 V60 a60 60 0 0 1 120 0 V90" fill="none" stroke="hsl(24, 90%, 55%)" strokeWidth="10" strokeLinecap="round" />
              <rect x="4" y="80" width="34" height="60" rx="16" fill="hsl(24, 90%, 55%)" />
              <rect x="122" y="80" width="34" height="60" rx="16" fill="hsl(24, 90%, 55%)" />
            </g>

            <g transform="translate(300,180)">
              <rect x="0" y="0" width="130" height="260" rx="24" fill="#1e293b" />
              <rect x="8" y="8" width="114" height="244" rx="18" fill="#e2e8f0" />
              <rect x="45" y="18" width="40" height="6" rx="3" fill="#1e293b" opacity="0.6" />
              <circle cx="65" cy="230" r="10" fill="#1e293b" opacity="0.3" />
            </g>

            <g transform="translate(410,340)">
              <rect x="-6" y="10" width="20" height="90" rx="8" fill="#334155" />
              <rect x="66" y="10" width="20" height="90" rx="8" fill="#334155" />
              <rect x="0" y="0" width="80" height="110" rx="20" fill="#0f172a" />
              <rect x="12" y="14" width="56" height="82" rx="12" fill="hsl(24, 90%, 55%)" opacity="0.9" />
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}