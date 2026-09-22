/**
 * Offline-first POS operation (CTO forensic audit 2026-09-21, P0): real, executable tests
 * for the local offline queue (lib/offline/outbox.ts, db.ts, cache.ts) -- the actual claim
 * being tested is "an action queued while offline survives and replays correctly, in order,
 * exactly once, when connectivity returns." Uses fake-indexeddb to provide a real IndexedDB
 * implementation in Node (this project has no browser test runner) so this exercises the
 * REAL code path (real transactions, real object stores), not a mocked stand-in for it.
 *
 * Run with: npx tsx --test src/lib/offline/__tests__/outbox.test.ts
 * (wired into `npm run test:offline` in package.json).
 */
import 'fake-indexeddb/auto';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// fake-indexeddb/auto installs `indexedDB` on globalThis; db.ts's isSupported() checks
// `typeof window !== 'undefined'`, so give it a minimal `window` too before importing.
(globalThis as unknown as { window: unknown }).window = globalThis;

// Loaded in `before()` (not top-level await) -- this file compiles to CommonJS under tsx's
// default settings, which doesn't allow top-level await.
let enqueueAction: typeof import('../outbox').enqueueAction;
let getQueuedActions: typeof import('../outbox').getQueuedActions;
let flushOutbox: typeof import('../outbox').flushOutbox;
let cacheGet: typeof import('../cache').cacheGet;
let cacheSet: typeof import('../cache').cacheSet;
let loadWithCache: typeof import('../cache').loadWithCache;

before(async () => {
    ({ enqueueAction, getQueuedActions, flushOutbox } = await import('../outbox'));
    ({ cacheGet, cacheSet, loadWithCache } = await import('../cache'));
});

let withStore: typeof import('../db').withStore;
let CACHE_STORE: typeof import('../db').CACHE_STORE;
let OUTBOX_STORE: typeof import('../db').OUTBOX_STORE;

before(async () => {
    ({ withStore, CACHE_STORE, OUTBOX_STORE } = await import('../db'));
});

// db.ts memoizes a single open IndexedDB connection at module scope (correct for the real
// app -- one page, one connection), which means indexedDB.deleteDatabase() between tests
// would just hang forever waiting for a connection this process never closes. Clearing both
// object stores through that SAME open connection resets state between tests without ever
// needing to delete/reopen the database itself.
beforeEach(async () => {
    await withStore(CACHE_STORE, 'readwrite', (store) => new Promise<void>((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    }));
    await withStore(OUTBOX_STORE, 'readwrite', (store) => new Promise<void>((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    }));
});

test('enqueueAction stores an action and getQueuedActions returns it', async () => {
  await enqueueAction({
    type: 'orders.to-kitchen',
    path: '/orders/to-kitchen/5',
    body: { tableNumber: '5', orderId: 1, quantities: { 1: 2 }, total: 10 },
    label: 'Table #5 -- send to kitchen',
  });
  const queued = await getQueuedActions();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].type, 'orders.to-kitchen');
  assert.equal(queued[0].label, 'Table #5 -- send to kitchen');
  assert.equal(typeof queued[0].idempotencyKey, 'string');
  assert.ok(queued[0].idempotencyKey.length > 0);
});

test('two queued actions replay in the order they were queued, sequentially', async () => {
  await enqueueAction({ type: 'orders.to-kitchen', path: '/a', body: { n: 1 }, label: 'first' });
  await enqueueAction({ type: 'orders.to-kitchen', path: '/b', body: { n: 2 }, label: 'second' });

  const order: number[] = [];
  const result = await flushOutbox(async (action) => {
    order.push((action.body as { n: number }).n);
  });

  assert.deepEqual(order, [1, 2], 'actions must replay in FIFO order, not insertion-id order by chance');
  assert.equal(result.sent, 2);
  assert.equal(result.failed, 0);
  assert.equal((await getQueuedActions()).length, 0, 'successfully-sent actions must be removed from the queue');
});

test('a successfully-sent action is removed; a failing one is left queued with attempts bumped', async () => {
  await enqueueAction({ type: 'orders.to-kitchen', path: '/ok', body: {}, label: 'will succeed' });
  await enqueueAction({ type: 'orders.to-kitchen', path: '/bad', body: {}, label: 'will fail' });

  const result = await flushOutbox(async (action) => {
    if (action.label === 'will fail') throw new Error('simulated network failure');
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  const remaining = await getQueuedActions();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].label, 'will fail');
  assert.equal(remaining[0].attempts, 1);
  assert.equal(remaining[0].lastError, 'simulated network failure');
});

test('a still-failing action blocks LATER queued actions from sending out of order', async () => {
  await enqueueAction({ type: 'orders.to-kitchen', path: '/1', body: { step: 1 }, label: 'fails' });
  await enqueueAction({ type: 'orders.to-kitchen', path: '/2', body: { step: 2 }, label: 'would succeed if tried' });

  const attempted: number[] = [];
  const result = await flushOutbox(async (action) => {
    attempted.push((action.body as { step: number }).step);
    if (action.label === 'fails') throw new Error('down');
  });

  assert.deepEqual(attempted, [1], 'the second action must never even be attempted while the first is still stuck');
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.equal((await getQueuedActions()).length, 2, 'both actions remain queued -- the second was never touched');
});

test('replaying a queued action twice (a flush that runs again before the queue is drained) reuses the SAME idempotency key', async () => {
  const queued = await enqueueAction({ type: 'orders.create', path: '/orders/create', body: { total: 42 }, label: 'charge' });
  const keysSeen: string[] = [];

  // First flush fails (simulated), leaving the action queued.
  await flushOutbox(async (action) => {
    keysSeen.push(action.idempotencyKey);
    throw new Error('still offline');
  });
  // Second flush succeeds.
  await flushOutbox(async (action) => {
    keysSeen.push(action.idempotencyKey);
  });

  assert.equal(keysSeen.length, 2);
  assert.equal(keysSeen[0], keysSeen[1], 'a retried replay of the same queued action must use the same idempotency key both times, so the backend\'s idempotency middleware (not luck) is what prevents a double-charge');
  assert.equal(keysSeen[0], queued.idempotencyKey);
});

test('cacheSet/cacheGet round-trip a value', async () => {
  await cacheSet('menu.categories', [{ id: 1, name: 'Starters' }]);
  const cached = await cacheGet<{ id: number; name: string }[]>('menu.categories');
  assert.ok(cached);
  assert.deepEqual(cached!.value, [{ id: 1, name: 'Starters' }]);
});

test('loadWithCache returns fresh data and caches it on success', async () => {
  const result = await loadWithCache('menu.items', async () => [{ id: 1, name: 'Burger' }]);
  assert.equal(result.stale, false);
  assert.deepEqual(result.value, [{ id: 1, name: 'Burger' }]);

  const cached = await cacheGet('menu.items');
  assert.deepEqual(cached!.value, [{ id: 1, name: 'Burger' }]);
});

test('loadWithCache falls back to the cached value (stale: true) when the loader fails', async () => {
  await cacheSet('menu.items', [{ id: 1, name: 'Burger' }]);
  const result = await loadWithCache('menu.items', async () => {
    throw new Error('network is down');
  });
  assert.equal(result.stale, true);
  assert.deepEqual(result.value, [{ id: 1, name: 'Burger' }]);
});

test('loadWithCache re-throws when the loader fails AND there is no cached fallback at all', async () => {
  await assert.rejects(
    loadWithCache('never-cached-key', async () => {
      throw new Error('network is down, and this is the very first load');
    }),
    /network is down/
  );
});
