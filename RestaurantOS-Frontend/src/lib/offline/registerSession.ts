'use client';

/**
 * Offline-first register-session durability (production-critical requirement, 2026-09-26:
 * "Asmara POS -- Offline-First Session & Connectivity Requirement"). Before this file
 * existed, `useRegisterSession.ts` held the "is the register open" answer ONLY in React
 * state, repopulated exclusively from a live `/pos/last-active-session` call -- a backend
 * outage, a dropped connection, or a plain page refresh while the backend was briefly
 * unreachable all collapsed straight back to "no session", which surfaced to the cashier as
 * the "Open Session" screen reappearing on an ALREADY-OPEN, actively-selling register. That
 * is the exact defect this file (plus the rewritten useRegisterSession.ts) exists to remove.
 *
 * This is the durable local `RegisterSession` model item 2 of the requirement calls for --
 * an IndexedDB-backed record that is the SOURCE OF TRUTH for "does a local session exist",
 * reconstructable after an app/browser/machine restart, and never dependent on the backend
 * being reachable to answer that question. It holds, at minimum, every field item 2 lists:
 * a local session id, tenant id, terminal id, user id, a role snapshot, the server-assigned
 * session id (once known), opening cash, the opened timestamp, status, a local version
 * counter, a sync state, and the last-synced timestamp.
 *
 * Deliberately a SINGLETON per terminal (one physical register/browser profile can only ever
 * have one register open at a time -- this mirrors the real-world constraint the backend's
 * own CashRegister model assumes), stored under a fixed IndexedDB key so it's trivial to
 * read back on every app start without needing to know a session id in advance.
 */
import { REGISTER_SESSION_STORE, isSupported, requestToPromise, withStore } from './db';

export type RegisterSessionStatus = 'ACTIVE' | 'ACTIVE_OFFLINE' | 'SYNCING';

const STORE_KEY = 'singleton' as const;

export interface RegisterSessionRecord {
  storeKey: typeof STORE_KEY;
  /** Stable local identity for this open register session; survives sync with the server. */
  sessionId: string;
  tenantId: number | null;
  terminalId: string;
  userId: number | null;
  /** Role snapshot at the moment the session was opened (tenant/terminal/permission-bound). */
  role: string | null;
  /** Null until the server has actually acknowledged this session (offline-opened, not yet synced). */
  serverSessionId: number | null;
  openingCash: number;
  openedAt: string; // ISO timestamp
  status: RegisterSessionStatus;
  localVersion: number;
  syncState: 'pending' | 'synced';
  lastSyncedAt: string | null;
  /** Reused as-is on every retry of the offline-open request -- see registerOpenOfflineReplay. */
  idempotencyKey: string;
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function dispatchChanged() {
  // Guarded beyond a plain `typeof window` check: the offline test harness
  // (registerSession.test.ts, matching outbox.test.ts's existing convention) sets
  // `globalThis.window = globalThis` so db.ts's isSupported() check passes, but a bare
  // Node global is not a real EventTarget and has no dispatchEvent -- this must never throw
  // there, and must never throw in a real but unusual embedded webview either.
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new Event('asmara:register-session-changed'));
    } catch {
      // Non-fatal -- worst case, another mounted useRegisterSession() instance just waits
      // for its next poll instead of updating instantly.
    }
  }
}

export async function getLocalRegisterSession(): Promise<RegisterSessionRecord | null> {
  if (!isSupported()) return null;
  try {
    return await withStore<RegisterSessionRecord | null>(REGISTER_SESSION_STORE, 'readonly', async (store) => {
      const result = (await requestToPromise(store.get(STORE_KEY))) as RegisterSessionRecord | undefined;
      return result ?? null;
    });
  } catch {
    return null;
  }
}

async function putRecord(record: RegisterSessionRecord): Promise<void> {
  await withStore<void>(REGISTER_SESSION_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.put(record));
  });
  dispatchChanged();
}

export async function clearLocalRegisterSession(): Promise<void> {
  if (!isSupported()) return;
  await withStore<void>(REGISTER_SESSION_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.delete(STORE_KEY));
  });
  dispatchChanged();
}

/**
 * Opens a register session while offline (or while the backend is unreachable): the record
 * is created immediately, locally, with status ACTIVE_OFFLINE, and the caller is responsible
 * for queueing a `register.open-offline` outbox action (see useOnlineStatus.ts) carrying the
 * same `idempotencyKey` so the eventual server call can never double-create a register row.
 */
export async function openLocalRegisterSessionOffline(input: {
  tenantId: number | null;
  terminalId: string;
  userId: number | null;
  role: string | null;
  openingCash: number;
}): Promise<RegisterSessionRecord> {
  const record: RegisterSessionRecord = {
    storeKey: STORE_KEY,
    sessionId: newId('local-session'),
    tenantId: input.tenantId,
    terminalId: input.terminalId,
    userId: input.userId,
    role: input.role,
    serverSessionId: null,
    openingCash: input.openingCash,
    openedAt: new Date().toISOString(),
    status: 'ACTIVE_OFFLINE',
    localVersion: 1,
    syncState: 'pending',
    lastSyncedAt: null,
    idempotencyKey: newId('register-open'),
  };
  await putRecord(record);
  return record;
}

/** Opened (and confirmed) while online -- the common, happy-path case. */
export async function saveConfirmedRegisterSession(input: {
  tenantId: number | null;
  terminalId: string;
  userId: number | null;
  role: string | null;
  serverSessionId: number;
  openingCash: number;
  openedAt: string;
}): Promise<RegisterSessionRecord> {
  const record: RegisterSessionRecord = {
    storeKey: STORE_KEY,
    sessionId: newId('local-session'),
    tenantId: input.tenantId,
    terminalId: input.terminalId,
    userId: input.userId,
    role: input.role,
    serverSessionId: input.serverSessionId,
    openingCash: input.openingCash,
    openedAt: input.openedAt,
    status: 'ACTIVE',
    localVersion: 1,
    syncState: 'synced',
    lastSyncedAt: new Date().toISOString(),
    idempotencyKey: newId('register-open'),
  };
  await putRecord(record);
  return record;
}

/**
 * Bootstraps a local record from a server session this terminal didn't itself open locally
 * (e.g. a fresh browser profile / cleared IndexedDB, but the same login already has an
 * active register on the server). Never invoked to CLEAR or override an existing local
 * record -- see useRegisterSession.ts's refresh(), which only calls this when no local
 * record exists at all.
 */
export async function adoptServerRegisterSession(input: {
  tenantId: number | null;
  terminalId: string;
  userId: number | null;
  role: string | null;
  serverSessionId: number;
  openingCash: number;
  openedAt: string;
}): Promise<RegisterSessionRecord> {
  return saveConfirmedRegisterSession(input);
}

/** Marks the CURRENT local session (matched by sessionId, never blind) as actively syncing. */
export async function markLocalRegisterSessionSyncing(sessionId: string): Promise<void> {
  const existing = await getLocalRegisterSession();
  if (!existing || existing.sessionId !== sessionId) return;
  await putRecord({ ...existing, status: 'SYNCING' });
}

/** The offline-opened session's create request finally reached the server and succeeded. */
export async function markLocalRegisterSessionSynced(sessionId: string, serverSessionId: number): Promise<void> {
  const existing = await getLocalRegisterSession();
  if (!existing || existing.sessionId !== sessionId) return;
  await putRecord({
    ...existing,
    serverSessionId,
    status: 'ACTIVE',
    syncState: 'synced',
    lastSyncedAt: new Date().toISOString(),
    localVersion: existing.localVersion + 1,
  });
}

/** Still offline (or the sync attempt failed with a network error) -- stays queued, stays usable. */
export async function markLocalRegisterSessionOffline(sessionId: string): Promise<void> {
  const existing = await getLocalRegisterSession();
  if (!existing || existing.sessionId !== sessionId) return;
  if (existing.status === 'SYNCING') {
    await putRecord({ ...existing, status: 'ACTIVE_OFFLINE' });
  }
}

/** A previously-synced, already-online session confirmed reachable again after a blip. */
export async function markLocalRegisterSessionReconciled(sessionId: string): Promise<void> {
  const existing = await getLocalRegisterSession();
  if (!existing || existing.sessionId !== sessionId) return;
  if (existing.status !== 'ACTIVE' || existing.syncState !== 'synced') {
    await putRecord({
      ...existing,
      status: 'ACTIVE',
      syncState: 'synced',
      lastSyncedAt: new Date().toISOString(),
    });
  }
}

/** Connectivity dropped after a previously-confirmed session -- mark it unconfirmed, never clear it. */
export async function markLocalRegisterSessionUnreachable(sessionId: string): Promise<void> {
  const existing = await getLocalRegisterSession();
  if (!existing || existing.sessionId !== sessionId) return;
  if (existing.status === 'ACTIVE') {
    await putRecord({ ...existing, status: 'ACTIVE_OFFLINE' });
  }
}
