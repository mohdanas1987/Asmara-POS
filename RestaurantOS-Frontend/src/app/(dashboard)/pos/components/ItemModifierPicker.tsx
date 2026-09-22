'use client';

import { useEffect, useMemo, useState } from 'react';
import { MenuItem, ModifierGroup, SelectedModifier } from '@/lib/types';
import { getItemModifierGroups } from '@/lib/api';
import { parsePrice } from '@/lib/tax';
import { Button } from '@/components/ui/Button';

/**
 * Shown when the cashier taps a product that has modifier groups configured (routes/modifiers.js
 * / migration 0015). Mirrors WeighItemModal's "modal before add-to-cart, calls onConfirm" shape.
 * Fetches groups live on open rather than requiring the caller to have pre-loaded them, since
 * most menu items have none and pre-fetching for every item on the grid would be wasteful.
 *
 * Selection rules enforced here (mirrors the backend's own group config, though the backend
 * does not currently re-validate this at order time -- see the CTO gap notes: this is
 * client-side enforcement only, matching how weight/qty entry is also client-trusted today):
 *  - selection_type 'single' -> radio buttons, exactly one choice if required, zero-or-one if not.
 *  - selection_type 'multiple' -> checkboxes, between min_select and max_select (max_select
 *    null means unlimited).
 */
export function ItemModifierPicker({
  item,
  onClose,
  onConfirm,
}: {
  item: MenuItem;
  onClose: () => void;
  onConfirm: (modifiers: SelectedModifier[]) => void;
}) {
  const [groups, setGroups] = useState<ModifierGroup[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // selections[groupId] = Set of modifier ids chosen in that group
  const [selections, setSelections] = useState<Record<number, Set<number>>>({});

  useEffect(() => {
    let cancelled = false;
    getItemModifierGroups(item.id)
      .then((res) => {
        if (cancelled) return;
        setGroups(res.groups || []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  function toggle(group: ModifierGroup, modifierId: number) {
    setSelections((prev) => {
      const current = new Set(prev[group.id] ?? []);
      const isMultiple = group.selection_type === 'multiple';
      if (isMultiple) {
        if (current.has(modifierId)) {
          current.delete(modifierId);
        } else {
          const max = group.max_select;
          if (max === null || max === undefined || current.size < max) {
            current.add(modifierId);
          }
        }
      } else {
        // single-select: picking a new option replaces any previous one; picking the
        // already-selected option again clears it (only allowed when the group isn't required).
        if (current.has(modifierId) && !group.required) {
          current.clear();
        } else {
          current.clear();
          current.add(modifierId);
        }
      }
      return { ...prev, [group.id]: current };
    });
  }

  const allRequiredSatisfied = useMemo(() => {
    if (!groups) return false;
    return groups.every((g) => {
      const chosen = selections[g.id]?.size ?? 0;
      if (g.required && chosen < Math.max(1, g.min_select || 1)) return false;
      if (g.min_select && chosen < g.min_select) return false;
      return true;
    });
  }, [groups, selections]);

  const selectedModifiers: SelectedModifier[] = useMemo(() => {
    if (!groups) return [];
    const out: SelectedModifier[] = [];
    groups.forEach((g) => {
      const chosen = selections[g.id];
      if (!chosen) return;
      g.modifiers.forEach((m) => {
        if (chosen.has(m.id)) {
          out.push({ id: m.id, name: m.name, price_delta: parsePrice(m.price_delta) });
        }
      });
    });
    return out;
  }, [groups, selections]);

  const modifiersTotal = selectedModifiers.reduce((sum, m) => sum + m.price_delta, 0);
  const linePrice = parsePrice(item.price) + modifiersTotal;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl bg-surface p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-ink">{item.name}</h2>
        <p className="mt-0.5 text-sm text-ink-muted">Base price €{parsePrice(item.price).toFixed(2)}</p>

        {groups === null && !loadError && (
          <p className="mt-4 text-sm text-ink-muted">Loading options…</p>
        )}
        {loadError && (
          <p className="mt-4 text-sm text-red-600">Couldn&apos;t load options for this item. You can still add it plain.</p>
        )}

        {groups !== null && groups.length > 0 && (
          <div className="mt-4 space-y-4">
            {groups.map((g) => (
              <div key={g.id}>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-ink">{g.name}</h3>
                  <span className="text-xs text-ink-muted">
                    {g.required ? 'Required' : 'Optional'}
                    {g.selection_type === 'multiple' && g.max_select ? ` · up to ${g.max_select}` : ''}
                  </span>
                </div>
                <div className="mt-1.5 space-y-1">
                  {g.modifiers.map((m) => {
                    const checked = selections[g.id]?.has(m.id) ?? false;
                    const delta = parsePrice(m.price_delta);
                    return (
                      <label
                        key={m.id}
                        className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                          checked ? 'border-brand bg-brand/5' : 'border-border'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type={g.selection_type === 'multiple' ? 'checkbox' : 'radio'}
                            name={`group-${g.id}`}
                            checked={checked}
                            onChange={() => toggle(g, m.id)}
                            className="accent-brand"
                          />
                          {m.name}
                        </span>
                        {delta !== 0 && (
                          <span className="text-ink-muted">
                            {delta > 0 ? '+' : ''}€{delta.toFixed(2)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-baseline justify-between text-sm">
          <span className="text-ink-muted">Line total</span>
          <span className="text-xl font-semibold text-ink">€{linePrice.toFixed(2)}</span>
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={groups !== null && groups.length > 0 && !allRequiredSatisfied}
            onClick={() => onConfirm(selectedModifiers)}
          >
            Add to order
          </Button>
        </div>
      </div>
    </div>
  );
}
