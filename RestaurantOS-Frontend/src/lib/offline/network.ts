'use client';

/**
 * Distinguishes "the network is actually down" from "the server responded with an error" --
 * only the former should ever be queued for later retry. A 400/403/500 is the backend
 * telling us something real is wrong with THIS request; queuing and blindly replaying that
 * later would just repeat the same rejection (or worse, replay a request the cashier has
 * since corrected). `apiFetch` (lib/api.ts) turns a non-ok HTTP response into a plain Error
 * with the server's own message -- those never reach here as network errors. A network
 * failure surfaces as the browser's fetch() call itself rejecting, before any response
 * exists at all.
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true; // fetch()'s own "Failed to fetch" / "NetworkError"
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed');
  }
  return false;
}
