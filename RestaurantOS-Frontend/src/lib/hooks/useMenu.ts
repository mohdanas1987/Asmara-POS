'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { MenuCategory, MenuItem } from '@/lib/types';

export function useMenu() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [catRes, itemRes] = await Promise.all([
          apiFetch<{ status: boolean; categories: MenuCategory[] }>('/menu'),
          apiFetch<{ status: boolean; products: MenuItem[] }>('/items'),
        ]);
        if (!cancelled) {
          setCategories(catRes.categories);
          setItems(itemRes.products);
        }
      } catch (err) {
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

  return { categories, items, loading, error };
}
