import type { Config } from 'tailwindcss';

// POS design system (project audit 2026-09-15, task "POS design system pass"). Colors are
// CSS variables (defined per-theme in src/styles/globals.css), not fixed hex values, so
// dark mode is a class toggle away instead of a second copy of every screen's classes.
// darkMode: 'class' means .dark on <html> switches every dark: variant at once.
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0F766E',
          dark: '#0B5A54',
          light: '#14B8A6',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)', // primary text
          muted: 'rgb(var(--ink-muted) / <alpha-value>)', // secondary text
        },
      },
      minHeight: {
        touch: '44px', // Apple/Google's minimum recommended touch target
      },
      minWidth: {
        touch: '44px',
      },
      // Beautification pass (2026-09-22): a small, reusable animation vocabulary so screens
      // don't each invent their own transition timing/easing. Used by the sidebar's group
      // expand/collapse, the login page's card entrance, and product-card hover states.
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        fadeInUp: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideDown: { '0%': { opacity: '0', maxHeight: '0' }, '100%': { opacity: '1', maxHeight: '500px' } },
        shimmer: { '0%': { backgroundPosition: '-500px 0' }, '100%': { backgroundPosition: '500px 0' } },
      },
      animation: {
        fadeIn: 'fadeIn 0.4s ease-out',
        fadeInUp: 'fadeInUp 0.45s ease-out',
        slideDown: 'slideDown 0.25s ease-out',
        shimmer: 'shimmer 2s infinite linear',
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--brand-rgb) / 0.15), 0 8px 24px -8px rgb(var(--brand-rgb) / 0.35)',
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 4px 12px -4px rgb(0 0 0 / 0.08)',
        'card-hover': '0 4px 8px rgb(0 0 0 / 0.06), 0 12px 28px -8px rgb(0 0 0 / 0.18)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #0F766E 0%, #115E59 55%, #0B4B46 100%)',
        'brand-gradient-soft': 'linear-gradient(135deg, rgb(var(--brand-rgb) / 0.12) 0%, rgb(var(--brand-rgb) / 0.02) 100%)',
      },
    },
  },
  plugins: [],
};
export default config;
