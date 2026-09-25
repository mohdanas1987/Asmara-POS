'use client';

/**
 * POS design system (project audit 2026-09-15, task "POS design system pass"): a shared
 * top bar with the controls that belong on every dashboard screen (fullscreen, theme,
 * sync status) instead of each screen deciding whether to include them. `title` is the one
 * per-screen thing -- everything else is identical everywhere it's used.
 */
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { useFullscreen } from '@/lib/hooks/useFullscreen';
import { SyncIndicator } from './SyncIndicator';
import { Button } from '@/components/ui/Button';
import { SwitchUserModal } from '@/components/auth/SwitchUserModal';

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function TopBar({ title }: { title: string }) {
  const { theme, toggleTheme } = useTheme();
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  // Staff quick-login (CTO forensic audit 2026-09-20): available from every dashboard
  // screen, not just the POS, since a shift change can happen anywhere in the app.
  const [switchingUser, setSwitchingUser] = useState(false);
  const now = useClock();

  return (
    <>
    {switchingUser && <SwitchUserModal onClose={() => setSwitchingUser(false)} />}
    <header className="relative flex items-center justify-between overflow-hidden border-b border-border bg-surface/75 backdrop-blur-xl px-4 py-3 shadow-card">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-brand-gradient" />
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {now && (
          <span className="hidden text-xs font-medium text-ink-muted sm:inline">
            {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            {' · '}
            {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <SyncIndicator />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="touch-target transition-transform hover:scale-105"
          onClick={() => setSwitchingUser(true)}
          aria-label="Switch user"
          title="Switch user (PIN or QR badge)"
        >
          🔄👤
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="touch-target transition-transform hover:scale-105"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="touch-target transition-transform hover:scale-105"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? '⤡' : '⤢'}
        </Button>
      </div>
    </header>
    </>
  );
}
