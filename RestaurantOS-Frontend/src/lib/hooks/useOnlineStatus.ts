'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushOutbox, getQueuedActions, QueuedAction } from '@/lib/offline/outbox';
import { sendTableOrderToKitchen, chargeOrder, finishOrder, initTableOrder, openRegister, transferTable } from '@/lib/api';
import { markOfflineOrderResolved, markOfflineOrderConflict, resolveOrderIdForReplay } from '@/lib/offline/offlineOrders';
import {
  markLocalRegisterSessionSyncing,
  markLocalRegisterSessionSynced,
  markLocalRegisterSessionOffline,
} from '@/lib/offline/registerSession';
import { isNetworkError } from '@/lib/offline/network';

/**
 * Tracks connectivity and owns replaying the offline outbox (see lib/offline/outbox.ts) the
 * moment the browser comes back online. Also flushes on a short interval while online, since
 * a flaky connection can report `navigator.onLine === true` while individual requests still
 * fail -- polling catches those in-between cases the 'online' event alone would miss.
 *
 * Lives here (not inline in the POS page) so every screen under the dashboard layout shares
 * ONE outbox and ONE flush loop -- a kitchen ticket queued from the POS screen still gets
 * replayed even if the cashier has since navigated to /tables while offline.
 */

interface CheckoutTableBody {
  tableNumber: string;
  orderId: number | string;
  quantities: Record<number, number>;
  total: number;
  lines?: Parameters<typeof sendTableOrderToKitchen>[4];
  method?: 'cash' | 'card';
  splitCharges?: Parameters<typeof chargeOrder>[3];
  keys: { toKitchen: string; charge: string };
}

interface ToKitchenBody {
  tableNumber: string;
  orderId: number | string;
  quantities: Record<number, number>;
  total: number;
  lines?: Parameters<typeof sendTableOrderToKitchen>[4];
}

interface InitOfflineBody {
  tableNumber: string;
  clientOrderId: string;
}

interface RegisterOpenOfflineBody {
  openingCash: number;
  localSessionId: string;
}

interface TableTransferBody {
  fromTable: string;
  toTable: string;
  terminalId?: string;
}

/**
 * True offline-first new order creation (CTO remediation doc, Section 1): resolves a queued
 * action's local placeholder order id (see offlineOrders.ts) to the real server order id
 * before sending it, throwing (which flushOutbox treats as "still stuck, keep queued, block
 * later actions") if that resolution genuinely isn't ready yet -- see
 * resolveOrderIdForReplay's own comment for why that should never actually happen given
 * flushOutbox's strict FIFO ordering, but a thrown error here is the SAFE failure mode if it
 * somehow did (never sends a request with a garbage/local order id to the server).
 */
async function resolveRealOrderId(orderId: number | string): Promise<number> {
  const resolved = await resolveOrderIdForReplay(orderId);
  if (resolved.ready) return resolved.orderId;
  if (resolved.conflict) {
    // This order can never be delivered -- surfaced already by markOfflineOrderConflict
    // (which also drops every other queued action for it). Removing THIS action too (instead
    // of leaving it to fail forever) is done by throwing a distinct error that flushOutbox's
    // caller can choose to treat as terminal; for now it simply fails this one flush attempt
    // without blocking unrelated queued actions for OTHER orders, since removeQueuedActionsForOrder
    // already removed every sibling action for this same conflicted order.
    throw new Error(`This order's table was claimed by another terminal while offline and can no longer be delivered (order ${orderId}).`);
  }
  throw new Error(`Order ${orderId} is not yet synced -- its "open table" action has not been replayed yet.`);
}

async function replay(action: QueuedAction): Promise<unknown> {
  switch (action.type) {
    case 'orders.init-offline': {
      const b = action.body as unknown as InitOfflineBody;
      try {
        const res = await initTableOrder(b.tableNumber, action.idempotencyKey);
        if (!res.status || !res.order) {
          // A non-2xx/`status:false` response here is a REAL rejection (e.g. the table is no
          // longer free -- someone else opened it while this terminal was offline), not a
          // network error, so apiFetch already turned it into a thrown Error before this
          // branch would even run in the common case. This branch only covers the rarer shape
          // of a 200 response body that itself carries `status:false` (see /orders/init's own
          // handler) -- treated exactly the same way: a genuine conflict, not a retry target.
          await markOfflineOrderConflict(b.clientOrderId, res.message || 'Table is no longer available.');
          return res;
        }
        await markOfflineOrderResolved(b.clientOrderId, res.order.id);
        return res;
      } catch (err) {
        if (isNetworkError(err)) throw err; // still genuinely offline -- keep queued, retry later
        // A real server rejection (403 "table is not available", etc.) -- deterministic
        // conflict, per Section 14: never silently overwritten, never retried forever.
        await markOfflineOrderConflict(b.clientOrderId, err instanceof Error ? err.message : String(err));
        return { status: false, conflict: true };
      }
    }
    case 'orders.to-kitchen': {
      const b = action.body as unknown as ToKitchenBody;
      const realOrderId = await resolveRealOrderId(b.orderId);
      return sendTableOrderToKitchen(b.tableNumber, realOrderId, b.quantities, b.total, b.lines, action.idempotencyKey);
    }
    case 'orders.checkout-table': {
      const b = action.body as unknown as CheckoutTableBody;
      const realOrderId = await resolveRealOrderId(b.orderId);
      await sendTableOrderToKitchen(b.tableNumber, realOrderId, b.quantities, b.total, b.lines, b.keys.toKitchen);
      // Offline payment recording (CTO remediation doc, Section 4): this charge is being
      // sent from the offline queue right now -- tag it so, purely for traceability (see
      // lib/api.ts's chargeOrder for what this does and doesn't affect).
      await chargeOrder(realOrderId, b.total, b.method ?? 'card', b.splitCharges, b.keys.charge, true);
      // Only free the table once the kitchen send + charge have actually reached the server
      // -- freeing it earlier (e.g. optimistically, when the action was first queued) would
      // let another terminal seat a new party at a table whose bill hasn't really been paid
      // yet, from the server's point of view, until this flush succeeds.
      return finishOrder(String(realOrderId), b.tableNumber);
    }
    case 'register.open-offline': {
      // Offline-first register-session requirement (item 8, "reconnection must be
      // automatic"): this is the queued action useRegisterSession.ts's open() enqueues when
      // it opens a register locally while offline. Reuses the SAME idempotency key on every
      // retry (action.idempotencyKey === the local record's idempotencyKey) so the backend's
      // idempotent() middleware can never double-create the register row, even if this
      // replay itself fires more than once (flushOutbox's own dedupe aside).
      const b = action.body as unknown as RegisterOpenOfflineBody;
      await markLocalRegisterSessionSyncing(b.localSessionId);
      try {
        const res = await openRegister(b.openingCash, action.idempotencyKey);
        if (!res.status || !res.created) {
          // A real rejection, not a network failure -- the local session stays open and
          // usable (never silently closed just because the sync attempt failed); it's left
          // marked as still offline/unsynced so a future manual retry or support action can
          // resolve it, without ever showing the "Open Session" screen over an active shift.
          await markLocalRegisterSessionOffline(b.localSessionId);
          throw new Error(res.message || 'Failed to sync the offline-opened register.');
        }
        await markLocalRegisterSessionSynced(b.localSessionId, res.created.id);
        return res;
      } catch (err) {
        if (isNetworkError(err)) {
          // Still genuinely offline -- keep queued, retry later, but don't leave the local
          // session stuck showing "SYNCING" in the meantime.
          await markLocalRegisterSessionOffline(b.localSessionId);
        }
        throw err;
      }
    }
    case 'tables.transfer': {
      // Offline-first requirement (item 6, "table transfers must survive network loss"):
      // useTables.ts's transfer() queues this exact shape on a network failure. Retried with
      // the SAME idempotency key; the backend has no dedicated idempotency guard on
      // /tables/transfer, but its own precondition checks (destination must be free, source
      // must have an active order) make a blind retry after an already-succeeded transfer
      // fail closed rather than double-apply -- see useTables.ts's comment for the full
      // reasoning on why that's an acceptable, documented limitation rather than a silent gap.
      const b = action.body as unknown as TableTransferBody;
      return transferTable(b.fromTable, b.toTable, b.terminalId);
    }
    default:
      throw new Error(`Unknown queued action type: ${action.type}`);
  }
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [queuedCount, setQueuedCount] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const flushingRef = useRef(false);

  const refreshQueuedCount = useCallback(async () => {
    const actions = await getQueuedActions();
    setQueuedCount(actions.length);
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setFlushing(true);
    try {
      await flushOutbox(replay);
    } catch {
      // flushOutbox already records per-action failures; a thrown error here would only be
      // an unexpected bug in the flush loop itself, not a reason to crash the app.
    } finally {
      flushingRef.current = false;
      setFlushing(false);
      await refreshQueuedCount();
    }
  }, [refreshQueuedCount]);

  useEffect(() => {
    refreshQueuedCount();
    function handleOnline() {
      setOnline(true);
      flush();
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // Belt-and-braces poll: a connection can be technically "online" per the browser but
    // still failing real requests (captive portal, flaky wifi) -- retry periodically
    // regardless of whether the online/offline events actually fire.
    const interval = setInterval(() => {
      if (typeof navigator === 'undefined' || navigator.onLine) flush();
    }, 20000);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { online, queuedCount, flushing, flushNow: flush, refreshQueuedCount };
}
