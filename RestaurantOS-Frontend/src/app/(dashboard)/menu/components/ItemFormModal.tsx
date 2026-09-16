'use client';

import { useEffect, useState } from 'react';
import { MenuCategory, MenuItem, TaxRate } from '@/lib/types';
import { createItem, getTaxes, updateItem } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { calculateInclusiveTax } from '@/lib/tax';

/**
 * Create/edit form for a menu item, including the "sold by weight" toggle added for the
 * weighing-scale feature. This is the first UI in this app that actually calls
 * /items/create and /items/update -- see VERIFICATION.md for the two pre-existing backend
 * bugs (missing-category crash, dead queueProduct call) discovered and fixed while wiring
 * this form up for real.
 */
export function ItemFormModal({
  item,
  categories,
  onClose,
  onSaved,
}: {
  item: MenuItem | null; // null = creating a new item
  categories: MenuCategory[];
  onClose: () => void;
  onSaved: (item: MenuItem) => void;
}) {
  const isEdit = item !== null;
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item ? String(item.price) : '');
  const [barcode, setBarcode] = useState(item?.code ?? '');
  const [categoryId, setCategoryId] = useState<number | ''>(item?.category_id ?? '');
  const [soldByWeight, setSoldByWeight] = useState(Boolean(item?.sold_by_weight));
  const [weightUnit, setWeightUnit] = useState<'kg' | 'g' | 'lb'>(item?.weight_unit ?? 'kg');
  const [image, setImage] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [taxAmount, setTaxAmount] = useState<string>(item?.tax != null ? String(item.tax) : '');

  // Menu UX refinement (task #36): load the tenant's configured VAT rates so a rate can
  // actually be assigned to an item -- previously no UI anywhere offered this, so every item
  // created through this form silently had no tax rate set.
  useEffect(() => {
    let cancelled = false;
    getTaxes()
      .then((res) => {
        if (!cancelled && res.status) setTaxes(res.taxes.filter((t) => t.status));
      })
      .catch(() => {
        // Non-fatal: the form still works with "No tax" selected.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !price.trim()) {
      setError('Name and price are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        const res = await updateItem(item.id, {
          name: name.trim(),
          price: price.trim(),
          code: barcode.trim(),
          category_id: categoryId === '' ? undefined : categoryId,
          sold_by_weight: soldByWeight,
          weight_unit: weightUnit,
          tax: taxAmount || undefined,
          image,
          existingImage: item.image ?? null,
        });
        if (!res.status) throw new Error('Could not update item.');
        onSaved(res.updated);
      } else {
        const res = await createItem({
          name: name.trim(),
          price: price.trim(),
          barcode: barcode.trim() || undefined,
          category_id: categoryId === '' ? undefined : categoryId,
          sold_by_weight: soldByWeight,
          weight_unit: weightUnit,
          tax: taxAmount || undefined,
          image,
        });
        if (!res.status) throw new Error(res.message || 'Could not create item.');
        onSaved(res.product);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-neutral-900">{isEdit ? 'Edit item' : 'New item'}</h2>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                {soldByWeight ? `Price per ${weightUnit}` : 'Price'}
              </label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div>
              {/* This field doubles as the printed hardcopy-menu dish number (shown as a
                  "#N" badge on the POS/Menu cards) as well as a barcode, if you use one --
                  owner request: numbers here should match the physical menu exactly. */}
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Dish # / Barcode
              </label>
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="e.g. 42"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <p className="mt-1 text-[11px] text-neutral-400">
                Matches the number on the printed menu. Shown as a badge on the dish photo.
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">VAT rate</label>
            <select
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="">No tax</option>
              {taxes.map((t) => (
                <option key={t.id} value={t.amount}>
                  {t.name} ({t.amount})
                </option>
              ))}
            </select>
            {taxAmount && price.trim() && (
              <p className="mt-1 text-xs text-neutral-400">
                Price is VAT-inclusive: €{calculateInclusiveTax(price.trim(), taxAmount).toFixed(2)} of the price above is VAT.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-neutral-200 p-3">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={soldByWeight} onChange={(e) => setSoldByWeight(e.target.checked)} />
              ⚖ Sold by weight (produce, deli, bulk bins)
            </label>
            {soldByWeight && (
              <div className="mt-2">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Unit</label>
                <select
                  value={weightUnit}
                  onChange={(e) => setWeightUnit(e.target.value as 'kg' | 'g' | 'lb')}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                >
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="lb">lb</option>
                </select>
                <p className="mt-1 text-xs text-neutral-400">
                  At the POS, the cashier puts the item on the scale and the price is weight × the price above.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Image (optional)</label>
            <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create item'}
          </Button>
        </div>
      </form>
    </div>
  );
}
