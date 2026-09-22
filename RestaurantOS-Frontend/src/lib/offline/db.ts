'use client';

/**
 * Offline-first POS operation (CTO forensic audit 2026-09-21, P0 "Real offline-first POS
 * operation" -- flagged as: the service worker only caches the app shell, not API data, so
 * menu/orders/tables become unavailable the moment the network drops).
 *
 * SCOPE (deliberately bounded, documented honestly rather than half-building a bigger
 * promise): this makes ALREADY-OPEN checkout screens resilient to a network blip --
 * * the menu, tables, and tax rates a cashier is looking at stay visible and usable when the
 *   wifi drops (read-through cache in IndexedDB, refreshed on every successful fetch);
 * * sending items to the kitchen (`/orders/to-kitchen`) and completing a charge
 *   (`/orders/create`) for an order that ALREADY EXISTS keep working -- the request is
 *   queued locally and retried automatically the moment connectivity returns, using the same
 *   idempotency keys already wired into those endpoints (see services/payments and
 *   middlewares/idempotent.js on the backend) so a retried queue flush can never double-fire
 *   a charge or double-create a kitchen ticket.
 *
 * Deliberately OUT of scope, and left to the tracker's P0/P1 items instead: opening a table
 * / creating a brand-new order while fully offline. That needs a way for two terminals that
 * both went offline to reconcile who "owns" a table's new order once they're both back
 * online -- real multi-terminal conflict resolution, not a queue. Queuing writes against an
 * order that doesn't exist yet on the server would just move that unsolved problem one level
 * down instead of solving it, so it's flagged, not faked.
 */

const DB_NAME = 'asmara-pos-offline';
// Bumped to 2 (CTO remediation doc, Section 1: "true offline-first new order creation") for
// the new OFFLINE_ORDERS_STORE below. IndexedDB runs onupgradeneeded automatically for every
// browser that already has version 1 -- no migration script, no data loss for CACHE_STORE/
// OUTBOX_STORE (onupgradeneeded only ADDS the new store; it never touches the existing ones).
const DB_VERSION = 2;
export const CACHE_STORE = 'cache';
export const OUTBOX_STORE = 'outbox';
// Local record of a table/order opened while offline, before the server has ever heard of it
// (see offlineOrders.ts). Deliberately a SEPARATE store from CACHE_STORE (which only ever
// holds read-through copies of server data) -- an offline order is locally-authored data that
// must survive independently of whatever the last successful GET happened to cache, and must
// never be silently evicted or overwritten by a cache refresh.
export const OFFLINE_ORDERS_STORE = 'offlineOrders';

let dbPromise: Promise<IDBDatabase> | null = null;

function isSupported(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDb(): Promise<IDBDatabase> {
  if (!isSupported()) {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          const store = db.createObjectStore(OUTBOX_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(OFFLINE_ORDERS_STORE)) {
          db.createObjectStore(OFFLINE_ORDERS_STORE, { keyPath: 'clientOrderId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open offline database.'));
    });
  }
  return dbPromise;
}

/** Runs `fn` inside a transaction on `storeName`, resolving/rejecting with `fn`'s own promise. */
export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result: T;
    Promise.resolve(fn(store))
      .then((r) => {
        result = r;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error(`Transaction failed on ${storeName}.`));
    tx.onabort = () => reject(tx.error ?? new Error(`Transaction aborted on ${storeName}.`));
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

export { isSupported };
