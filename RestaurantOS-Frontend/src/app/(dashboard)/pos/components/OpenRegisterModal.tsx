'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export function OpenRegisterModal({
  onOpen,
}: {
  onOpen: (cash: number) => Promise<void>;
}) {
  const [cash, setCash] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(cash);
    if (Number.isNaN(amount) || amount < 0) {
      setError('Enter a valid starting cash amount.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onOpen(amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the register.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-neutral-900">Open the register</h2>
        <p className="mt-1 text-sm text-neutral-500">
          No active cash-register session — enter the starting cash amount to begin taking orders.
        </p>

        <label className="mb-1 mt-4 block text-sm font-medium text-neutral-700">Starting cash (€)</label>
        <input
          autoFocus
          inputMode="decimal"
          value={cash}
          onChange={(e) => setCash(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={submitting} className="mt-5 w-full">
          {submitting ? 'Opening…' : 'Open register & start selling'}
        </Button>
      </form>
    </div>
  );
}
