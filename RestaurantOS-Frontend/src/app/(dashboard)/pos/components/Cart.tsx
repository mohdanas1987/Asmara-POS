'use client';

import { CartLine } from '@/lib/types';
import { Button } from '@/components/ui/Button';

export function Cart({
  lines,
  subtotal,
  tax,
  total,
  onSetQty,
  onRemove,
  onCharge,
  onClear,
}: {
  lines: CartLine[];
  subtotal: number;
  tax: number;
  total: number;
  onSetQty: (lineKey: string, qty: number) => void;
  onRemove: (lineKey: string) => void;
  onCharge: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="font-semibold text-neutral-900">Current order</h2>
        {lines.length > 0 && (
          <button onClick={onClear} className="text-sm text-neutral-400 hover:text-red-600">
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {lines.length === 0 && (
          <p className="py-12 text-center text-sm text-neutral-400">
            Tap an item to add it to the order.
          </p>
        )}
        {lines.map((line) => {
          const key = line.lineKey ?? String(line.item.id);
          const isWeighed = typeof line.weight === 'number';
          const linePrice = line.item.price * (line.weight ?? line.qty);
          return (
            <div key={key} className="flex items-center justify-between border-b border-neutral-100 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">{line.item.name}</p>
                <p className="text-xs text-neutral-500">
                  {isWeighed
                    ? `${line.weight!.toFixed(3)} ${line.item.weight_unit || 'kg'} × €${Number(line.item.price).toFixed(2)}/${line.item.weight_unit || 'kg'}`
                    : `€${Number(line.item.price).toFixed(2)} each`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isWeighed ? (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">⚖ weighed</span>
                ) : (
                  <>
                    <button
                      onClick={() => onSetQty(key, line.qty - 1)}
                      className="h-7 w-7 rounded-full bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-medium">{line.qty}</span>
                    <button
                      onClick={() => onSetQty(key, line.qty + 1)}
                      className="h-7 w-7 rounded-full bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                    >
                      +
                    </button>
                  </>
                )}
                <span className="w-16 text-right text-sm font-semibold">
                  €{linePrice.toFixed(2)}
                </span>
                <button
                  onClick={() => onRemove(key)}
                  className="ml-1 text-neutral-300 hover:text-red-600"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-neutral-200 px-4 py-3 text-sm">
        <div className="flex justify-between text-neutral-600">
          <span>Subtotal</span>
          <span>€{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-neutral-600">
          <span>Tax</span>
          <span>€{tax.toFixed(2)}</span>
        </div>
        <div className="mt-1 flex justify-between text-base font-semibold text-neutral-900">
          <span>Total</span>
          <span>€{total.toFixed(2)}</span>
        </div>
      </div>

      <div className="p-4 pt-0">
        <Button className="w-full py-3 text-base" disabled={lines.length === 0} onClick={onCharge}>
          Charge €{total.toFixed(2)}
        </Button>
      </div>
    </div>
  );
}
