'use client';

/**
 * Bill splitting (task #49): adds an optional "Split bill" mode alongside the existing
 * single-method flow, which is completely unchanged (same props shape still works -- see
 * onConfirm's first overload). Splitting only supports dividing the total across payment
 * charges (by method, evenly or by custom amount) -- splitting by specific menu item or by
 * seat would need each order line tagged with who it belongs to, which the order schema
 * doesn't carry today; that's a bigger, separate schema change, not something to fake here.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SplitCharge } from '@/lib/api';

type ConfirmPayload = { method: 'cash' | 'card' } | { charges: SplitCharge[] };

export function PaymentModal({
  total,
  onClose,
  onConfirm,
  submitting = false,
  error = null,
}: {
  total: number;
  onClose: () => void;
  onConfirm: (payload: ConfirmPayload) => void;
  submitting?: boolean;
  error?: string | null;
}) {
  const [method, setMethod] = useState<'cash' | 'card'>('card');
  const [splitMode, setSplitMode] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [shares, setShares] = useState<SplitCharge[]>(() => buildEvenShares(total, 2));

  function buildEvenShares(amount: number, count: number): SplitCharge[] {
    // Distribute in whole cents so the shares always sum EXACTLY to the total -- naive
    // division (amount / count) can leave a rounding remainder that silently under- or
    // over-charges by a cent, which is exactly the kind of "small" pricing bug this app has
    // already shipped twice this session.
    const totalCents = Math.round(amount * 100);
    const base = Math.floor(totalCents / count);
    const remainder = totalCents - base * count;
    return Array.from({ length: count }, (_, i) => ({
      method: 'card' as const,
      amount: (base + (i < remainder ? 1 : 0)) / 100,
    }));
  }

  function handleSplitCountChange(count: number) {
    const clamped = Math.max(2, Math.min(10, count));
    setSplitCount(clamped);
    setShares(buildEvenShares(total, clamped));
  }

  function updateShareAmount(index: number, amount: number) {
    setShares((prev) => prev.map((s, i) => (i === index ? { ...s, amount } : s)));
  }

  function updateShareMethod(index: number, shareMethod: 'cash' | 'card') {
    setShares((prev) => prev.map((s, i) => (i === index ? { ...s, method: shareMethod } : s)));
  }

  const splitSum = useMemo(() => shares.reduce((sum, s) => sum + (Number(s.amount) || 0), 0), [shares]);
  const splitDifference = Math.round((total - splitSum) * 100) / 100;
  const splitValid = Math.abs(splitDifference) < 0.005;

  function handleConfirm() {
    if (splitMode) {
      if (!splitValid) return;
      onConfirm({ charges: shares.map((s) => ({ ...s, amount: Number(s.amount) })) });
    } else {
      onConfirm({ method });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">Take payment</h2>
          <button
            type="button"
            onClick={() => setSplitMode((v) => !v)}
            disabled={submitting}
            className="text-xs font-medium text-brand hover:underline"
          >
            {splitMode ? 'Full amount' : 'Split bill'}
          </button>
        </div>
        <p className="mt-1 text-3xl font-bold text-brand">€{total.toFixed(2)}</p>

        {!splitMode && (
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
        )}

        {splitMode && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-600">Split into</span>
              <input
                type="number"
                min={2}
                max={10}
                value={splitCount}
                disabled={submitting}
                onChange={(e) => handleSplitCountChange(Number(e.target.value) || 2)}
                className="w-16 rounded-lg border border-neutral-300 px-2 py-1 text-center text-sm"
              />
              <span className="text-neutral-600">ways</span>
            </div>

            <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
              {shares.map((share, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-14 text-xs text-neutral-500">#{i + 1}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={share.amount}
                    disabled={submitting}
                    onChange={(e) => updateShareAmount(i, Number(e.target.value) || 0)}
                    className="flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                  <select
                    value={share.method}
                    disabled={submitting}
                    onChange={(e) => updateShareMethod(i, e.target.value as 'cash' | 'card')}
                    className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                  >
                    <option value="card">Card</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
              ))}
            </div>

            <p className={`text-xs font-medium ${splitValid ? 'text-emerald-600' : 'text-rose-600'}`}>
              {splitValid
                ? 'Shares match the total.'
                : splitDifference > 0
                ? `€${splitDifference.toFixed(2)} still unassigned.`
                : `€${Math.abs(splitDifference).toFixed(2)} over the total.`}
            </p>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleConfirm} disabled={submitting || (splitMode && !splitValid)}>
            {submitting ? 'Charging…' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}
