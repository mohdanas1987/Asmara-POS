'use client';

import { useCallback, useMemo, useState } from 'react';
import { CartLine, MenuItem } from '@/lib/types';

const TAX_RATE = 0.09; // BTW low rate default; real rate comes from the tax module per-item later.

// Every cart line gets a stable, unique key -- plain (non-weight) items still merge into a
// single line per product (matches the original behavior), but a weight-based item gets a
// brand new line every time it's weighed, since two separate weighings of "Loose Tomatoes"
// are two different real-world amounts and must not silently merge into one quantity.
let lineKeySeq = 0;
function nextWeightLineKey(itemId: number) {
  lineKeySeq += 1;
  return `weight-${itemId}-${lineKeySeq}`;
}

function lineKeyFor(line: CartLine): string {
  return line.lineKey ?? String(line.item.id);
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);

  const addItem = useCallback((item: MenuItem) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.item.id === item.id && !l.weight);
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { item, qty: 1, lineKey: String(item.id) }];
    });
  }, []);

  // For sold_by_weight items: `weight` is the reading (in item.weight_unit) this specific
  // line was priced at. Line price = item.price (per unit) × weight, computed in `subtotal`
  // below -- NOT re-derived from qty, which stays 1 for these lines (one weighing = one line).
  const addWeighedItem = useCallback((item: MenuItem, weight: number) => {
    setLines((prev) => [...prev, { item, qty: 1, weight, lineKey: nextWeightLineKey(item.id) }]);
  }, []);

  const setQty = useCallback((lineKey: string, qty: number) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => lineKeyFor(l) !== lineKey)
        : prev.map((l) => (lineKeyFor(l) === lineKey ? { ...l, qty } : l))
    );
  }, []);

  const removeItem = useCallback((lineKey: string) => {
    setLines((prev) => prev.filter((l) => lineKeyFor(l) !== lineKey));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  // Preloads the cart from an existing order's stored {productId: qty} map -- used when
  // resuming a table that already has items sent to kitchen (see /pos?table=&order=).
  // Weight-based lines can't be reconstructed from a plain qty map (the original weight
  // reading isn't stored there), so this only restores plain quantity lines; that matches
  // what the backend's own to-kitchen diffing logic tracks anyway.
  const loadFromQuantities = useCallback((quantities: Record<string, number> | undefined, items: MenuItem[]) => {
    if (!quantities || Object.keys(quantities).length === 0) {
      setLines([]);
      return;
    }
    const byId = new Map(items.map((it) => [it.id, it]));
    const restored: CartLine[] = [];
    Object.entries(quantities).forEach(([idStr, qty]) => {
      const item = byId.get(Number(idStr));
      if (item && qty > 0) restored.push({ item, qty, lineKey: idStr });
    });
    setLines(restored);
  }, []);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.item.price * (l.weight ?? l.qty), 0),
    [lines]
  );
  const tax = useMemo(() => subtotal * TAX_RATE, [subtotal]);
  const total = useMemo(() => subtotal + tax, [subtotal, tax]);

  return { lines, addItem, addWeighedItem, setQty, removeItem, clear, loadFromQuantities, subtotal, tax, total };
}
