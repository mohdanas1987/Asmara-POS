'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { MenuCategory, MenuItem } from '@/lib/types';
import { loadWithCache } from '@/lib/offline/cache';

/**
 * Offline-first POS operation (CTO forensic audit 2026-09-21, P0 -- "menu/orders/tables are
 * unavailable if the network drops"): falls back to the last successfully-fetched menu
 * (cached in IndexedDB, see lib/offline/cache.ts) instead of leaving the POS screen blank
 * when a fetch fails. `stale` tells the caller the data being shown might be a bit old, for
 * an honest "showing cached menu" indicator rather than silently pretending it's live.
 */
export function useMenu() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [catResult, itemResult] = await Promise.all([
          loadWithCache('menu.categories', () => apiFetch<{ status: boolean; categories: MenuCategory[] }>('/menu')),
          loadWithCache('menu.items', () => apiFetch<{ status: boolean; products: MenuItem[] }>('/items')),
        ]);
        if (!cancelled) {
          setCategories(catResult.value.categories);
          setItems(itemResult.value.products);
          setStale(catResult.stale || itemResult.stale);
        }
      } catch (err) {
        // loadWithCache only re-throws when there's no cached fallback at all (first-ever
        // load with no network) -- a real, honest failure, not something to paper over.
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load menu');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { categories, items, loading, error, stale };
}
