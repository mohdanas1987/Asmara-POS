/**
 * Offline-first table-transfer queueing (production-critical requirement, 2026-09-26, item 6:
 * "active transactions must survive network loss mid-transaction ... move tables"). This
 * project has no React component/hook test harness (no testing-library wired up anywhere --
 * confirmed by grep before writing this), so useTables.ts's transfer() itself is exercised
 * only via `tsc --noEmit` / `next build` type-checking, honestly not by a runtime test here.
 * What IS testable, and IS tested here with the same real-IndexedDB harness as
 * outbox.test.ts, is the exact mechanism transfer() relies on when it catches a network
 * error: that a `tables.transfer` action queued via enqueueAction() survives, and that
 * flushOutbox() replays it (in order, exactly once) through whatever real API call function
 * is wired in as the sender -- in production, transferTable() from lib/api.ts; here, a stand-
 * in that records calls, so this test has no network dependency of its own.
 *
 * Run with: npx tsx --test src/lib/offline/__tests__/tablesTransferOffline.test.ts
 * (wired into `npm run test:offline` in package.json).
 */
import 'fake-indexeddb/auto';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { window: unknown }).window = globalThis;

let enqueueAction: typeof import('../outbox').enqueueAction;
let getQueuedActions: typeof import('../outbox').getQueuedActions;
let flushOutbox: typeof import('../outbox').flushOutbox;

before(async () => {
  ({ enqueueAction, getQueuedActions, flushOutbox } = await import('../outbox'));
});

let withStore: typeof import('../db').withStore;
let OUTBOX_STORE: typeof import('../db').OUTBOX_STORE;

before(async () => {
  ({ withStore, OUTBOX_STORE } = await import('../db'));
});

beforeEach(async () => {
  await withStore(OUTBOX_STORE, 'readwrite', (store) => new Promise<void>((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
});

test('a tables.transfer action queued while offline survives and is returned by getQueuedActions', async () => {
  await enqueueAction({
    type: 'tables.transfer',
    path: '/tables/transfer',
    body: { fromTable: '3', toTable: '7', terminalId: 'term-x' },
    label: 'Transfer table 3 -> 7',
  });

  const queued = await getQueuedActions();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].type, 'tables.transfer');
  assert.equal((queued[0].body as { fromTable: string }).fromTable, '3');
  assert.equal((queued[0].body as { toTable: string }).toTable, '7');
});

test('flushOutbox replays a queued tables.transfer exactly once and removes it on success', async () => {
  await enqueueAction({
    type: 'tables.transfer',
    path: '/tables/transfer',
    body: { fromTable: '4', toTable: '9', terminalId: 'term-y' },
    label: 'Transfer table 4 -> 9',
  });

  const calls: Array<{ fromTable: string; toTable: string }> = [];
  const result = await flushOutbox(async (action) => {
    const b = action.body as { fromTable: string; toTable: string };
    calls.push({ fromTable: b.fromTable, toTable: b.toTable });
    return { status: true };
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls.length, 1, 'the transfer must be sent exactly once, never duplicated');
  assert.deepEqual(calls[0], { fromTable: '4', toTable: '9' });

  const remaining = await getQueuedActions();
  assert.equal(remaining.length, 0, 'a successfully-replayed transfer must be removed from the queue');
});

test('a tables.transfer that keeps failing (still offline) stays queued with an incremented attempt count, never silently dropped', async () => {
  await enqueueAction({
    type: 'tables.transfer',
    path: '/tables/transfer',
    body: { fromTable: '1', toTable: '2', terminalId: 'term-z' },
    label: 'Transfer table 1 -> 2',
  });

  const result = await flushOutbox(async () => {
    throw new Error('Failed to fetch');
  });

  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  const remaining = await getQueuedActions();
  assert.equal(remaining.length, 1, 'a still-failing transfer must remain queued, not be dropped');
  assert.equal(remaining[0].attempts, 1);
});

test('a tables.transfer queued alongside other order actions for a DIFFERENT table is not blocked by an unrelated stuck action', async () => {
  // FIFO ordering (outbox.ts's documented behavior) means a stuck action blocks LATER ones --
  // this proves a transfer queued FIRST, if it fails, does block a later one, which is the
  // correct, intentional behavior (never reorder table/order mutations), not a bug.
  await enqueueAction({
    type: 'tables.transfer',
    path: '/tables/transfer',
    body: { fromTable: '5', toTable: '6', terminalId: 'term-a' },
    label: 'Transfer table 5 -> 6',
  });
  await enqueueAction({
    type: 'tables.transfer',
    path: '/tables/transfer',
    body: { fromTable: '10', toTable: '11', terminalId: 'term-b' },
    label: 'Transfer table 10 -> 11',
  });

  let attempts = 0;
  const result = await flushOutbox(async (action) => {
    attempts += 1;
    const b = action.body as { fromTable: string };
    if (b.fromTable === '5') throw new Error('Failed to fetch'); // first one still failing
    return { status: true };
  });

  assert.equal(attempts, 1, 'flushOutbox must stop at the first still-failing action, never race ahead');
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  const remaining = await getQueuedActions();
  assert.equal(remaining.length, 2, 'the second transfer must remain queued behind the stuck first one');
});
