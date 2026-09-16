'use client';

/**
 * POS design system (project audit 2026-09-15, task "POS design system pass").
 *
 * A single source of truth for light/dark theme, so every screen reads it the same way
 * instead of each page inventing its own dark-mode toggle (or, as before this pass, no
 * screen having one at all). Persisted to localStorage so a terminal remembers its chosen
 * theme across restarts -- most restaurants will pick one and leave it, since the POS runs
 * on a fixed terminal, not a personal device with its own OS-level preference that changes.
 */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'restaurantos-theme';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage can throw in some embedded/kiosk browser contexts -- fall through to the
    // system preference rather than crashing the whole app over a theme preference.
  }
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');

  // Read the real initial theme only after mount, so server-rendered HTML and the first
  // client render match (avoids a hydration mismatch warning from guessing at render time).
  useEffect(() => {
    setThemeState(getInitialTheme());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Best-effort persistence only -- the theme still applies for this session even if it
      // can't be remembered for the next one.
    }
  }, [theme]);

  const setTheme = (next: Theme) => setThemeState(next);
  const toggleTheme = () => setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
