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
    },
  },
  plugins: [],
};
export default config;
