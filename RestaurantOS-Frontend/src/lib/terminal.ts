/**
 * Offline sync: wire frontend to the existing backend engine (task #47). The backend has
 * tracked terminals as a first-class concept (POST /sync/terminals/register, GET
 * /sync/terminals) since the offline-first foundation was built (task #32) -- every write the
 * server records via services/offline/syncLog.js takes an optional `terminal_id` (see e.g.
 * routes/tables.js's /transfer), but nothing in the frontend has ever generated or sent one.
 *
 * This is a stable, random, per-browser-profile id -- not tied to hardware -- generated once
 * and kept in localStorage. Good enough to tell "the front counter iPad" apart from "the bar
 * terminal" in the terminals list; a wipe-and-reinstall gets a fresh id, same as any other
 * browser-storage-based device identity.
 */
const TERMINAL_ID_KEY = 'restaurantos_terminal_id';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older WebViews without crypto.randomUUID.
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getTerminalId(): string {
  if (typeof window === 'undefined') return generateId();
  try {
    let id = window.localStorage.getItem(TERMINAL_ID_KEY);
    if (!id) {
      id = generateId();
      window.localStorage.setItem(TERMINAL_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage unavailable -- fall back to a fresh id for this call. Sync/registration
    // still works, it just won't persist across reloads (same degraded-but-functional
    // fallback pattern as the Sidebar's collapse-state persistence).
    return generateId();
  }
}
