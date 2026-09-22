'use client';

/**
 * Read-through cache for reference data the POS screen needs to stay usable when the
 * network drops (see db.ts's file-level comment for the full offline-first scope this is
 * part of). Every successful network fetch refreshes the cached copy; a failed fetch falls
 * back to whatever was last cached, so the menu/tables/tax list a cashier is looking at
 * doesn't just disappear mid-shift because the wifi blipped.
 */
import { CACHE_STORE, isSupported, requestToPromise, withStore } from './db';

interface CacheEntry<T> {
  key: string;
  value: T;
  cachedAt: string;
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  if (!isSupported()) return;
  try {
    await withStore<void>(CACHE_STORE, 'readwrite', async (store) => {
      await requestToPromise(store.put({ key, value, cachedAt: new Date().toISOString() } as CacheEntry<T>));
    });
  } catch {
    // Caching is a best-effort convenience -- a full/blocked IndexedDB must never break the
    // page that's trying to use fresh, just-fetched data.
  }
}

export async function cacheGet<T>(key: string): Promise<{ value: T; cachedAt: string } | null> {
  if (!isSupported()) return null;
  try {
    return await withStore<{ value: T; cachedAt: string } | null>(CACHE_STORE, 'readonly', async (store) => {
      const entry = (await requestToPromise(store.get(key))) as CacheEntry<T> | undefined;
      return entry ? { value: entry.value, cachedAt: entry.cachedAt } : null;
    });
  } catch {
    return null;
  }
}

/**
 * Fetches via `loader`; on success, caches and returns the fresh value. On failure (offline,
 * or the request errors), returns the last cached value instead of throwing -- with
 * `stale: true` so the caller can show "showing cached data from Xm ago" rather than
 * pretending it's live. Only re-throws if there's no cached fallback at all (first-ever
 * load with no network -- nothing honest to show).
 */
export async function loadWithCache<T>(
  key: string,
  loader: () => Promise<T>
): Promise<{ value: T; stale: boolean; cachedAt: string | null }> {
  try {
    const value = await loader();
    await cacheSet(key, value);
    return { value, stale: false, cachedAt: new Date().toISOString() };
  } catch (err) {
    const cached = await cacheGet<T>(key);
    if (cached) {
      return { value: cached.value, stale: true, cachedAt: cached.cachedAt };
    }
    throw err;
  }
}
