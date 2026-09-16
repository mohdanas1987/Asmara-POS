'use client';

/**
 * Table/Floor management redesign (project audit 2026-09-15): drives each occupied table's
 * "seated Nm ago" label. Re-renders on an interval rather than computing once, since a
 * table that's been sitting on screen for 20 minutes needs its displayed time to keep
 * moving without a manual refresh.
 */
import { useEffect, useState } from 'react';

const TICK_MS = 30_000;

export function useElapsedMinutes(since?: string | null): number | null {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!since) return undefined;
    const interval = setInterval(() => forceTick((n) => n + 1), TICK_MS);
    return () => clearInterval(interval);
  }, [since]);

  if (!since) return null;
  const startedAt = new Date(since).getTime();
  if (Number.isNaN(startedAt)) return null;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
}
