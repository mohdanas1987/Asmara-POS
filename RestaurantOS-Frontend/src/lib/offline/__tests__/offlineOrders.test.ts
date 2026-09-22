/**
 * True offline-first new order creation (CTO remediation doc, Section 1): real, executable
 * tests for createOfflineOrder() and its resolution/conflict lifecycle
 * (lib/offline/offlineOrders.ts), using fake-indexeddb for a real IndexedDB implementation in
 * Node (same approach as outbox.test.ts).
 *
 * Run with: npx tsx --test src/lib/offline/__tests__/offlineOrders.test.ts
 * (wired into `npm run test:offline` in package.json).
 */
import 'fake-indexeddb/auto';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { window: unknown }).window = globalThis;

let createOfflineOrder: typeof import('../offlineOrders').createOfflineOrder;
let getOfflineOrder: typeof import('../offlineOrders').getOfflineOrder;
let markOfflineOrderResolved: typeof import('../offlineOrders').markOfflineOrderResolved;
let markOfflineOrderConflict: typeof import('../offlineOrders').markOfflineOrderConflict;
let resolveOrderIdForReplay: typeof import('../offlineOrders').resolveOrderIdForReplay;
let isLocalOrderId: typeof import('../offlineOrders').isLocalOrderId;

let getQueuedActions: typeof import('../outbox').getQueuedActions;
let withStore: typeof import('../db').withStore;
let CACHE_STORE: typeof import('../db').CACHE_STORE;
let OUTBOX_STORE: typeof import('../db').OUTBOX_STORE;
let OFFLINE_ORDERS_STORE: typeof import('../db').OFFLINE_ORDERS_STORE;

before(async () => {
  ({ createOfflineOrder, getOfflineOrder, markOfflineOrderResolved, markOfflineOrderConflict, resolveOrderIdForReplay, isLocalOrderId } =
    await import('../offlineOrders'));
  ({ getQueuedActions } = await import('../outbox'));
  ({ withStore, CACHE_STORE, OUTBOX_STORE, OFFLINE_ORDERS_STORE } = await import('../db'));
});

async function clearStore(name: string) {
  await withStore(name, 'readwrite', (store) => new Promise<void>((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

beforeEach(async () => {
  await clearStore(CACHE_STORE);
  await clearStore(OUTBOX_STORE);
  await clearStore(OFFLINE_ORDERS_STORE);
});

test('createOfflineOrder persists a local order record AND queues a matching outbox action, with no network call', async () => {
  const { tableNumber, orderId } = await createOfflineOrder({ tableNumber: '7', userId: 42 });

  assert.equal(tableNumber, '7');
  assert.ok(isLocalOrderId(orderId), 'the returned id must be recognizable as a local placeholder');

  const record = await getOfflineOrder(orderId);
  assert.ok(record, 'the offline order must be persisted locally');
  assert.equal(record!.tableNumber, '7');
  assert.equal(record!.userId, 42);
  assert.equal(record!.status, 'pending_sync');
  assert.equal(record!.serverOrderId, null);
  assert.equal(typeof record!.terminalId, 'string');

  const queued = await getQueuedActions();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].type, 'orders.init-offline');
  assert.equal(queued[0].idempotencyKey, orderId, 'the idempotency key must be the client order id itself');
  assert.equal((queued[0].body as { clientOrderId: string }).clientOrderId, orderId);
});

test('data survives a simulated "app restart" (fresh module import against the same underlying IndexedDB)', async () => {
  const { orderId } = await createOfflineOrder({ tableNumber: '8' });

  // fake-indexeddb's global store persists independently of any particular module instance --
  // re-importing (as a real page reload re-runs all module top-level code, including db.ts's
  // memoized connection) and reading back through a FRESH set of bindings is the closest this
  // Node-based harness can get to proving "survives a page refresh" without an actual browser.
  delete require.cache[require.resolve('../offlineOrders')];
  delete require.cache[require.resolve('../db')];
  delete require.cache[require.resolve('../outbox')];
  const reloaded = await import('../offlineOrders');

  const record = await reloaded.getOfflineOrder(orderId);
  assert.ok(record, 'the offline order must still exist after a simulated restart');
  assert.equal(record!.tableNumber, '8');
  assert.equal(record!.status, 'pending_sync');
});

test('markOfflineOrderResolved records the real server order id; resolveOrderIdForReplay then returns it', async () => {
  const { orderId } = await createOfflineOrder({ tableNumber: '9' });
  await markOfflineOrderResolved(orderId, 555);

  const record = await getOfflineOrder(orderId);
  assert.equal(record!.status, 'synced');
  assert.equal(record!.serverOrderId, 555);

  const resolved = await resolveOrderIdForReplay(orderId);
  assert.deepEqual(resolved, { ready: true, orderId: 555 });
});

test('resolveOrderIdForReplay passes a real (non-local) order id straight through unchanged', async () => {
  const resolved = await resolveOrderIdForReplay(123);
  assert.deepEqual(resolved, { ready: true, orderId: 123 });
});

test('resolveOrderIdForReplay reports not-ready for a local order that has not synced yet', async () => {
  const { orderId } = await createOfflineOrder({ tableNumber: '10' });
  const resolved = await resolveOrderIdForReplay(orderId);
  assert.equal(resolved.ready, false);
});

test('markOfflineOrderConflict marks the order CONFLICT and drops every dependent queued action (Section 14: deterministic conflict, not silent loss)', async () => {
  const { orderId } = await createOfflineOrder({ tableNumber: '11' });

  // Simulate items already queued for this local order before the conflict was discovered --
  // exactly what a cashier who kept working offline after opening the table would have done.
  const { enqueueAction } = await import('../outbox');
  await enqueueAction({
    type: 'orders.to-kitchen',
    path: '/orders/to-kitchen/11',
    body: { tableNumber: '11', orderId, quantities: { 1: 2 }, total: 20 },
    label: 'Table #11 -- send to kitchen',
  });

  await markOfflineOrderConflict(orderId, 'Table is no longer available!');

  const record = await getOfflineOrder(orderId);
  assert.equal(record!.status, 'conflict');
  assert.equal(record!.conflictMessage, 'Table is no longer available!');

  const remainingQueued = await getQueuedActions();
  assert.equal(remainingQueued.length, 0, 'the conflicted order\'s dependent kitchen-send action must be dropped, not left to fail forever');

  const resolved = await resolveOrderIdForReplay(orderId);
  assert.deepEqual(resolved, { ready: false, conflict: true });
});

test('two different offline orders (different tables) never interfere with each other\'s resolution or conflict state', async () => {
  const a = await createOfflineOrder({ tableNumber: '12' });
  const b = await createOfflineOrder({ tableNumber: '13' });

  await markOfflineOrderResolved(a.orderId, 701);
  await markOfflineOrderConflict(b.orderId, 'Table 13 was claimed by another terminal.');

  assert.deepEqual(await resolveOrderIdForReplay(a.orderId), { ready: true, orderId: 701 });
  assert.deepEqual(await resolveOrderIdForReplay(b.orderId), { ready: false, conflict: true });
});
