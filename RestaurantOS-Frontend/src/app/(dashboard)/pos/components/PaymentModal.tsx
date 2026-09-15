'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export function PaymentModal({
  total,
  onClose,
  onConfirm,
  submitting = false,
  error = null,
}: {
  total: number;
  onClose: () => void;
  onConfirm: (method: 'cash' | 'card') => void;
  submitting?: boolean;
  error?: string | null;
}) {
  const [method, setMethod] = useState<'cash' | 'card'>('card');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-neutral-900">Take payment</h2>
        <p className="mt-1 text-3xl font-bold text-brand">€{total.toFixed(2)}</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {(['card', 'cash'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              disabled={submitting}
              className={`rounded-xl border-2 py-4 text-sm font-medium capitalize transition-colors ${
                method === m ? 'border-brand bg-brand/5 text-brand' : 'border-neutral-200 text-neutral-600'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => onConfirm(method)} disabled={submitting}>
            {submitting ? 'Charging…' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}
