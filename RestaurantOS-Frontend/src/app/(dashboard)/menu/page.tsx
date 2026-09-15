'use client';

import { useState } from 'react';
import { useMenu } from '@/lib/hooks/useMenu';
import { createCategory, updateItemStock, toggleItemOnPos } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ItemFormModal } from './components/ItemFormModal';
import { MenuItem } from '@/lib/types';

export default function MenuPage() {
  const { categories, items, loading, error } = useMenu();
  const [newCategory, setNewCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [localItems, setLocalItems] = useState(items);
  const [editingItem, setEditingItem] = useState<MenuItem | 'new' | null>(null);

  // Keep a local, optimistically-editable copy once the real data has loaded.
  if (localItems.length === 0 && items.length > 0) {
    setLocalItems(items);
  }

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
    <main className="flex h-screen flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Menu</h1>
        <Button onClick={() => setEditingItem('new')}>+ New item</Button>
      </div>

      {loading && <p className="text-neutral-400">Loading menu…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {actionError && <p className="text-red-600">{actionError}</p>}

      {!loading && !error && (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Categories</h2>
            <div className="mb-3 flex flex-wrap gap-2">
              {categories.map((c) => (
                <span key={c.id} className="rounded-full bg-neutral-200 px-3 py-1.5 text-sm text-neutral-700">
                  {c.name}
                </span>
              ))}
            </div>
            <form onSubmit={handleCreateCategory} className="flex max-w-sm gap-2">
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="New category name"
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <Button type="submit" disabled={creating}>
                {creating ? 'Adding…' : 'Add'}
              </Button>
            </form>
          </section>

          <section className="min-h-0 flex-1">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Items</h2>
            <div className="overflow-auto rounded-xl border border-neutral-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2">Category</th>
                    <th className="px-4 py-2 text-right">Price</th>
                    <th className="px-4 py-2 text-right">Stock</th>
                    <th className="px-4 py-2 text-center">On POS</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {localItems.map((item) => (
                    <tr key={item.id} className="border-t border-neutral-100">
                      <td className="px-4 py-2 font-medium">
                        {item.name}
                        {Boolean(item.sold_by_weight) && (
                          <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
                            ⚖ /{item.weight_unit || 'kg'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-neutral-500">{item.catName}</td>
                      <td className="px-4 py-2 text-right">€{Number(item.price).toFixed(2)}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          defaultValue={item.quantity}
                          disabled={busyId === item.id}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!Number.isNaN(val) && val !== item.quantity) handleStockChange(item.id, val);
                          }}
                          className="w-20 rounded border border-neutral-300 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={!!item.pos}
                          disabled={busyId === item.id}
                          onChange={() => handleTogglePos(item.id, !!item.pos)}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => setEditingItem(item)}
                          className="text-sm text-brand hover:underline"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {localItems.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-neutral-400">
                        No items yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

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
    </main>
  );
}
