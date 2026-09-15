'use client';

import { useEffect, useState } from 'react';
import { MenuItem } from '@/lib/types';
import { getDesktopBridge, ScaleReading } from '@/lib/desktop';
import { Button } from '@/components/ui/Button';

/**
 * Shown when the cashier taps a sold_by_weight product. Reads live weight from the
 * connected scale via the Electron bridge (see scale.js / preload.js); if no desktop bridge
 * is present (plain browser preview) or no scale is connected, falls back to manual weight
 * entry -- same graceful-degradation pattern already used for printers elsewhere in this app.
 */
export function WeighItemModal({
  item,
  onClose,
  onConfirm,
}: {
  item: MenuItem;
  onClose: () => void;
  onConfirm: (weight: number) => void;
}) {
  const bridge = getDesktopBridge();
  const unit = item.weight_unit || 'kg';
  const [reading, setReading] = useState<ScaleReading | null>(null);
  const [scaleAvailable, setScaleAvailable] = useState<boolean | null>(null);
  const [manualWeight, setManualWeight] = useState('');

  useEffect(() => {
    if (!bridge) {
      setScaleAvailable(false);
      return;
    }
    let cancelled = false;
    bridge.isScaleConnected().then((connected) => {
      if (!cancelled) setScaleAvailable(connected);
    });
    bridge.getScaleReading().then((last) => {
      if (!cancelled && last) setReading(last);
    });
    const unsubscribe = bridge.onScaleWeight((r) => setReading(r));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  const liveWeight = reading?.weight ?? null;
  const manualParsed = parseFloat(manualWeight);
  const effectiveWeight = scaleAvailable && liveWeight !== null ? liveWeight : manualParsed;
  const validWeight = Number.isFinite(effectiveWeight) && effectiveWeight > 0;
  const linePrice = validWeight ? effectiveWeight * item.price : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-neutral-900">{item.name}</h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          €{Number(item.price).toFixed(2)} per {unit}
        </p>

        <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-center">
          {scaleAvailable === null && <p className="text-sm text-neutral-400">Checking for a connected scale…</p>}

          {scaleAvailable === false && (
            <>
              <p className="mb-2 text-sm text-neutral-500">
                No scale connected — enter the weight manually.
              </p>
              <input
                autoFocus
                type="number"
                step="0.001"
                min="0"
                inputMode="decimal"
                placeholder={`Weight in ${unit}`}
                value={manualWeight}
                onChange={(e) => setManualWeight(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-center text-lg focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </>
          )}

          {scaleAvailable === true && (
            <>
              <p className="text-3xl font-bold tabular-nums text-neutral-900">
                {liveWeight !== null ? liveWeight.toFixed(3) : '—.———'} <span className="text-lg font-normal text-neutral-500">{unit}</span>
              </p>
              <p className={`mt-1 text-xs font-medium ${reading?.stable ? 'text-green-600' : 'text-amber-600'}`}>
                {reading?.stable === true && 'Stable'}
                {reading?.stable === false && 'Settling…'}
                {reading?.stable === null && 'Reading…'}
              </p>
            </>
          )}
        </div>

        <div className="mt-4 flex items-baseline justify-between text-sm">
          <span className="text-neutral-600">Line total</span>
          <span className="text-xl font-semibold text-neutral-900">€{linePrice.toFixed(2)}</span>
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!validWeight}
            onClick={() => validWeight && onConfirm(effectiveWeight)}
          >
            Add to order
          </Button>
        </div>
      </div>
    </div>
  );
}
