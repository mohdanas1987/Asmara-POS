'use client';

/**
 * Offline-first register-session state machine (production-critical requirement, 2026-09-26:
 * "Asmara POS -- Offline-First Session & Connectivity Requirement", item 3). Exactly:
 *
 *     NO_SESSION -> ACTIVE -> ACTIVE_OFFLINE -> SYNCING -> ACTIVE
 *
 * and explicitly NEVER `ACTIVE -> BACKEND_UNAVAILABLE -> NO_SESSION` -- a fetch failure must
 * never be treated as "no session exists". The durable local record in
 * lib/offline/registerSession.ts (an IndexedDB singleton) is the ONLY source of truth for
 * whether a session exists at all; a live `/pos/last-active-session` call is used only to (a)
 * bootstrap a local record when none exists yet but the server already has one for this
 * login, and (b) confirm/reconcile an existing local record once connectivity is available.
 * It is NEVER used to clear or downgrade a local record that already says a session is open
 * -- see refresh() below for exactly where that boundary is enforced.
 */
import { useCallback, useEffect, useState } from 'react';
import { getLastActiveSession, openRegister } from '@/lib/api';
import { CashRegisterSession } from '@/lib/types';
import { getCurrentUser } from '@/lib/auth';
import { getTerminalId } from '@/lib/terminal';
import { isNetworkError } from '@/lib/offline/network';
import { enqueueAction } from '@/lib/offline/outbox';
import {
  RegisterSessionRecord,
  RegisterSessionStatus,
  getLocalRegisterSession,
  openLocalRegisterSessionOffline,
  saveConfirmedRegisterSession,
  adoptServerRegisterSession,
  markLocalRegisterSessionReconciled,
  markLocalRegisterSessionUnreachable,
} from '@/lib/offline/registerSession';

export type RegisterSessionState = 'NO_SESSION' | RegisterSessionStatus;

function toDisplaySession(record: RegisterSessionRecord): CashRegisterSession {
  // Kept shaped exactly like the server's CashRegisterSession (PosHeader / OpenRegisterModal
  // already read `.id` and `.date` off this) so nothing downstream needs to know whether the
  // session it's looking at is server-confirmed or still offline-pending.
  return {
    id: record.serverSessionId ?? 0,
    status: true,
    opening_cash: record.openingCash,
    closing_cash: record.openingCash,
    date: record.openedAt,
  };
}

export function useRegisterSession() {
  const [session, setSession] = useState<CashRegisterSession | null>(null);
  const [state, setState] = useState<RegisterSessionState>('NO_SESSION');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyLocal = useCallback((record: RegisterSessionRecord | null) => {
    if (record) {
      setSession(toDisplaySession(record));
      setState(record.status);
    } else {
      setSession(null);
      setState('NO_SESSION');
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    // Local truth first, unconditionally -- this alone is enough to answer "is the register
    // open" correctly even if the network call below never completes at all.
    const local = await getLocalRegisterSession();
    applyLocal(local);

    try {
      const res = await getLastActiveSession();
      const serverSession = res.session && res.session.status ? res.session : null;

      if (local) {
        if (serverSession && local.serverSessionId === serverSession.id) {
          // Reachable and confirmed -- if we'd previously marked this offline/unconfirmed,
          // this is the ACTIVE_OFFLINE -> ACTIVE reconciliation step.
          await markLocalRegisterSessionReconciled(local.sessionId);
          applyLocal(await getLocalRegisterSession());
        }
        // If `local.serverSessionId` is null (opened offline, not yet synced) or doesn't
        // match this particular row, we deliberately do nothing here -- adopting a
        // same-login session we didn't open ourselves would risk mis-attributing another
        // terminal's register as this one's. That reconciliation belongs to the outbox
        // replay (registerOpenOfflineReplay in useOnlineStatus.ts), which knows the
        // idempotency key and can tell the difference safely.
      } else if (serverSession) {
        // No local record at all, but this login already has an active register on the
        // server (fresh browser profile, or IndexedDB was cleared) -- bootstrap local
        // truth from it so THIS terminal is durable/offline-capable for it going forward.
        const user = getCurrentUser();
        const bootstrapped = await adoptServerRegisterSession({
          tenantId: user.tenantId,
          terminalId: getTerminalId(),
          userId: user.userId,
          role: user.role,
          serverSessionId: serverSession.id,
          openingCash: serverSession.opening_cash,
          openedAt: serverSession.date,
        });
        applyLocal(bootstrapped);
      }
      setError(null);
    } catch (err) {
      // Network/backend unreachable. Per the requirement, this must NEVER clear or
      // downgrade to NO_SESSION -- if a local session exists, it is simply marked
      // unconfirmed (ACTIVE -> ACTIVE_OFFLINE) so the UI can show that honestly while the
      // cashier keeps working uninterrupted.
      if (local) {
        await markLocalRegisterSessionUnreachable(local.sessionId);
        applyLocal(await getLocalRegisterSession());
      }
      setError(err instanceof Error ? err.message : 'Failed to check register status');
    } finally {
      setLoading(false);
    }
  }, [applyLocal]);

  useEffect(() => {
    refresh();
    // Any write to the local register-session record (from this hook, from the outbox
    // replay in useOnlineStatus.ts, or from another mounted instance of this same hook)
    // should be reflected immediately without waiting for the next poll.
    function onChanged() {
      getLocalRegisterSession().then(applyLocal);
    }
    window.addEventListener('asmara:register-session-changed', onChanged);
    return () => window.removeEventListener('asmara:register-session-changed', onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const open = useCallback(async (openingCash: number) => {
    const user = getCurrentUser();
    const terminalId = getTerminalId();
    try {
      const res = await openRegister(openingCash);
      if (!res.status || !res.created) {
        throw new Error(res.message || 'Could not open the register.');
      }
      const record = await saveConfirmedRegisterSession({
        tenantId: user.tenantId,
        terminalId,
        userId: user.userId,
        role: user.role,
        serverSessionId: res.created.id,
        openingCash: res.created.opening_cash,
        openedAt: res.created.date,
      });
      applyLocal(record);
      return res;
    } catch (err) {
      if (!isNetworkError(err)) throw err; // a real server rejection -- surface it, don't fake success
      // Genuinely offline (or the backend is down): open the register LOCALLY right now --
      // per the requirement, connectivity must never block starting a shift -- and queue the
      // real create-register call to run the moment connectivity returns.
      const record = await openLocalRegisterSessionOffline({
        tenantId: user.tenantId,
        terminalId,
        userId: user.userId,
        role: user.role,
        openingCash,
      });
      applyLocal(record);
      await enqueueAction({
        type: 'register.open-offline',
        path: '/pos/opening-day-cash-amount',
        body: { openingCash, localSessionId: record.sessionId },
        label: `Open register -- €${openingCash.toFixed(2)} starting cash`,
        idempotencyKey: record.idempotencyKey,
      });
      return { status: true, created: toDisplaySession(record), message: 'Register opened offline -- will sync automatically.' };
    }
  }, [applyLocal]);

  return {
    session,
    state,
    // Kept for every existing caller (OpenRegisterModal gating, etc.): a session is
    // considered "open" in ACTIVE, ACTIVE_OFFLINE, or SYNCING -- only NO_SESSION should ever
    // show the "Open Session" screen again.
    isOpen: state !== 'NO_SESSION',
    loading,
    error,
    open,
    refresh,
  };
}
