'use client';

import { useCallback, useMemo, useState } from 'react';
import { CartLine, MenuItem, SelectedModifier } from '@/lib/types';
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

// Every cart line gets a stable, unique key -- plain (non-weight, non-modifier) items still
// merge into a single line per product (matches the original behavior), but a weight-based
// item gets a brand new line every time it's weighed (two weighings of "Loose Tomatoes" are
// two different real-world amounts), and an item with a DIFFERENT modifier selection also
// gets its own line -- "Burger (no onions)" and "Burger (extra cheese)" must never silently
// collapse into one quantity, since they're different products from the kitchen's point of
// view. Two additions of the SAME modifier selection still merge, matching the plain-item
// behavior.
let lineKeySeq = 0;
function nextWeightLineKey(itemId: number) {
  lineKeySeq += 1;
  return `weight-${itemId}-${lineKeySeq}`;
}
function nextModifierLineKey(itemId: number) {
  lineKeySeq += 1;
  return `mod-${itemId}-${lineKeySeq}`;
}

function lineKeyFor(line: CartLine): string {
  return line.lineKey ?? String(line.item.id);
}

// A order-independent signature of a modifier selection, used to decide whether two
// additions of the same product should merge into one line. Empty/undefined selections
// (the overwhelming majority of items, which have no modifiers at all) all produce the
// same empty signature, so existing no-modifier behavior is completely unchanged.
function modifiersSignature(modifiers: SelectedModifier[] | undefined): string {
  if (!modifiers || modifiers.length === 0) return '';
  return modifiers
    .map((m) => m.id)
    .sort((a, b) => a - b)
    .join(',');
}

function modifiersDelta(modifiers: SelectedModifier[] | undefined): number {
  if (!modifiers || modifiers.length === 0) return 0;
  return modifiers.reduce((sum, m) => sum + (Number(m.price_delta) || 0), 0);
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);

  const addItem = useCallback((item: MenuItem, modifiers?: SelectedModifier[]) => {
    const sig = modifiersSignature(modifiers);
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.item.id === item.id && !l.weight && modifiersSignature(l.modifiers) === sig
      );
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      const lineKey = sig ? nextModifierLineKey(item.id) : String(item.id);
      return [...prev, { item, qty: 1, modifiers, lineKey }];
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
  // Weight-based and modifier-selected lines can't be reconstructed from a plain qty map
  // (neither the weight reading nor the modifier selection is stored there), so this only
  // restores plain quantity lines; that matches what the backend's own to-kitchen diffing
  // logic tracks anyway. Use `loadFromLines` instead when full per-line detail (including
  // modifiers) is available -- see its own comment below.
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

  // Preloads the cart from the richer `data.lines` detail persisted alongside the plain
  // `data.quantity` map (see lib/api.ts sendTableOrderToKitchen) -- this DOES preserve
  // modifier selections (and, going forward, could preserve weight readings too), unlike
  // `loadFromQuantities` above which only has the flat product-id/qty map to work from.
  // Falls back to `loadFromQuantities`'s behavior automatically if `savedLines` is absent,
  // since callers pass both and this is only used when the richer detail actually exists.
  const loadFromLines = useCallback(
    (
      savedLines: Array<{ itemId: number; qty: number; modifiers?: SelectedModifier[] }>,
      items: MenuItem[]
    ) => {
      const byId = new Map(items.map((it) => [it.id, it]));
      const restored: CartLine[] = [];
      savedLines.forEach((sl) => {
        const item = byId.get(sl.itemId);
        if (!item || sl.qty <= 0) return;
        const sig = modifiersSignature(sl.modifiers);
        const lineKey = sig ? nextModifierLineKey(item.id) : String(item.id);
        restored.push({ item, qty: sl.qty, modifiers: sl.modifiers, lineKey });
      });
      setLines(restored);
    },
    []
  );

  // Owner-reported bug: a menu item with a malformed price string (e.g. a legacy dual
  // "22.00 /24.00" combo price never split into two real items) made `item.price * qty`
  // evaluate to NaN -- and because this is a SUM, adding that one NaN line silently
  // poisoned the entire cart's `total`/`tax`/`subtotal` to NaN, not just that line's own
  // display. `parsePrice` (lib/tax.ts) already existed for exactly this and falls back to
  // 0 for anything it can't parse -- using it here instead of a bare arithmetic string
  // coercion means one bad menu item can no longer break every other item's checkout.
  // `total` is the real, VAT-inclusive amount actually charged -- exactly the sum of each
  // line's (already-inclusive) price, PLUS any selected modifiers' price_delta (also
  // VAT-inclusive, same as the base item price), unchanged from before this fix for lines
  // with no modifiers. `tax` and `subtotal` are purely a breakdown of that same total for
  // the receipt, never added to it.
  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const unitPrice = parsePrice(l.item.price) + modifiersDelta(l.modifiers);
        return sum + unitPrice * (l.weight ?? l.qty);
      }, 0),
    [lines]
  );
  const tax = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const unitPrice = parsePrice(l.item.price) + modifiersDelta(l.modifiers);
        const lineTotal = unitPrice * (l.weight ?? l.qty);
        return sum + calculateInclusiveTax(lineTotal, l.item.tax);
      }, 0),
    [lines]
  );
  const subtotal = useMemo(() => total - tax, [total, tax]);

  return {
    lines,
    addItem,
    addWeighedItem,
    setQty,
    removeItem,
    clear,
    loadFromQuantities,
    loadFromLines,
    subtotal,
    tax,
    total,
  };
}
