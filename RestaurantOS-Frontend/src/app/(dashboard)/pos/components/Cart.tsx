'use client';

import { CartLine } from '@/lib/types';
import { parsePrice } from '@/lib/tax';
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
    <div className="flex h-full flex-col rounded-2xl border border-border bg-surface shadow-md">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          🧾 Current order
          {lines.length > 0 && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">{lines.length}</span>
          )}
        </h2>
        {lines.length > 0 && (
          <button onClick={onClear} className="text-sm font-medium text-ink-muted transition-colors hover:text-red-600">
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {lines.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
            <span className="text-4xl opacity-40">🛒</span>
            <p className="text-sm text-ink-muted">Tap an item to add it to the order.</p>
          </div>
        )}
        {lines.map((line) => {
          const key = line.lineKey ?? String(line.item.id);
          const isWeighed = typeof line.weight === 'number';
          const modifiersTotal = (line.modifiers ?? []).reduce((sum, m) => sum + (Number(m.price_delta) || 0), 0);
          const unitPrice = parsePrice(line.item.price) + modifiersTotal;
          const linePrice = unitPrice * (line.weight ?? line.qty);
          return (
            <div key={key} className="flex items-center justify-between border-b border-neutral-100 py-2.5 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{line.item.name}</p>
                <p className="text-xs text-ink-muted">
                  {isWeighed
                    ? `${line.weight!.toFixed(3)} ${line.item.weight_unit || 'kg'} × €${parsePrice(line.item.price).toFixed(2)}/${line.item.weight_unit || 'kg'}`
                    : `€${unitPrice.toFixed(2)} each`}
                </p>
                {/* Modifiers (CTO forensic audit 2026-09-20): shown as a compact sub-line so
                    the cashier and the printed receipt/kitchen ticket all agree on exactly
                    what was selected -- see lib/printing.ts's cartLinesToTicketLines. */}
                {line.modifiers && line.modifiers.length > 0 && (
                  <p className="truncate text-[11px] text-ink-muted">
                    {line.modifiers
                      .map((m) => (m.price_delta ? `${m.name} (+€${m.price_delta.toFixed(2)})` : m.name))
                      .join(', ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isWeighed ? (
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">⚖ weighed</span>
                ) : (
                  <>
                    <button
                      onClick={() => onSetQty(key, line.qty - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-sunken font-semibold text-ink shadow-sm transition-colors hover:bg-neutral-200 active:scale-95"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-semibold">{line.qty}</span>
                    <button
                      onClick={() => onSetQty(key, line.qty + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-sunken font-semibold text-ink shadow-sm transition-colors hover:bg-neutral-200 active:scale-95"
                    >
                      +
                    </button>
                  </>
                )}
                <span className="w-16 text-right text-sm font-bold text-ink">
                  €{linePrice.toFixed(2)}
                </span>
                <button
                  onClick={() => onRemove(key)}
                  className="ml-1 text-neutral-300 transition-colors hover:text-red-600"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border bg-surface-sunken/60 px-4 py-3 text-sm">
        <div className="flex justify-between text-ink-muted">
          <span>Subtotal</span>
          <span>€{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-ink-muted">
          <span>Tax</span>
          <span>€{tax.toFixed(2)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-dashed border-border pt-1.5 text-base font-bold text-ink">
          <span>Total</span>
          <span>€{total.toFixed(2)}</span>
        </div>
      </div>

      <div className="p-4 pt-0">
        <Button className="w-full py-3.5 text-base font-bold shadow-md" disabled={lines.length === 0} onClick={onCharge}>
          Charge €{total.toFixed(2)}
        </Button>
      </div>
    </div>
  );
}
