'use client';

/**
 * Tax rate management (task #17 gap: the backend has full CRUD for tax rates --
 * routes/tax.js's /create, /update, /remove/:id, /toggle/:id/:status -- but nothing in the
 * frontend ever called anything except the read-only dropdown in ItemFormModal. A tenant
 * had no way to add a new VAT rate, fix a typo'd one, or retire an old one without going
 * straight to the database. Mirrors the Website Sync / Payments settings screens' layout.
 */
import { useEffect, useState } from 'react';
import { getAllTaxes, createTax, updateTax, deleteTax, toggleTax } from '@/lib/api';
import { TaxRate } from '@/lib/types';
import { Button } from '@/components/ui/Button';

export default function TaxSettingsPage() {
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editAmount, setEditAmount] = useState('');

  function load() {
    setLoading(true);
    getAllTaxes()
      .then((res) => {
        if (!res.status) throw new Error('Could not load tax rates.');
        setTaxes(res.taxes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load tax rates.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !amount.trim()) {
      setFormError('Enter both a name and a rate.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await createTax({ name: name.trim(), amount: amount.trim(), status: true });
      setName('');
      setAmount('');
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create tax rate.');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(t: TaxRate) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditAmount(t.amount);
  }

  async function handleSaveEdit(t: TaxRate) {
    setBusy(true);
    setError(null);
    try {
      await updateTax({ id: t.id, name: editName.trim(), amount: editAmount.trim(), status: Boolean(t.status) });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update tax rate.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(t: TaxRate) {
    setBusy(true);
    setError(null);
    try {
      await toggleTax(t.id, !t.status);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update tax rate.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(t: TaxRate) {
    if (!confirm(`Delete "${t.name}"? Menu items already using it keep their stored rate, but it will no longer be selectable.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTax(t.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete tax rate.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-neutral-900">🧮 Tax rates</h1>
      <p className="mb-4 text-sm text-neutral-500">
        VAT/tax rates available when adding or editing a menu item. Rates already assigned to
        an item keep working even if disabled here -- disabling just removes them from the picker.
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <form onSubmit={handleCreate} className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. High VAT"
            className="mt-1 w-40 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          Rate
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 21%"
            className="mt-1 w-28 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>
        <Button type="submit" disabled={busy} className="font-semibold">
          {busy ? 'Adding…' : '+ Add rate'}
        </Button>
      </form>
      {formError && <p className="mb-3 -mt-3 text-sm text-red-600">{formError}</p>}

      {loading && <p className="text-neutral-400">Loading…</p>}

      {!loading && (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Rate</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {taxes.map((t) => (
                <tr key={t.id} className="border-t border-neutral-100">
                  {editingId === t.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-2 text-neutral-400">
                        {t.status ? 'Active' : 'Disabled'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => handleSaveEdit(t)} disabled={busy} className="mr-3 text-sm font-semibold text-brand hover:underline">
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-sm text-neutral-400 hover:text-neutral-600">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 font-medium text-neutral-900">{t.name}</td>
                      <td className="px-4 py-2 tabular-nums text-neutral-700">{t.amount}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => handleToggle(t)}
                          disabled={busy}
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            t.status ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                          }`}
                        >
                          {t.status ? 'Active' : 'Disabled'}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => startEdit(t)} className="mr-3 text-sm font-medium text-brand hover:underline">
                          Edit
                        </button>
                        <button onClick={() => handleDelete(t)} className="text-sm text-neutral-400 hover:text-red-600">
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {taxes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-neutral-400">
                    No tax rates yet -- add one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
