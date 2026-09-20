'use client';

/**
 * Decoupling "view/print bill" from "close table" (CTO forensic audit 2026-09-20): before
 * this, the only path to seeing a printed total from the active POS screen was opening
 * PaymentModal, which is one confirm away from actually charging and closing the table --
 * there was no safe "just show me the bill" step. This dialog only ever reads `lines`/
 * `subtotal`/`tax`/`total` that are already in memory and calls printBillPreview (which never
 * calls chargeOrder or finishOrder) -- closing it (or doing nothing) leaves the order and the
 * table exactly as they were.
 */
import { CartLine } from '@/lib/types';
import { parsePrice } from '@/lib/tax';
import { printBillPreview } from '@/lib/printing';
import { cartLinesToTicketLines } from '@/lib/printing';
import { Button } from '@/components/ui/Button';

export function CartBillDialog({
  open,
  onClose,
  tableNumber,
  orderId,
  lines,
  subtotal,
  tax,
  total,
}: {
  open: boolean;
  onClose: () => void;
  tableNumber?: string | null;
  orderId?: string | number | null;
  lines: CartLine[];
  subtotal: number;
  tax: number;
  total: number;
}) {
  if (!open) return null;

  function handlePrint() {
    printBillPreview({
      tableNumber,
      orderId,
      lines: cartLinesToTicketLines(lines),
      subtotal,
      tax,
      total,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">
            Bill{tableNumber ? ` — Table #${tableNumber}` : ''}
          </h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            Not yet paid
          </span>
        </div>

        <div className="mt-3 max-h-64 divide-y divide-neutral-100 overflow-y-auto">
          {lines.length === 0 && <p className="py-4 text-sm text-neutral-400">Nothing on this order yet.</p>}
          {lines.map((line) => {
            const modifiersTotal = (line.modifiers ?? []).reduce((sum, m) => sum + (Number(m.price_delta) || 0), 0);
            const unitPrice = parsePrice(line.item.price) + modifiersTotal;
            const linePrice = unitPrice * (line.weight ?? line.qty);
            return (
              <div key={line.lineKey ?? String(line.item.id)} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-neutral-900">
                    {typeof line.weight === 'number' ? `${line.weight.toFixed(3)}${line.item.weight_unit || 'kg'}` : `${line.qty}×`} {line.item.name}
                  </p>
                  {line.modifiers && line.modifiers.length > 0 && (
                    <p className="truncate text-[11px] text-neutral-400">
                      {line.modifiers.map((m) => m.name).join(', ')}
                    </p>
                  )}
                </div>
                <span className="ml-2 shrink-0 text-neutral-600">€{linePrice.toFixed(2)}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-3 space-y-0.5 border-t border-neutral-200 pt-3 text-sm">
          <div className="flex justify-between text-neutral-600">
            <span>Subtotal</span>
            <span>€{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>Tax</span>
            <span>€{tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base font-bold text-neutral-900">
            <span>Total due</span>
            <span>€{total.toFixed(2)}</span>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Back to table
          </Button>
          <Button className="flex-1" onClick={handlePrint} disabled={lines.length === 0}>
            Print bill
          </Button>
        </div>
      </div>
    </div>
  );
}
