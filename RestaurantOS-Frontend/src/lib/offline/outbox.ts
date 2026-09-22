'use client';

/**
 * Local write queue for POS actions on an ALREADY-EXISTING order (see db.ts's file-level
 * comment for what is and isn't in scope). When `apiFetch` fails with a genuine network
 * error (not an HTTP error response -- the server rejecting the request is not something
 * retrying blindly would fix), the action is queued here instead of failing the checkout
 * outright. `flushOutbox()` replays every queued action in the order it was queued, using
 * its original idempotency key, so a flush that runs twice (e.g. the 'online' event fires
 * more than once) can never double-charge or double-create a kitchen ticket -- the backend's
 * idempotency-key middleware makes the retry a no-op, not a duplicate.
 */
import { OUTBOX_STORE, isSupported, requestToPromise, withStore } from './db';

export type QueuedActionType = 'orders.to-kitchen' | 'orders.create' | 'orders.checkout-table' | 'orders.init-offline';

export interface QueuedAction {
  id?: number;
  type: QueuedActionType;
  path: string;
  body: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
  // Human-readable context shown in the UI (e.g. "Table 4 -- €23.50") so a cashier reviewing
  // a stuck queue can tell what's actually pending, not just an opaque id.
  label: string;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueueAction(input: {
  type: QueuedActionType;
  path: string;
  body: Record<string, unknown>;
  label: string;
  idempotencyKey?: string;
}): Promise<QueuedAction> {
  const action: QueuedAction = {
    type: input.type,
    path: input.path,
    body: input.body,
    label: input.label,
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  if (!isSupported()) {
    // No IndexedDB (very old browser, or a locked-down embedded webview) -- there's nowhere
    // safe to queue this, so surface it as a real failure rather than silently dropping a
    // charge or a kitchen ticket.
    throw new Error('Offline queueing is not available in this browser; the request could not be sent or saved.');
  }
  const id = await withStore<number>(OUTBOX_STORE, 'readwrite', async (store) => {
    return (await requestToPromise(store.add(action))) as number;
  });
  return { ...action, id };
}

export async function getQueuedActions(): Promise<QueuedAction[]> {
  if (!isSupported()) return [];
  try {
    return await withStore<QueuedAction[]>(OUTBOX_STORE, 'readonly', async (store) => {
      return (await requestToPromise(store.getAll())) as QueuedAction[];
    });
  } catch {
    return [];
  }
}

async function removeAction(id: number): Promise<void> {
  await withStore<void>(OUTBOX_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.delete(id));
  });
}

// Offline order creation (CTO remediation doc, Section 1): when a table opened offline turns
// out to conflict with the server on sync (another terminal opened the same table in the
// meantime -- see offlineOrders.ts's markOfflineOrderConflict), every OTHER queued action that
// was waiting on that same local order id (a queued "send to kitchen" or "checkout") can never
// be delivered -- there is no server-side order for it to apply to. Rather than leaving them
// queued forever (silently blocking the whole outbox on every future flush, since flushOutbox
// stops at the first still-failing action), the caller removes them explicitly and the
// cashier is shown the conflict so the order can be recreated on a table that's actually
// free -- a deterministic, visible conflict, not a silently-dropped order.
export async function removeQueuedActionsForOrder(orderId: string): Promise<number> {
  const actions = await getQueuedActions();
  const toRemove = actions.filter((a) => {
    const body = a.body as Record<string, unknown>;
    if (!body) return false;
    // Matches a dependent 'orders.to-kitchen' / 'orders.checkout-table' action (keyed by
    // `orderId`) AND the order's own 'orders.init-offline' action (keyed by `clientOrderId`,
    // not `orderId` -- see offlineOrders.ts's createOfflineOrder) so cancelling or
    // conflict-resolving an offline order clears every trace of it from the queue, not just
    // its dependents.
    return body.orderId === orderId || body.clientOrderId === orderId;
  });
  for (const action of toRemove) {
    if (action.id !== undefined) {
      // eslint-disable-next-line no-await-in-loop
      await removeAction(action.id);
    }
  }
  return toRemove.length;
}

async function updateAction(id: number, patch: Partial<QueuedAction>): Promise<void> {
  await withStore<void>(OUTBOX_STORE, 'readwrite', async (store) => {
    const existing = (await requestToPromise(store.get(id))) as QueuedAction | undefined;
    if (!existing) return;
    await requestToPromise(store.put({ ...existing, ...patch, id }));
  });
}

/**
 * Sends every queued action, in the order it was queued, via `sender` (the actual apiFetch
 * call). A queued action that succeeds is removed; one that fails again is left queued with
 * its attempt count bumped so the UI can show it's still stuck (e.g. a genuinely rejected
 * request, not just "still offline"). Actions are sent sequentially, not in parallel -- two
 * charges for the same order queued out of order must apply in the order the cashier
 * actually took them.
 */
export async function flushOutbox(
  sender: (action: QueuedAction) => Promise<unknown>
): Promise<{ sent: number; failed: number }> {
  const actions = await getQueuedActions();
  actions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let sent = 0;
  let failed = 0;
  for (const action of actions) {
    if (action.id === undefined) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await sender(action);
      // eslint-disable-next-line no-await-in-loop
      await removeAction(action.id);
      sent += 1;
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-await-in-loop
      await updateAction(action.id, {
        attempts: action.attempts + 1,
        lastError: err instanceof Error ? err.message : String(err),
      });
      // Stop at the first still-failing action instead of racing ahead to later ones --
      // later queued actions on the SAME order (e.g. "send to kitchen" then "charge") must
      // never apply out of order just because an earlier one is still stuck offline.
      break;
    }
  }
  return { sent, failed };
}
