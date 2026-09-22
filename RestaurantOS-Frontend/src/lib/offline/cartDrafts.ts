'use client';

/**
 * Offline restart recovery (CTO remediation doc, Section 5): "create offline order, add 5
 * items, close/restart POS, reopen -- order/items/modifiers/table assignment/kitchen state/
 * outbox event must all still exist." The order itself already survives a restart
 * (offlineOrders.ts) and anything already sent to kitchen is already reconstructable from the
 * server (see pos/page.tsx's existing getOrders()-based preload). The one real gap: items
 * added to the cart but not yet (re)sent to kitchen lived in lib/hooks/useCart.ts's plain
 * React state only, with no persistence at all -- lost on any refresh, for both an offline
 * order AND a perfectly-online one (this was never actually offline-specific, just newly
 * required to be fixed for offline by this section).
 *
 * Saves the FULL current cart (every line, sent or not) on every change, keyed by the order's
 * id -- real numeric id or a local placeholder from offlineOrders.ts, doesn't matter, both are
 * just strings/numbers used as an IndexedDB key here. This is a superset of "just the unsent
 * lines" (see useCart.ts's own comment: cart.lines already represents the order's whole
 * current composition, sent + unsent, which is what the backend's own to-kitchen diffing
 * expects to receive each time), so restoring the draft on mount is a complete, correct
 * substitute for the server-side reload it takes priority over.
 *
 * Deliberately last-write-wins, single-terminal: if a SECOND terminal also has this same
 * order open and modifies it server-side, this draft does not know that and will not merge
 * with it -- restoring a local draft only ever matters for THIS terminal recovering from ITS
 * OWN restart, not for reconciling concurrent edits from elsewhere (that's item 4/Section
 * 11-13's still-unstarted general conflict-resolution work).
 */
import { CartLine } from '../types';
import { CART_DRAFTS_STORE, isSupported, requestToPromise, withStore } from './db';

interface CartDraftRecord {
  orderId: string;
  lines: CartLine[];
  savedAt: string;
}

function normalizeKey(orderId: number | string): string {
  return String(orderId);
}

export async function saveCartDraft(orderId: number | string, lines: CartLine[]): Promise<void> {
  if (!isSupported()) return; // no IndexedDB -- degrade to today's in-memory-only behavior
  const record: CartDraftRecord = { orderId: normalizeKey(orderId), lines, savedAt: new Date().toISOString() };
  try {
    await withStore<void>(CART_DRAFTS_STORE, 'readwrite', async (store) => {
      await requestToPromise(store.put(record));
    });
  } catch {
    // Best-effort, same as every other offline-lib write in this app (see outbox.ts's own
    // fallback style) -- a failed draft save must never block the cashier from continuing to
    // ring up items in memory; it only means a restart right now would lose them, exactly the
    // pre-existing (not worse) behavior.
  }
}

export async function getCartDraft(orderId: number | string): Promise<CartLine[] | undefined> {
  if (!isSupported()) return undefined;
  try {
    const record = await withStore<CartDraftRecord | undefined>(CART_DRAFTS_STORE, 'readonly', async (store) => {
      return (await requestToPromise(store.get(normalizeKey(orderId)))) as CartDraftRecord | undefined;
    });
    return record?.lines;
  } catch {
    return undefined;
  }
}

export async function clearCartDraft(orderId: number | string): Promise<void> {
  if (!isSupported()) return;
  try {
    await withStore<void>(CART_DRAFTS_STORE, 'readwrite', async (store) => {
      await requestToPromise(store.delete(normalizeKey(orderId)));
    });
  } catch {
    // Best-effort cleanup -- a leftover draft for a finished order is harmless (it's simply
    // never read again under a fresh order id) rather than a correctness problem.
  }
}
