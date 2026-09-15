'use client';

import { useEffect, useState } from 'react';
import { getOrders } from '@/lib/api';
import { OrderRow } from '@/lib/types';

export function useOrders() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [products, setProducts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await getOrders();
        if (!cancelled) {
          setOrders(res.orders);
          setProducts(res.products);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load orders');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { orders, products, loading, error };
}
