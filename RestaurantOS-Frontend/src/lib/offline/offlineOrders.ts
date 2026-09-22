'use client';

/**
 * True offline-first NEW order creation (CTO remediation doc, Section 1). Before this, opening
 * a table required a real round trip to GET /orders/init/:table -- see lib/hooks/useTables.ts's
 * old comment and lib/offline/db.ts's file header, both of which documented this as explicitly
 * OUT of scope: "doing it safely needs [GET /orders/init/:table to be replay-safe, which it now
 * is -- see middlewares/idempotent.js] and a real, told-the-truth answer for what happens when
 * two terminals both queue 'open table 5' while offline."
 *
 * SCOPE, stated honestly: this makes it possible for a cashier to tap a FREE table while fully
 * offline and immediately start building an order -- add items, add modifiers, fire courses,
 * send to kitchen -- all of which already work offline (lib/offline/outbox.ts's existing
 * 'orders.to-kitchen' / 'orders.checkout-table' queueing, unchanged by this file). What this
 * file adds is the one missing link: a LOCAL placeholder order id, minted client-side, that the
 * rest of the already-offline-capable POS flow can use before the server has ever heard of this
 * order.
 *
 * What this does NOT claim to solve: if a SECOND terminal also opens table 5 while both are
 * offline (or one is online and beats the other to it), only one can win once both requests
 * reach the server -- GET /orders/init/:table's existing `table.status !== 'free'` check
 * decides that, deterministically, the same way it already does for two ONLINE terminals
 * racing for the same table. The loser's local order is marked CONFLICT (see
 * markOfflineOrderConflict below) and its queued kitchen/checkout actions are dropped rather
 * than either silently retried forever or silently merged into the winner's order -- the
 * cashier is told, and has to redo the order on a table that's actually free. A proper
 * multi-terminal reconciliation UI (letting the loser's items be moved onto the winning order
 * automatically) is real, separate future work -- tracked, not bluffed as done here.
 */
import { getTerminalId } from '../terminal';
import { OFFLINE_ORDERS_STORE, isSupported, requestToPromise, withStore } from './db';
import { enqueueAction, removeQueuedActionsForOrder } from './outbox';

export const LOCAL_ORDER_PREFIX = 'local-';

export type OfflineOrderStatus = 'pending_sync' | 'synced' | 'conflict';

export interface OfflineOrderRecord {
  clientOrderId: string;
  tableNumber: string;
  terminalId: string;
  userId?: number | string;
  status: OfflineOrderStatus;
  createdAt: string;
  serverOrderId: number | null;
  conflictMessage?: string;
}

function newClientOrderId(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${LOCAL_ORDER_PREFIX}${uuid}`;
}

export function isLocalOrderId(orderId: unknown): orderId is string {
  return typeof orderId === 'string' && orderId.startsWith(LOCAL_ORDER_PREFIX);
}

/**
 * Step-by-step, matching the remediation doc's own createOfflineOrder() spec (Section 1):
 * generate a client order id, record the terminal/user/table/timestamp, persist locally, queue
 * the eventual server sync as an outbox event, and return immediately -- no network call, ever,
 * on this path.
 */
export async function createOfflineOrder(input: {
  tableNumber: string;
  userId?: number | string;
}): Promise<{ tableNumber: string; orderId: string }> {
  if (!isSupported()) {
    throw new Error('Offline order creation is not available in this browser (no IndexedDB).');
  }
  const clientOrderId = newClientOrderId();
  const terminalId = getTerminalId();
  const record: OfflineOrderRecord = {
    clientOrderId,
    tableNumber: input.tableNumber,
    terminalId,
    userId: input.userId,
    status: 'pending_sync',
    createdAt: new Date().toISOString(),
    serverOrderId: null,
  };

  await withStore<void>(OFFLINE_ORDERS_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.put(record));
  });

  // Queued LAST (after the local record already exists) and with the idempotency key equal
  // to the client order id itself -- so a flush that fires twice for this same action always
  // reserves/replays the exact same server-side idempotency row (see
  // middlewares/idempotent.js), and this action is trivially traceable back to its local
  // record by id alone, with no separate correlation table needed.
  await enqueueAction({
    type: 'orders.init-offline',
    path: `/orders/init/${encodeURIComponent(input.tableNumber)}`,
    body: { tableNumber: input.tableNumber, clientOrderId },
    idempotencyKey: clientOrderId,
    label: `Table #${input.tableNumber} -- open (offline)`,
  });

  return { tableNumber: input.tableNumber, orderId: clientOrderId };
}

export async function getOfflineOrder(clientOrderId: string): Promise<OfflineOrderRecord | undefined> {
  if (!isSupported()) return undefined;
  return withStore<OfflineOrderRecord | undefined>(OFFLINE_ORDERS_STORE, 'readonly', async (store) => {
    return (await requestToPromise(store.get(clientOrderId))) as OfflineOrderRecord | undefined;
  });
}

export async function getAllOfflineOrders(): Promise<OfflineOrderRecord[]> {
  if (!isSupported()) return [];
  return withStore<OfflineOrderRecord[]>(OFFLINE_ORDERS_STORE, 'readonly', async (store) => {
    return (await requestToPromise(store.getAll())) as OfflineOrderRecord[];
  });
}

export async function markOfflineOrderResolved(clientOrderId: string, serverOrderId: number): Promise<void> {
  await withStore<void>(OFFLINE_ORDERS_STORE, 'readwrite', async (store) => {
    const existing = (await requestToPromise(store.get(clientOrderId))) as OfflineOrderRecord | undefined;
    if (!existing) return;
    await requestToPromise(store.put({ ...existing, status: 'synced', serverOrderId }));
  });
}

/**
 * A genuine multi-terminal conflict (Section 14's race, applied to brand-new order creation):
 * the table this local order was opened against is no longer free by the time the server saw
 * the sync. Marks the local record CONFLICT (a terminal state -- surfaced to the UI, never
 * auto-retried) and drops every other queued action that depended on this order's server id
 * ever existing, since it never will.
 */
export async function markOfflineOrderConflict(clientOrderId: string, message: string): Promise<void> {
  await withStore<void>(OFFLINE_ORDERS_STORE, 'readwrite', async (store) => {
    const existing = (await requestToPromise(store.get(clientOrderId))) as OfflineOrderRecord | undefined;
    if (!existing) return;
    await requestToPromise(store.put({ ...existing, status: 'conflict', conflictMessage: message }));
  });
  await removeQueuedActionsForOrder(clientOrderId);
}

/**
 * Resolves a LOCAL order id to what should actually be sent to the server right now, for a
 * queued 'orders.to-kitchen' / 'orders.checkout-table' action whose body carries a local
 * placeholder id (minted by createOfflineOrder above). Sequencing guarantee this relies on:
 * flushOutbox (outbox.ts) replays queued actions strictly in the order they were queued and
 * stops at the first still-failing one -- a kitchen-send or checkout for a given order can
 * only ever have been queued AFTER that order's own 'orders.init-offline' action, so by the
 * time this runs for it, the init action has already either resolved (status: 'synced') or
 * conflicted (status: 'conflict') on this same flush pass or an earlier one.
 *
 * Returns `{ ready: true, orderId }` once the real server id is known; `{ ready: false }` if
 * the init sync genuinely hasn't happened yet (defensive -- should not occur given the
 * sequencing guarantee above, but a thrown error here correctly leaves the action queued and
 * blocking, which is the safe default, rather than sending garbage to the server); or
 * `{ ready: false, conflict: true }` if this order can never be delivered.
 */
export async function resolveOrderIdForReplay(
  orderId: number | string
): Promise<{ ready: true; orderId: number } | { ready: false; conflict?: boolean }> {
  if (!isLocalOrderId(orderId)) {
    return { ready: true, orderId: orderId as number };
  }
  const record = await getOfflineOrder(orderId);
  if (!record) return { ready: false };
  if (record.status === 'synced' && record.serverOrderId !== null) {
    return { ready: true, orderId: record.serverOrderId };
  }
  if (record.status === 'conflict') {
    return { ready: false, conflict: true };
  }
  return { ready: false };
}
