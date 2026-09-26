/**
 * Offline-first register-session durability tests (production-critical requirement,
 * 2026-09-26: "Asmara POS -- Offline-First Session & Connectivity Requirement"). Proves, with
 * real IndexedDB (via fake-indexeddb, same harness as outbox.test.ts/offlineOrders.test.ts):
 *
 *   - a register opened while online is recorded locally and reconstructable after a
 *     simulated app restart;
 *   - a register opened while offline is created LOCALLY, immediately, with status
 *     ACTIVE_OFFLINE, never blocking on the network;
 *   - a fetch failure NEVER clears or downgrades a local session to "no session" -- the
 *     single most important guarantee in the whole requirement (item 1);
 *   - the SYNCING -> ACTIVE transition on a successful offline-open replay, keyed by
 *     sessionId so a stale/foreign patch can never corrupt a different, newer session;
 *   - a second replay attempt with the same local sessionId after it's already synced is a
 *     safe no-op (idempotent double-replay never regresses a synced session back to pending).
 *
 * Run with: npx tsx --test src/lib/offline/__tests__/registerSession.test.ts
 * (wired into `npm run test:offline` in package.json).
 */
import 'fake-indexeddb/auto';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { window: unknown }).window = globalThis;

let getLocalRegisterSession: typeof import('../registerSession').getLocalRegisterSession;
let openLocalRegisterSessionOffline: typeof import('../registerSession').openLocalRegisterSessionOffline;
let saveConfirmedRegisterSession: typeof import('../registerSession').saveConfirmedRegisterSession;
let adoptServerRegisterSession: typeof import('../registerSession').adoptServerRegisterSession;
let markLocalRegisterSessionSyncing: typeof import('../registerSession').markLocalRegisterSessionSyncing;
let markLocalRegisterSessionSynced: typeof import('../registerSession').markLocalRegisterSessionSynced;
let markLocalRegisterSessionOffline: typeof import('../registerSession').markLocalRegisterSessionOffline;
let markLocalRegisterSessionReconciled: typeof import('../registerSession').markLocalRegisterSessionReconciled;
let markLocalRegisterSessionUnreachable: typeof import('../registerSession').markLocalRegisterSessionUnreachable;
let clearLocalRegisterSession: typeof import('../registerSession').clearLocalRegisterSession;

before(async () => {
  ({
    getLocalRegisterSession,
    openLocalRegisterSessionOffline,
    saveConfirmedRegisterSession,
    adoptServerRegisterSession,
    markLocalRegisterSessionSyncing,
    markLocalRegisterSessionSynced,
    markLocalRegisterSessionOffline,
    markLocalRegisterSessionReconciled,
    markLocalRegisterSessionUnreachable,
    clearLocalRegisterSession,
  } = await import('../registerSession'));
});

let withStore: typeof import('../db').withStore;
let REGISTER_SESSION_STORE: typeof import('../db').REGISTER_SESSION_STORE;

before(async () => {
  ({ withStore, REGISTER_SESSION_STORE } = await import('../db'));
});

beforeEach(async () => {
  await withStore(REGISTER_SESSION_STORE, 'readwrite', (store) => new Promise<void>((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
});

test('saveConfirmedRegisterSession (the online-open happy path) is readable back via getLocalRegisterSession', async () => {
  const record = await saveConfirmedRegisterSession({
    tenantId: 1,
    terminalId: 'term-1',
    userId: 7,
    role: 'admin',
    serverSessionId: 42,
    openingCash: 200,
    openedAt: '2026-09-26T08:00:00.000Z',
  });
  assert.equal(record.status, 'ACTIVE');
  assert.equal(record.syncState, 'synced');

  const local = await getLocalRegisterSession();
  assert.ok(local);
  assert.equal(local!.serverSessionId, 42);
  assert.equal(local!.openingCash, 200);
});

test('openLocalRegisterSessionOffline creates an ACTIVE_OFFLINE record with no serverSessionId, without any network call', async () => {
  const record = await openLocalRegisterSessionOffline({
    tenantId: 1,
    terminalId: 'term-2',
    userId: 3,
    role: 'cashier',
    openingCash: 150,
  });
  assert.equal(record.status, 'ACTIVE_OFFLINE');
  assert.equal(record.serverSessionId, null);
  assert.equal(record.syncState, 'pending');
  assert.ok(record.idempotencyKey, 'must carry an idempotency key for the eventual sync replay');

  const local = await getLocalRegisterSession();
  assert.equal(local!.sessionId, record.sessionId);
});

test('data survives a simulated "app restart" (fresh module import against the same underlying IndexedDB)', async () => {
  const record = await openLocalRegisterSessionOffline({
    tenantId: 1,
    terminalId: 'term-restart',
    userId: 9,
    role: 'manager',
    openingCash: 300,
  });

  delete require.cache[require.resolve('../registerSession')];
  delete require.cache[require.resolve('../db')];
  const reloaded = await import('../registerSession');

  const restored = await reloaded.getLocalRegisterSession();
  assert.ok(restored, 'the register session must still exist after a simulated restart');
  assert.equal(restored!.sessionId, record.sessionId);
  assert.equal(restored!.status, 'ACTIVE_OFFLINE');
  assert.equal(restored!.openingCash, 300);
});

test('a backend-unreachable error NEVER clears or downgrades an existing local session to "no session" (item 1, the core requirement)', async () => {
  await saveConfirmedRegisterSession({
    tenantId: 1,
    terminalId: 'term-3',
    userId: 5,
    role: 'admin',
    serverSessionId: 99,
    openingCash: 100,
    openedAt: '2026-09-26T09:00:00.000Z',
  });
  const before1 = await getLocalRegisterSession();
  assert.equal(before1!.status, 'ACTIVE');

  // Simulates useRegisterSession.ts's refresh() catching a network error: the ONLY allowed
  // reaction is ACTIVE -> ACTIVE_OFFLINE, never a clear.
  await markLocalRegisterSessionUnreachable(before1!.sessionId);

  const after = await getLocalRegisterSession();
  assert.ok(after, 'the local session record must never be deleted by a mere fetch failure');
  assert.equal(after!.status, 'ACTIVE_OFFLINE');
  assert.equal(after!.serverSessionId, 99, 'the server session id already known must be preserved, not lost');
});

test('ACTIVE_OFFLINE -> reconciled back to ACTIVE once the same server session id is confirmed reachable again', async () => {
  await saveConfirmedRegisterSession({
    tenantId: 1,
    terminalId: 'term-4',
    userId: 5,
    role: 'admin',
    serverSessionId: 101,
    openingCash: 100,
    openedAt: '2026-09-26T09:00:00.000Z',
  });
  const record = await getLocalRegisterSession();
  await markLocalRegisterSessionUnreachable(record!.sessionId);
  assert.equal((await getLocalRegisterSession())!.status, 'ACTIVE_OFFLINE');

  await markLocalRegisterSessionReconciled(record!.sessionId);
  const reconciled = await getLocalRegisterSession();
  assert.equal(reconciled!.status, 'ACTIVE');
  assert.equal(reconciled!.syncState, 'synced');
});

test('offline-open sync flow: SYNCING then ACTIVE with the real serverSessionId attached, matched strictly by sessionId', async () => {
  const record = await openLocalRegisterSessionOffline({
    tenantId: 2,
    terminalId: 'term-5',
    userId: 11,
    role: 'cashier',
    openingCash: 250,
  });

  await markLocalRegisterSessionSyncing(record.sessionId);
  assert.equal((await getLocalRegisterSession())!.status, 'SYNCING');

  await markLocalRegisterSessionSynced(record.sessionId, 777);
  const synced = await getLocalRegisterSession();
  assert.equal(synced!.status, 'ACTIVE');
  assert.equal(synced!.syncState, 'synced');
  assert.equal(synced!.serverSessionId, 777);
  assert.equal(synced!.localVersion, 2, 'localVersion must increment on the sync-confirming write');
});

test('a stale/foreign sessionId can never patch a DIFFERENT, newer local session (protects against a lagging queued replay)', async () => {
  const first = await openLocalRegisterSessionOffline({
    tenantId: 1,
    terminalId: 'term-6',
    userId: 1,
    role: 'admin',
    openingCash: 50,
  });
  // Simulate the terminal moving on to a brand-new session (e.g. IndexedDB was cleared and a
  // fresh one opened) before the FIRST one's queued sync ever got a chance to run.
  await clearLocalRegisterSession();
  const second = await saveConfirmedRegisterSession({
    tenantId: 1,
    terminalId: 'term-6',
    userId: 1,
    role: 'admin',
    serverSessionId: 555,
    openingCash: 75,
    openedAt: '2026-09-26T10:00:00.000Z',
  });

  // A late-arriving sync attempt for the FIRST (now-abandoned) session must be a no-op.
  await markLocalRegisterSessionSynced(first.sessionId, 999);

  const current = await getLocalRegisterSession();
  assert.equal(current!.sessionId, second.sessionId, 'the current session must be untouched by a stale replay');
  assert.equal(current!.serverSessionId, 555, 'must never be overwritten by an unrelated sessionId');
});

test('idempotent double-replay: syncing an already-synced session a second time never regresses it back to pending', async () => {
  const record = await openLocalRegisterSessionOffline({
    tenantId: 1,
    terminalId: 'term-7',
    userId: 4,
    role: 'admin',
    openingCash: 60,
  });
  await markLocalRegisterSessionSyncing(record.sessionId);
  await markLocalRegisterSessionSynced(record.sessionId, 321);

  // A second, redundant replay of the exact same idempotency key (e.g. the 'online' event
  // fired twice) reaching this point again must not disturb an already-synced session.
  await markLocalRegisterSessionSyncing(record.sessionId);
  await markLocalRegisterSessionSynced(record.sessionId, 321);

  const finalRecord = await getLocalRegisterSession();
  assert.equal(finalRecord!.status, 'ACTIVE');
  assert.equal(finalRecord!.serverSessionId, 321);
});

test('markLocalRegisterSessionOffline only downgrades from SYNCING, never silently reopens a session that was never syncing', async () => {
  const record = await saveConfirmedRegisterSession({
    tenantId: 1,
    terminalId: 'term-8',
    userId: 2,
    role: 'admin',
    serverSessionId: 44,
    openingCash: 80,
    openedAt: '2026-09-26T11:00:00.000Z',
  });
  await markLocalRegisterSessionOffline(record.sessionId);
  // Not SYNCING -> no-op, stays ACTIVE.
  assert.equal((await getLocalRegisterSession())!.status, 'ACTIVE');
});

test('adoptServerRegisterSession bootstraps local truth for a fresh terminal that already has an active login-scoped session server-side', async () => {
  assert.equal(await getLocalRegisterSession(), null);
  const bootstrapped = await adoptServerRegisterSession({
    tenantId: 3,
    terminalId: 'term-9',
    userId: 20,
    role: 'admin',
    serverSessionId: 909,
    openingCash: 500,
    openedAt: '2026-09-26T07:00:00.000Z',
  });
  assert.equal(bootstrapped.status, 'ACTIVE');
  const local = await getLocalRegisterSession();
  assert.equal(local!.serverSessionId, 909);
});
