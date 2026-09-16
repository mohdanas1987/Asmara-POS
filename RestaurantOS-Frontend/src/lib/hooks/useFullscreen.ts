'use client';

/**
 * POS design system (project audit 2026-09-15, task "POS design system pass"): a shared
 * fullscreen toggle. A restaurant POS running as a browser tab (rather than the packaged
 * Electron shell) benefits from hiding the browser chrome entirely during service --
 * one hook, used the same way from any screen's TopBar, instead of each screen wiring the
 * Fullscreen API itself.
 */
import { useCallback, useEffect, useState } from 'react';

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function handleChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {
        // Some embedded/kiosk contexts (and Electron with certain settings) refuse the
        // Fullscreen API entirely -- fail silently rather than showing an error for a
        // cosmetic feature.
      });
    }
  }, []);

  return { isFullscreen, toggleFullscreen };
}
