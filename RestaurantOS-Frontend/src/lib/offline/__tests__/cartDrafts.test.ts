/**
 * Offline restart recovery (CTO remediation doc, Section 5): real, executable tests for
 * lib/offline/cartDrafts.ts, using fake-indexeddb for a real IndexedDB implementation in Node
 * (same approach as outbox.test.ts / offlineOrders.test.ts).
 *
 * Run with: npx tsx --test src/lib/offline/__tests__/cartDrafts.test.ts
 * (wired into `npm run test:offline` in package.json).
 */
import 'fake-indexeddb/auto';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { CartLine, MenuItem } from '../../types';

(globalThis as unknown as { window: unknown }).window = globalThis;

let saveCartDraft: typeof import('../cartDrafts').saveCartDraft;
let getCartDraft: typeof import('../cartDrafts').getCartDraft;
let clearCartDraft: typeof import('../cartDrafts').clearCartDraft;

let withStore: typeof import('../db').withStore;
let CACHE_STORE: typeof import('../db').CACHE_STORE;
let OUTBOX_STORE: typeof import('../db').OUTBOX_STORE;
let OFFLINE_ORDERS_STORE: typeof import('../db').OFFLINE_ORDERS_STORE;
let CART_DRAFTS_STORE: typeof import('../db').CART_DRAFTS_STORE;

before(async () => {
  ({ saveCartDraft, getCartDraft, clearCartDraft } = await import('../cartDrafts'));
  ({ withStore, CACHE_STORE, OUTBOX_STORE, OFFLINE_ORDERS_STORE, CART_DRAFTS_STORE } = await import('../db'));
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
  await clearStore(CART_DRAFTS_STORE);
});

function fakeItem(id: number, overrides?: Partial<MenuItem>): MenuItem {
  return { id, name: `Item ${id}`, price: '10.00', category_id: 1, tax: 9, ...overrides } as MenuItem;
}

test('saveCartDraft then getCartDraft round-trips the full cart, including modifiers and weight', async () => {
  const lines: CartLine[] = [
    { item: fakeItem(1), qty: 2, lineKey: '1' },
    {
      item: fakeItem(2),
      qty: 1,
      modifiers: [{ id: 5, name: 'Extra cheese', price_delta: 1.5 }],
      lineKey: 'mod-2-1',
    },
    { item: fakeItem(3), qty: 1, weight: 0.75, lineKey: 'weight-3-1' },
  ];

  await saveCartDraft('local-abc', lines);
  const restored = await getCartDraft('local-abc');

  assert.ok(restored);
  assert.equal(restored!.length, 3);
  assert.equal(restored![1].modifiers?.[0].name, 'Extra cheese');
  assert.equal(restored![2].weight, 0.75);
});

test('data survives a simulated "app restart" (fresh module import against the same underlying IndexedDB)', async () => {
  const lines: CartLine[] = [{ item: fakeItem(9), qty: 5, lineKey: '9' }];
  await saveCartDraft('local-restart-test', lines);

  delete require.cache[require.resolve('../cartDrafts')];
  delete require.cache[require.resolve('../db')];
  const reloaded = await import('../cartDrafts');

  const restored = await reloaded.getCartDraft('local-restart-test');
  assert.ok(restored, 'the draft must still exist after a simulated restart');
  assert.equal(restored![0].qty, 5, 'the exact quantity added before "restart" must be preserved');
});

test('saveCartDraft overwrites the previous draft for the same order (last-write-wins for this one terminal)', async () => {
  await saveCartDraft('local-xyz', [{ item: fakeItem(1), qty: 1, lineKey: '1' }]);
  await saveCartDraft('local-xyz', [
    { item: fakeItem(1), qty: 1, lineKey: '1' },
    { item: fakeItem(2), qty: 3, lineKey: '2' },
  ]);

  const restored = await getCartDraft('local-xyz');
  assert.equal(restored!.length, 2);
  assert.equal(restored![1].qty, 3);
});

test('clearCartDraft removes the draft; getCartDraft then returns undefined', async () => {
  await saveCartDraft('local-to-clear', [{ item: fakeItem(1), qty: 1, lineKey: '1' }]);
  assert.ok(await getCartDraft('local-to-clear'));

  await clearCartDraft('local-to-clear');
  assert.equal(await getCartDraft('local-to-clear'), undefined);
});

test('getCartDraft for an order with no saved draft at all returns undefined, never throws', async () => {
  const restored = await getCartDraft('never-saved-order-id');
  assert.equal(restored, undefined);
});

test('drafts for two different orders never interfere with each other', async () => {
  await saveCartDraft('order-a', [{ item: fakeItem(1), qty: 1, lineKey: '1' }]);
  await saveCartDraft('order-b', [{ item: fakeItem(2), qty: 9, lineKey: '2' }]);

  const a = await getCartDraft('order-a');
  const b = await getCartDraft('order-b');
  assert.equal(a![0].qty, 1);
  assert.equal(b![0].qty, 9);

  await clearCartDraft('order-a');
  assert.equal(await getCartDraft('order-a'), undefined);
  assert.ok(await getCartDraft('order-b'), 'clearing order-a\'s draft must not touch order-b\'s');
});

test('a numeric (real, non-local) order id and its string form key to the same draft', async () => {
  await saveCartDraft(42, [{ item: fakeItem(1), qty: 1, lineKey: '1' }]);
  const restored = await getCartDraft('42');
  assert.ok(restored, 'a numeric order id must be readable back via its string form (and vice versa)');
});
