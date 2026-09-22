'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushOutbox, getQueuedActions, QueuedAction } from '@/lib/offline/outbox';
import { sendTableOrderToKitchen, chargeOrder, finishOrder } from '@/lib/api';

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

async function replay(action: QueuedAction): Promise<unknown> {
  switch (action.type) {
    case 'orders.to-kitchen': {
      const b = action.body as unknown as ToKitchenBody;
      return sendTableOrderToKitchen(b.tableNumber, b.orderId, b.quantities, b.total, b.lines, action.idempotencyKey);
    }
    case 'orders.checkout-table': {
      const b = action.body as unknown as CheckoutTableBody;
      await sendTableOrderToKitchen(b.tableNumber, b.orderId, b.quantities, b.total, b.lines, b.keys.toKitchen);
      await chargeOrder(Number(b.orderId), b.total, b.method ?? 'card', b.splitCharges, b.keys.charge);
      // Only free the table once the kitchen send + charge have actually reached the server
      // -- freeing it earlier (e.g. optimistically, when the action was first queued) would
      // let another terminal seat a new party at a table whose bill hasn't really been paid
      // yet, from the server's point of view, until this flush succeeds.
      return finishOrder(String(b.orderId), b.tableNumber);
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
