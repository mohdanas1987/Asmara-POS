'use client';

import { useCallback, useMemo, useState } from 'react';
import { CartLine, MenuItem } from '@/lib/types';
import { calculateInclusiveTax, parsePrice } from '@/lib/tax';

// CRITICAL BUG FIX (project audit 2026-09-16, live at the POS checkout -- found from a
// direct user report: "tax is still being calculated in POS billing"): this used to hardcode
// a flat 9% and ADD it on top of the cart's line prices ("total = subtotal + subtotal*0.09"),
// then charge that inflated `total` for real via chargeOrder(). Every item's `price` in this
// app is already VAT-inclusive (Dutch pricing law -- see backend utils/tax.js and this same
// bug's other half, already fixed there), so this was overcharging every single sale by
// ~9% on top of the correct, already-inclusive price -- a real money bug, not just a display
// one. Fixed to break the existing (unchanged) line-price total down into its net/VAT
// components using each item's OWN configured tax rate, instead of inventing a second tax
// on top of prices that already contain it.

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

  // Owner-reported bug: a menu item with a malformed price string (e.g. a legacy dual
  // "22.00 /24.00" combo price never split into two real items) made `item.price * qty`
  // evaluate to NaN -- and because this is a SUM, adding that one NaN line silently
  // poisoned the entire cart's `total`/`tax`/`subtotal` to NaN, not just that line's own
  // display. `parsePrice` (lib/tax.ts) already existed for exactly this and falls back to
  // 0 for anything it can't parse -- using it here instead of a bare arithmetic string
  // coercion means one bad menu item can no longer break every other item's checkout.
  // `total` is the real, VAT-inclusive amount actually charged -- exactly the sum of each
  // line's (already-inclusive) price, unchanged from before this fix. `tax` and `subtotal`
  // are purely a breakdown of that same total for the receipt, never added to it.
  const total = useMemo(
    () => lines.reduce((sum, l) => sum + parsePrice(l.item.price) * (l.weight ?? l.qty), 0),
    [lines]
  );
  const tax = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const lineTotal = parsePrice(l.item.price) * (l.weight ?? l.qty);
        return sum + calculateInclusiveTax(lineTotal, l.item.tax);
      }, 0),
    [lines]
  );
  const subtotal = useMemo(() => total - tax, [total, tax]);

  return { lines, addItem, addWeighedItem, setQty, removeItem, clear, loadFromQuantities, subtotal, tax, total };
}
