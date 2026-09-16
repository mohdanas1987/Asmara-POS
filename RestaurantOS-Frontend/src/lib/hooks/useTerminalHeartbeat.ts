'use client';

/**
 * Offline sync: wire frontend to the existing backend engine (task #47). The backend has
 * tracked terminals (POST /sync/terminals/register, GET /sync/terminals) and accepted an
 * optional `terminal_id` on sync-log-recorded writes (e.g. routes/tables.js's /transfer)
 * since the offline-first foundation was built (task #32) -- nothing in the frontend has ever
 * called the register endpoint, so the terminals list has always been empty and every synced
 * change has been stamped 'unknown-terminal'.
 *
 * This just registers this browser as a terminal once on mount and again on a slow heartbeat,
 * using the stable per-browser id from lib/terminal.ts. It never blocks or surfaces errors --
 * a missed heartbeat just means the terminals list is briefly stale, never something that
 * should interrupt POS work. (The already-existing SyncIndicator/TopBar is the separate,
 * already-wired piece that shows sync status; this hook only handles registration.)
 */
import { useEffect } from 'react';
import { getTerminalId } from '@/lib/terminal';
import { registerTerminal } from '@/lib/api';

const HEARTBEAT_MS = 5 * 60 * 1000; // 5 minutes

export function useTerminalHeartbeat() {
  useEffect(() => {
    const terminalId = getTerminalId();

    async function heartbeat() {
      try {
        await registerTerminal(terminalId, typeof navigator !== 'undefined' ? navigator.platform : undefined);
      } catch {
        // Best-effort only -- see file comment above.
      }
    }

    heartbeat();
    const timer = setInterval(heartbeat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, []);
}
