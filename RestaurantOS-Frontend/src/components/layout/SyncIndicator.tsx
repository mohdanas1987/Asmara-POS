'use client';

/**
 * POS design system + offline-first foundation (project audit 2026-09-15, extended CTO
 * forensic audit 2026-09-21): a small status dot + label in the TopBar showing whether
 * everything has synced, something is still pending, or a delivery has permanently failed.
 *
 * Two independent sources feed this, and either can be the reason for a non-"synced" state:
 *   1. The SERVER's outbox (GET /sync/status) -- terminal-to-terminal / website deliveries
 *      still in flight or given up on, unrelated to whether THIS browser is online.
 *   2. THIS browser's own local offline queue (lib/offline/outbox.ts, via useOnlineStatus)
 *      -- actions queued here because this specific device lost its connection; these can't
 *      be seen by polling the server at all while offline, which is exactly why they need
 *      their own, client-side status.
 * Being actually offline (this device) takes priority in what's shown, since it's the more
 * actionable/urgent state for whoever's looking at this indicator on THIS terminal.
 */
import { useEffect, useState } from 'react';
import { getSyncStatus } from '@/lib/api';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';

type SyncState = 'offline' | 'synced' | 'pending' | 'failed' | 'unknown';

const POLL_INTERVAL_MS = 30_000;

export function SyncIndicator() {
  const { online, queuedCount, flushing } = useOnlineStatus();
  const [serverState, setServerState] = useState<Exclude<SyncState, 'offline'>>('unknown');
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
        setServerState(failed > 0 ? 'failed' : pending > 0 ? 'pending' : 'synced');
      } catch {
        // A failed status check itself just means "we don't know" -- it must never crash
        // the TopBar or block the rest of the app from rendering. Also the expected outcome
        // while this device itself is offline (the request can't even reach the server) --
        // `online` below is what actually drives the indicator in that case.
        if (!cancelled) setServerState('unknown');
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const state: SyncState = !online || queuedCount > 0 ? 'offline' : serverState;

  const config: Record<SyncState, { color: string; label: string }> = {
    offline: {
      color: online ? 'bg-amber-500' : 'bg-red-500',
      label: online
        ? flushing
          ? `Syncing offline queue (${queuedCount})...`
          : `${queuedCount} queued locally -- will sync automatically`
        : queuedCount > 0
        ? `Offline -- ${queuedCount} queued`
        : 'Offline',
    },
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
