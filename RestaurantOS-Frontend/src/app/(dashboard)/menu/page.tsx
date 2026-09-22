'use client';

/**
 * Menu UX refinement (project audit 2026-09-15, task #36): replaced the plain data table
 * with searchable product cards (matching the visual language the POS screen's ProductGrid
 * already established), added a real image-fallback pattern, and surfaced the VAT-inclusive
 * tax breakdown on every card now that item.tax is actually reachable end-to-end (see
 * ItemFormModal.tsx and the backend's utils/tax.js). Inline stock/POS-visibility editing and
 * the category-management form are preserved unchanged (Preservation Contract) -- just
 * restyled onto the shared design-system tokens (surface/border/ink) from task #33, which
 * this screen had not yet been migrated onto.
 *
 * Modifiers and spice levels (also named in task #36's brief) are intentionally NOT faked
 * here: there is no backend schema for either yet (no modifier_groups/modifiers tables, no
 * spice_level column), so building UI for them now would just be inert. That's real
 * follow-up scope, not something to sketch with fake state.
 */
import { useMemo, useState } from 'react';
import { useMenu } from '@/lib/hooks/useMenu';
import { createCategory, updateItemStock, toggleItemOnPos } from '@/lib/api';
import { calculateInclusiveTax, parsePrice } from '@/lib/tax';
import { Button } from '@/components/ui/Button';
import { TopBar } from '@/components/layout/TopBar';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { ItemFormModal } from './components/ItemFormModal';
import { ItemModifiersDialog } from './components/ItemModifiersDialog';
import { getCurrentRole } from '@/lib/auth';
import { PERMISSIONS, roleHasPermission } from '@/lib/permissions';
import { MenuItem } from '@/lib/types';
import clsx from 'clsx';

// Same fix as the POS ProductGrid: a fixed-height strip cropped most of a real dish photo
// away under `object-cover`. NOTE: a fixed pixel height, not `aspect-[4/3]` -- inside a CSS
// Grid cell, Chromium/WebKit fail to size an `aspect-ratio` box during the grid's row
// track-sizing pass (measuring the ratio-derived height as 0 before the column width is
// settled), which collapsed every card down to ~13px tall with everything invisible. A
// definite height sidesteps that. `object-contain` (not `cover`) shows the full photo
// instead of cropping it.
function ItemThumb({ item }: { item: MenuItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative mb-2 h-32 w-full overflow-hidden rounded-lg bg-surface-sunken">
      {item.image && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/images/${item.image}`}
          alt={item.name}
          onError={() => setBroken(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-3xl">🍽️</div>
      )}
      {item.code && (
        <span className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-surface/90 px-1 text-[10px] font-bold text-ink shadow-sm">
          #{item.code}
        </span>
      )}
    </div>
  );
}

export default function MenuPage() {
  const { categories, items, loading, error } = useMenu();
  const [newCategory, setNewCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [localItems, setLocalItems] = useState(items);
  const [editingItem, setEditingItem] = useState<MenuItem | 'new' | null>(null);
  const [modifiersItem, setModifiersItem] = useState<MenuItem | null>(null);
  const canManageMenu = roleHasPermission(getCurrentRole(), PERMISSIONS.MENU_MANAGE);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<number | 'all'>('all');

  // Keep a local, optimistically-editable copy once the real data has loaded.
  if (localItems.length === 0 && items.length > 0) {
    setLocalItems(items);
  }

  const filteredItems = useMemo(() => {
    return localItems.filter((it) => {
      const matchesCategory = activeCategory === 'all' || it.category_id === activeCategory;
      const matchesQuery = it.name.toLowerCase().includes(query.trim().toLowerCase());
      return matchesCategory && matchesQuery;
    });
  }, [localItems, activeCategory, query]);

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    setCreating(true);
    setActionError(null);
    try {
      await createCategory(newCategory.trim());
      setNewCategory('');
      window.location.reload(); // simplest correct refresh until a shared menu store exists
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not create category');
    } finally {
      setCreating(false);
    }
  }

  async function handleStockChange(id: number, quantity: number) {
    setBusyId(id);
    setActionError(null);
    try {
      await updateItemStock(id, quantity);
      setLocalItems((prev) => prev.map((it) => (it.id === id ? { ...it, quantity } : it)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update stock');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTogglePos(id: number, currentlyOnPos: boolean) {
    setBusyId(id);
    setActionError(null);
    try {
      await toggleItemOnPos(id, !currentlyOnPos);
      setLocalItems((prev) => prev.map((it) => (it.id === id ? { ...it, pos: !currentlyOnPos ? 1 : 0 } : it)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update item');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="flex h-screen flex-col">
      <TopBar title="📖 Menu" />
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">Everything on the POS &amp; online menu.</p>
        <Button onClick={() => setEditingItem('new')}>+ New item</Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-ink-muted">
          <Spinner /> Loading menu…
        </div>
      )}
      {error && <p className="text-red-600">{error}</p>}
      {actionError && <p className="text-red-600">{actionError}</p>}

      {!loading && !error && (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">Categories</h2>
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={() => setActiveCategory('all')}
                className={clsx(
                  'touch-target rounded-full px-4 text-sm font-medium transition-colors',
                  activeCategory === 'all' ? 'bg-brand text-white' : 'bg-surface-sunken text-ink hover:bg-border'
                )}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(c.id)}
                  className={clsx(
                    'touch-target rounded-full px-4 text-sm font-medium transition-colors',
                    activeCategory === c.id ? 'bg-brand text-white' : 'bg-surface-sunken text-ink hover:bg-border'
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <form onSubmit={handleCreateCategory} className="flex max-w-sm gap-2">
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="New category name"
                className="touch-target flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <Button type="submit" disabled={creating}>
                {creating ? 'Adding…' : 'Add'}
              </Button>
            </form>
          </section>

          <section className="min-h-0 flex-1">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Items</h2>
              <SearchInput value={query} onChange={setQuery} placeholder="Search items…" className="max-w-xs" />
            </div>

            {filteredItems.length === 0 ? (
              <EmptyState
                icon="🍽️"
                title={localItems.length === 0 ? 'No items yet' : 'No items match'}
                description={
                  localItems.length === 0
                    ? 'Add your first menu item to get started.'
                    : 'Try a different search term or category.'
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {filteredItems.map((item) => {
                  const taxAmount = item.tax ? calculateInclusiveTax(item.price, item.tax) : 0;
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col rounded-xl border border-border bg-surface p-3 shadow-sm"
                    >
                      <ItemThumb item={item} />
                      <span className="font-medium text-ink">{item.name}</span>
                      <span className="mt-0.5 text-sm text-ink-muted">{item.catName ?? 'Uncategorized'}</span>

                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-lg font-semibold text-brand">€{parsePrice(item.price).toFixed(2)}</span>
                        {Boolean(item.sold_by_weight) && (
                          <span className="text-xs font-normal text-ink-muted">/ {item.weight_unit || 'kg'}</span>
                        )}
                      </div>
                      <span className="text-xs text-ink-muted">
                        {item.tax ? `incl. €${taxAmount.toFixed(2)} VAT` : 'no VAT set'}
                      </span>

                      <div className="mt-2 flex flex-wrap gap-1">
                        {Boolean(item.sold_by_weight) && (
                          <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                            ⚖ Sold by weight
                          </span>
                        )}
                        {!item.tax && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            ⚠ No VAT rate
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
                        <label className="flex items-center gap-1 text-xs text-ink-muted">
                          <input
                            type="checkbox"
                            checked={!!item.pos}
                            disabled={busyId === item.id}
                            onChange={() => handleTogglePos(item.id, !!item.pos)}
                          />
                          On POS
                        </label>
                        <div className="flex items-center gap-2">
                          {canManageMenu && (
                            <button
                              onClick={() => setModifiersItem(item)}
                              className="text-sm text-ink-muted hover:underline"
                            >
                              Modifiers
                            </button>
                          )}
                          <button
                            onClick={() => setEditingItem(item)}
                            className="text-sm text-brand hover:underline"
                          >
                            Edit
                          </button>
                        </div>
                      </div>

                      <div className="mt-2">
                        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                          Stock
                        </label>
                        <input
                          type="number"
                          defaultValue={item.quantity}
                          disabled={busyId === item.id}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!Number.isNaN(val) && val !== item.quantity) handleStockChange(item.id, val);
                          }}
                          className="w-full rounded border border-border bg-surface-sunken px-2 py-1 text-sm text-ink"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <ItemModifiersDialog item={modifiersItem} onClose={() => setModifiersItem(null)} />

      {editingItem && (
        <ItemFormModal
          item={editingItem === 'new' ? null : editingItem}
          categories={categories}
          onClose={() => setEditingItem(null)}
          onSaved={(saved) => {
            setLocalItems((prev) => {
              const exists = prev.some((it) => it.id === saved.id);
              return exists ? prev.map((it) => (it.id === saved.id ? { ...it, ...saved } : it)) : [saved, ...prev];
            });
            setEditingItem(null);
          }}
        />
      )}
      </div>
    </main>
  );
}
