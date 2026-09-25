import type { Config } from 'tailwindcss';

// POS design system (project audit 2026-09-15, task "POS design system pass").
// "Aura Glass" re-theme (this pass): every color below is still a CSS variable defined
// per-theme in src/styles/globals.css, not a fixed hex value -- so this reskin only ever
// touched two files (this one + globals.css) instead of every screen's Tailwind classes.
// Light mode is left pixel-for-pixel unchanged; dark mode now IS the Aura Glass look
// (OLED-deep canvas, glass surfaces, flame-amber accent) via the SAME `.dark` class every
// screen already reads through `bg-surface`/`text-ink`/`bg-brand`/etc.
// darkMode: 'class' means .dark on <html> switches every dark: variant at once.
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // 'Plus Jakarta Sans Variable' is what @fontsource-variable/plus-jakarta-sans
        // declares (imported once in layout.tsx) -- real fallbacks after it, never a bare
        // custom name with nothing behind it if the font file somehow fails to load.
        sans: ['"Plus Jakarta Sans Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--brand-rgb) / <alpha-value>)',
          dark: 'rgb(var(--brand-dark-rgb) / <alpha-value>)',
          light: 'rgb(var(--brand-light-rgb) / <alpha-value>)',
        },
        // The page's own background, deliberately distinct from `surface` (card/panel
        // level) -- in light mode the two are identical (no visual change), in dark mode
        // `canvas` is the deep OLED charcoal every glass surface sits on top of.
        canvas: {
          DEFAULT: 'rgb(var(--canvas) / <alpha-value>)',
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
        // Var-based (not fixed hex) so this gradient is teal in light mode and flame-amber
        // in dark mode automatically -- same reasoning as every other token here.
        'brand-gradient': 'linear-gradient(135deg, rgb(var(--brand-rgb)) 0%, rgb(var(--brand-dark-rgb)) 55%, rgb(var(--brand-deep-rgb)) 100%)',
        'brand-gradient-soft': 'linear-gradient(135deg, rgb(var(--brand-rgb) / 0.12) 0%, rgb(var(--brand-rgb) / 0.02) 100%)',
      },
    },
  },
  plugins: [],
};
export default config;
