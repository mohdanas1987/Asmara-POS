'use client';

/**
 * SaaS design pass (2026-09-25, "Principal Frontend Architect" spec): a dedicated production
 * register/status header for the POS screen, separate from the generic dashboard `TopBar`
 * (which every screen shares) -- this one is POS-specific chrome: which register/cashier this
 * terminal is running as, how long the shift has been open, and the two hardware-adjacent
 * quick actions (lock, drawer kick) a cashier reaches for constantly during service.
 *
 * Deliberately built on top of REAL state, not invented data:
 *   - Register id / opening time come from `useRegisterSession()` (src/lib/hooks/
 *     useRegisterSession.ts), the same hook OpenRegisterModal already uses -- there is no
 *     separate "session" concept invented here.
 *   - The network/sync badge reuses the existing `SyncIndicator` component verbatim (same
 *     two data sources: the local offline outbox via `useOnlineStatus`, and the server's
 *     GET /sync/status) instead of re-deriving a second, possibly-inconsistent state machine.
 *   - The offline outbox counter is `useOnlineStatus().queuedCount` -- the exact number
 *     SyncIndicator itself reads, surfaced here as its own compact numeric badge per the
 *     spec's "Offline Outbox Queue Counter badge" item (SyncIndicator's own label already
 *     mentions the count in prose; this is the same number, shown as a standalone chip).
 *   - Drawer Kick calls `openCashDrawer()` (src/lib/printing.ts, added alongside this
 *     component) -- a REAL ESC/POS "pulse the drawer pin" command sent through the existing
 *     desktop bridge, not a UI-only stub. If no desktop bridge or no receipt printer is
 *     configured (e.g. this is the browser-preview build, or Settings > Printers was never
 *     set up), the button says so via a toast instead of silently pretending to work.
 *   - Pin Lock reuses the existing `SwitchUserModal` (the same PIN/QR "switch user" flow
 *     TopBar already exposes) -- "lock this terminal" and "switch to another staff member"
 *     are the same real flow from the backend's point of view (both end at PIN/QR auth), so
 *     this doesn't invent a second, parallel "lock screen" auth path.
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { SyncIndicator } from '@/components/layout/SyncIndicator';
import { SwitchUserModal } from '@/components/auth/SwitchUserModal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';
import { useRegisterSession } from '@/lib/hooks/useRegisterSession';
import { openCashDrawer } from '@/lib/printing';
import { getCurrentRole } from '@/lib/auth';

function formatShiftDuration(openedAtIso: string | undefined | null, now: Date | null): string {
  if (!openedAtIso || !now) return '--:--';
  const opened = new Date(openedAtIso).getTime();
  if (Number.isNaN(opened)) return '--:--';
  const ms = Math.max(0, now.getTime() - opened);
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function useClock(intervalMs: number) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function PosHeader({ cashierName }: { cashierName?: string }) {
  const { session, state: registerState } = useRegisterSession();
  const { queuedCount } = useOnlineStatus();
  const now = useClock(30_000);
  const [switchingUser, setSwitchingUser] = useState(false);
  const [kicking, setKicking] = useState(false);
  const toast = useToast();

  const role = getCurrentRole();
  const displayName = cashierName || (role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Staff');

  async function handleDrawerKick() {
    setKicking(true);
    try {
      const result = await openCashDrawer();
      if (result === 'kicked') {
        toast.showToast('Drawer kick sent.', 'success');
      } else if (result === 'no-printer-configured') {
        toast.showToast('No receipt printer configured (Settings → Printers) -- the drawer is normally wired through it.', 'error');
      } else {
        toast.showToast('No hardware bridge available (browser preview) -- drawer kick needs the desktop app.', 'error');
      }
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : 'Drawer kick failed.', 'error');
    } finally {
      setKicking(false);
    }
  }

  return (
    <>
      {switchingUser && <SwitchUserModal onClose={() => setSwitchingUser(false)} />}
      <header
        className="relative flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-xl border border-white/[0.03] bg-surface px-4 py-3 shadow-card"
        aria-label="Register status"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-brand-gradient" />

        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">Register</span>
            <span className="flex items-center gap-1.5 font-semibold tabular-nums text-ink">
              {session ? `#${session.id || 'offline'}` : '—'}
              {/* Offline-first register-session requirement (2026-09-26): visible, honest
                  status when this session is running on local truth alone -- never hides
                  that the backend is unreachable, but never blocks the cashier either. */}
              {registerState === 'ACTIVE_OFFLINE' && (
                <span
                  className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold normal-case tabular-nums text-amber-500"
                  title="Backend unreachable -- this register session keeps working locally and will sync automatically."
                >
                  OFFLINE
                </span>
              )}
              {registerState === 'SYNCING' && (
                <span
                  className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold normal-case tabular-nums text-brand"
                  title="Syncing this register session with the server."
                >
                  SYNCING
                </span>
              )}
            </span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">Cashier</span>
            <span className="truncate font-semibold text-ink">{displayName}</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">Shift</span>
            <span className="font-semibold tabular-nums text-ink">
              {session ? formatShiftDuration(session.date, now) : '—'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SyncIndicator />

          {/* Offline outbox counter (spec: its own badge, distinct from SyncIndicator's
              prose label above) -- only rendered once there's actually something queued, so
              a fully-synced terminal doesn't show a permanent "0" chip. */}
          {queuedCount > 0 && (
            <span
              className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-xs font-bold tabular-nums text-amber-500"
              title={`${queuedCount} action(s) queued locally`}
              aria-label={`${queuedCount} queued offline actions`}
            >
              {queuedCount}
            </span>
          )}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="touch-target"
            onClick={handleDrawerKick}
            disabled={kicking}
            aria-label="Kick cash drawer"
            title="Open the cash drawer"
          >
            {kicking ? '⏳' : '💵'}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={clsx('touch-target')}
            onClick={() => setSwitchingUser(true)}
            aria-label="Lock terminal / switch staff"
            title="Lock this terminal (PIN or QR badge to unlock)"
          >
            {'🔒'}
          </Button>
        </div>
      </header>
    </>
  );
}
