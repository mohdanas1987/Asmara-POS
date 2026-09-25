'use client';

/**
 * SaaS design pass (2026-09-25, "OrderSidebar" spec): upgrades the existing Cart ticket panel
 * with seat tabs, a per-line note drawer, and (for table orders) the course-firing controls
 * that previously lived in a separate, non-dark-mode-aware toolbar above the product grid
 * (see pos/page.tsx) -- moved here so they live where a cashier actually looks for them,
 * next to the ticket they act on. All of it is wired to REAL state:
 *   - Seat tabs read/write `CartLine.seat` via `onAssignSeat` (useCart's existing
 *     `assignSeat`, already used server-side by services/payments/billSplit.js's
 *     computeSeatSplit -- this was previously set only when adding modifiers via
 *     ItemModifierPicker, never editable after the fact).
 *   - The note drawer reads/writes `CartLine.note` via `onSetNote` (useCart's new `setNote`,
 *     added alongside this component) -- a field that existed on CartLine but was never
 *     actually set anywhere until now. Flows straight through to the kitchen ticket (see
 *     printing.ts).
 *   - `onSendToKitchen`/`onPrintBill`/`sendingToKitchen` are the SAME handlers pos/page.tsx
 *     already had (handleSendToKitchen, setShowBill) -- optional props so this component
 *     still works standalone for a direct/counter sale, which has no "send to kitchen
 *     separately from payment" step at all.
 */
import { useState } from 'react';
import clsx from 'clsx';
import { CartLine } from '@/lib/types';
import { parsePrice } from '@/lib/tax';
import { Button } from '@/components/ui/Button';

const DEFAULT_SEAT_COUNT = 6;

function SeatTag({
  line,
  seatCount,
  onAssignSeat,
}: {
  line: CartLine;
  seatCount: number;
  onAssignSeat?: (lineKey: string, seat: number | undefined) => void;
}) {
  if (!onAssignSeat) return null;
  const key = line.lineKey ?? String(line.item.id);
  return (
    <select
      value={line.seat ?? ''}
      onChange={(e) => onAssignSeat(key, e.target.value === '' ? undefined : Number(e.target.value))}
      className="touch-target rounded-md border border-white/[0.07] bg-surface-raised px-1.5 py-0.5 text-[11px] font-medium text-ink-muted"
      aria-label={`Assign ${line.item.name} to a seat`}
      title="Assign to a seat"
    >
      <option value="">Shared</option>
      {Array.from({ length: seatCount }, (_, i) => i + 1).map((seat) => (
        <option key={seat} value={seat}>
          Seat {seat}
        </option>
      ))}
    </select>
  );
}

function LineNote({
  line,
  onSetNote,
}: {
  line: CartLine;
  onSetNote?: (lineKey: string, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(line.note ?? '');
  if (!onSetNote) return null;
  const key = line.lineKey ?? String(line.item.id);

  if (open) {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSetNote(key, draft.trim());
              setOpen(false);
            }
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="e.g. no onions, extra crispy…"
          className="min-w-0 flex-1 rounded-md border border-white/[0.07] bg-surface-raised px-2 py-1 text-xs text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            onSetNote(key, draft.trim());
            setOpen(false);
          }}
          className="touch-target rounded-md bg-brand px-2 text-xs font-semibold text-white"
        >
          Save
        </button>
      </div>
    );
  }

  return line.note ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="mt-0.5 block truncate text-left text-[11px] italic text-ink-muted hover:text-brand"
      title="Edit note"
    >
      * {line.note}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="mt-0.5 text-[11px] font-medium text-ink-muted/70 hover:text-brand"
    >
      + note
    </button>
  );
}

export function Cart({
  lines,
  subtotal,
  tax,
  total,
  onSetQty,
  onRemove,
  onCharge,
  onClear,
  isTableOrder = false,
  seatCount = DEFAULT_SEAT_COUNT,
  onAssignSeat,
  onSetNote,
  onSendToKitchen,
  sendingToKitchen = false,
  onPrintBill,
}: {
  lines: CartLine[];
  subtotal: number;
  tax: number;
  total: number;
  onSetQty: (lineKey: string, qty: number) => void;
  onRemove: (lineKey: string) => void;
  onCharge: () => void;
  onClear: () => void;
  // Course firing / seat / note controls (SaaS design pass) -- all optional, all off by
  // default, so this component is unchanged for any caller that doesn't pass them.
  isTableOrder?: boolean;
  seatCount?: number;
  onAssignSeat?: (lineKey: string, seat: number | undefined) => void;
  onSetNote?: (lineKey: string, note: string) => void;
  onSendToKitchen?: () => void;
  sendingToKitchen?: boolean;
  onPrintBill?: () => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.03] bg-surface shadow-md">
      <div className="flex items-center justify-between border-b border-white/[0.03] px-4 py-3.5">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          🧾 Current order
          {lines.length > 0 && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-bold tabular-nums text-brand">{lines.length}</span>
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
            <div key={key} className="border-b border-white/[0.03] py-2.5 last:border-0">
              <div className="flex items-center justify-between">
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
                  <LineNote line={line} onSetNote={onSetNote} />
                </div>
                <div className="flex items-center gap-2">
                  {isWeighed ? (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">⚖ weighed</span>
                  ) : (
                    <>
                      <button
                        onClick={() => onSetQty(key, line.qty - 1)}
                        className="touch-target flex h-7 w-7 items-center justify-center rounded-full bg-surface-sunken font-semibold text-ink shadow-sm transition-colors hover:bg-white/10 active:scale-95"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-sm font-semibold tabular-nums">{line.qty}</span>
                      <button
                        onClick={() => onSetQty(key, line.qty + 1)}
                        className="touch-target flex h-7 w-7 items-center justify-center rounded-full bg-surface-sunken font-semibold text-ink shadow-sm transition-colors hover:bg-white/10 active:scale-95"
                      >
                        +
                      </button>
                    </>
                  )}
                  <span className="w-16 text-right text-sm font-bold tabular-nums text-ink">
                    €{linePrice.toFixed(2)}
                  </span>
                  <button
                    onClick={() => onRemove(key)}
                    className="touch-target ml-1 text-neutral-500 transition-colors hover:text-red-600"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {onAssignSeat && (
                <div className="mt-1.5 flex justify-end">
                  <SeatTag line={line} seatCount={seatCount} onAssignSeat={onAssignSeat} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Course firing controls (spec) -- only for an active table order; a direct/counter
          sale has no "fire now, pay later" step at all (charging it already fires the kitchen
          ticket, see pos/page.tsx's handleConfirmPayment). */}
      {isTableOrder && (onSendToKitchen || onPrintBill) && (
        <div className="flex gap-2 border-t border-white/[0.03] px-4 py-2.5">
          {onSendToKitchen && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="touch-target flex-1"
              onClick={onSendToKitchen}
              disabled={sendingToKitchen || lines.length === 0}
            >
              {sendingToKitchen ? 'Firing…' : 'Fire kitchen 🔥'}
            </Button>
          )}
          {onPrintBill && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="touch-target flex-1"
              onClick={onPrintBill}
              disabled={lines.length === 0}
            >
              Print bill 🧾
            </Button>
          )}
        </div>
      )}

      <div className="border-t border-white/[0.03] bg-surface-sunken/60 px-4 py-3 text-sm">
        <div className="flex justify-between text-ink-muted">
          <span>Subtotal</span>
          <span className="tabular-nums">€{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-ink-muted">
          <span>Tax</span>
          <span className="tabular-nums">€{tax.toFixed(2)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-dashed border-white/[0.07] pt-1.5 text-base font-bold text-ink">
          <span>Total</span>
          <span className="tabular-nums">€{total.toFixed(2)}</span>
        </div>
      </div>

      <div className="p-4 pt-0">
        <button
          type="button"
          disabled={lines.length === 0}
          onClick={onCharge}
          className={clsx(
            'touch-target w-full rounded-xl bg-brand-gradient py-3.5 text-base font-bold text-white shadow-glow transition-transform active:scale-[0.98]',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none'
          )}
        >
          {isTableOrder ? 'CHARGE ' : 'SEND TO KITCHEN & PAY '}
          <span className="tabular-nums">€{total.toFixed(2)}</span>
        </button>
      </div>
    </div>
  );
}
