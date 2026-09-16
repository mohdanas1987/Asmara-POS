'use client';

/**
 * POS design system (project audit 2026-09-15, task "POS design system pass"): a shared
 * top bar with the controls that belong on every dashboard screen (fullscreen, theme,
 * sync status) instead of each screen deciding whether to include them. `title` is the one
 * per-screen thing -- everything else is identical everywhere it's used.
 */
import { useTheme } from '@/lib/theme/ThemeProvider';
import { useFullscreen } from '@/lib/hooks/useFullscreen';
import { SyncIndicator } from './SyncIndicator';
import { Button } from '@/components/ui/Button';

export function TopBar({ title }: { title: string }) {
  const { theme, toggleTheme } = useTheme();
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      <div className="flex items-center gap-2">
        <SyncIndicator />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="touch-target"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="touch-target"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? '⤡' : '⤢'}
        </Button>
      </div>
    </header>
  );
}
