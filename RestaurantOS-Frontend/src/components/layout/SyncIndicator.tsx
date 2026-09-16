'use client';

/**
 * POS design system + offline-first foundation (project audit 2026-09-15): a small status
 * dot + label in the TopBar showing whether everything has synced, something is still
 * pending (normal during a brief network blip), or a delivery has permanently failed and
 * needs attention. Polls GET /sync/status rather than pushing over the socket -- this is
 * background housekeeping information, not something that needs sub-second latency.
 */
import { useEffect, useState } from 'react';
import { getSyncStatus } from '@/lib/api';

type SyncState = 'synced' | 'pending' | 'failed' | 'unknown';

const POLL_INTERVAL_MS = 30_000;

export function SyncIndicator() {
  const [state, setState] = useState<SyncState>('unknown');
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await getSyncStatus();
        if (cancelled) return;
        const pending = res.outbox.filter((r) => r.status === 'pending').reduce((sum, r) => sum + Number(r.count), 0);
        const failed = res.outbox.filter((r) => r.status === 'failed').reduce((sum, r) => sum + Number(r.count), 0);
        setPendingCount(pending);
        setFailedCount(failed);
        setState(failed > 0 ? 'failed' : pending > 0 ? 'pending' : 'synced');
      } catch {
        // A failed status check itself just means "we don't know" -- it must never crash
        // the TopBar or block the rest of the app from rendering.
        if (!cancelled) setState('unknown');
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const config: Record<SyncState, { color: string; label: string }> = {
    synced: { color: 'bg-emerald-500', label: 'Synced' },
    pending: { color: 'bg-amber-500', label: `Syncing (${pendingCount})` },
    failed: { color: 'bg-red-500', label: `Sync issue (${failedCount})` },
    unknown: { color: 'bg-ink-muted', label: 'Sync status unknown' },
  };
  const { color, label } = config[state];

  return (
    <div className="flex items-center gap-2 rounded-full bg-surface-sunken px-3 py-1.5 text-xs font-medium text-ink-muted" title={label}>
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
