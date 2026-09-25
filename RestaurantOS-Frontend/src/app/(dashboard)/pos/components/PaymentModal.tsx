'use client';

/**
 * Bill splitting (task #49, extended CTO forensic audit 2026-09-21 "Bill splitting is NOT
 * complete"): the original version only supported splitting by arbitrary amount. This adds
 * two more ways to split, on top of that one -- all three ultimately produce the exact same
 * `charges: SplitCharge[]` shape the backend already accepts (see routes/orders.js's
 * chargesFromArray), so no backend schema change was needed for amount/percentage splitting.
 *
 * - "Amount": unchanged -- manually type each payer's amount (evenly divided as a starting
 *   point, editable per payer).
 * - "Percentage": each payer gets a % of the total instead of a raw amount; percentages must
 *   sum to 100, and the resulting cent-exact amounts are computed the same rounding-safe way
 *   as the even-split default (no silently over/under-charging by a cent).
 * - "By item": each cart LINE (not sub-quantity -- see the note below) is assigned to one
 *   payer; a payer's amount is the sum of their assigned lines' prices (including any
 *   modifier price deltas), and every line must be assigned before charging is allowed.
 *   KNOWN LIMITATION, stated plainly rather than faked: splitting a single line with qty > 1
 *   across two DIFFERENT payers (e.g. one of two identical burgers goes to each of two
 *   people) isn't supported -- the whole line goes to one payer. Bump the quantity down to 1
 *   per line before charging (two separate lines) if that's needed; a full seat/quantity-unit
 *   assignment model is a larger feature (see the P1 "seat assignment" tracker item).
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { NumericKeypad } from '@/components/ui/NumericKeypad';
import { SplitCharge } from '@/lib/api';
import { CartLine } from '@/lib/types';
import { parsePrice } from '@/lib/tax';

type ConfirmPayload = { method: 'cash' | 'card' } | { charges: SplitCharge[] };
// SaaS design pass (2026-09-25): 'amount' IS "split equally" -- resizePayerList already
// seeds it via distributeEvenly(total, count) below, and stayed manually editable per payer
// (renaming it wouldn't change behavior). 'seat' is new: it groups cart lines by the REAL
// `CartLine.seat` field (now assignable from the OrderSidebar's seat tabs -- see Cart.tsx)
// instead of requiring a manual per-line payer assignment like 'item' does.
type SplitBy = 'amount' | 'percentage' | 'item' | 'seat';

// Quick cash tender (spec: "$20, $50, $100, Exact Change" buttons + keypad) -- purely a
// client-side change calculator. The backend has no concept of "amount tendered" for a cash
// sale, only the total actually owed (chargeOrder always charges the full order total) --
// this never changes what gets charged, it just helps the cashier work out change to hand
// back, the same way a physical cash drawer's till roll would.
const QUICK_CASH_STEPS = [20, 50, 100];

function lineTotal(line: CartLine): number {
  const modifiersTotal = (line.modifiers ?? []).reduce((sum, m) => sum + (Number(m.price_delta) || 0), 0);
  const unitPrice = parsePrice(line.item.price) + modifiersTotal;
  return unitPrice * (line.weight ?? line.qty);
}

function lineLabel(line: CartLine): string {
  const qtyLabel = typeof line.weight === 'number' ? `${line.weight.toFixed(3)}${line.item.weight_unit || 'kg'}` : `${line.qty}×`;
  return `${qtyLabel} ${line.item.name}`;
}

// Distribute `amount` across `count` shares in whole cents so they always sum EXACTLY to the
// total -- naive division can leave a rounding remainder that silently under/over-charges.
function distributeEvenly(amount: number, count: number): number[] {
  const totalCents = Math.round(amount * 100);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}

export function PaymentModal({
  total,
  lines = [],
  onClose,
  onConfirm,
  submitting = false,
  error = null,
}: {
  total: number;
  lines?: CartLine[];
  onClose: () => void;
  onConfirm: (payload: ConfirmPayload) => void;
  submitting?: boolean;
  error?: string | null;
}) {
  const [method, setMethod] = useState<'cash' | 'card'>('card');
  // Quick cash tender (spec) -- amount tendered, for the change calculator below. Only
  // relevant when method === 'cash' and not in split mode.
  const [tendered, setTendered] = useState('');
  const [splitMode, setSplitMode] = useState(false);
  const [splitBy, setSplitBy] = useState<SplitBy>('amount');
  const [splitCount, setSplitCount] = useState(2);
  // "By seat" methods, keyed by seat number (0 = "Shared" / unassigned lines).
  const [seatMethods, setSeatMethods] = useState<Record<number, 'cash' | 'card'>>({});
  const [shares, setShares] = useState<SplitCharge[]>(() =>
    distributeEvenly(total, 2).map((amount) => ({ method: 'card' as const, amount }))
  );
  const [percentages, setPercentages] = useState<number[]>([50, 50]);
  const [percentMethods, setPercentMethods] = useState<Array<'cash' | 'card'>>(['card', 'card']);
  // itemAssignments[lineKey] = payer index (0-based), or undefined if unassigned yet.
  const [itemAssignments, setItemAssignments] = useState<Record<string, number>>({});
  const [itemMethods, setItemMethods] = useState<Array<'cash' | 'card'>>(['card', 'card']);

  function resizePayerList(count: number) {
    const clamped = Math.max(2, Math.min(10, count));
    setSplitCount(clamped);
    setShares(distributeEvenly(total, clamped).map((amount) => ({ method: 'card' as const, amount })));
    setPercentages(distributeEvenly(100, clamped).map((v) => Math.round(v)));
    setPercentMethods(Array.from({ length: clamped }, () => 'card' as const));
    setItemMethods(Array.from({ length: clamped }, () => 'card' as const));
    setItemAssignments({});
  }

  function updateShareAmount(index: number, amount: number) {
    setShares((prev) => prev.map((s, i) => (i === index ? { ...s, amount } : s)));
  }
  function updateShareMethod(index: number, shareMethod: 'cash' | 'card') {
    setShares((prev) => prev.map((s, i) => (i === index ? { ...s, method: shareMethod } : s)));
  }

  const splitSum = useMemo(() => shares.reduce((sum, s) => sum + (Number(s.amount) || 0), 0), [shares]);
  const splitDifference = Math.round((total - splitSum) * 100) / 100;
  const amountValid = Math.abs(splitDifference) < 0.005;

  const percentSum = useMemo(() => percentages.reduce((sum, p) => sum + (Number(p) || 0), 0), [percentages]);
  const percentValid = Math.abs(percentSum - 100) < 0.01;
  const percentAmounts = useMemo(
    () => (percentValid ? percentages.map((p) => Math.round((total * p) / 100 * 100) / 100) : []),
    [percentages, total, percentValid]
  );

  const itemPayerTotals = useMemo(() => {
    const totals = Array.from({ length: splitCount }, () => 0);
    lines.forEach((line) => {
      const key = line.lineKey ?? String(line.item.id);
      const payer = itemAssignments[key];
      if (payer !== undefined && payer < totals.length) totals[payer] += lineTotal(line);
    });
    return totals;
  }, [lines, itemAssignments, splitCount]);
  const allLinesAssigned = lines.length > 0 && lines.every((l) => itemAssignments[l.lineKey ?? String(l.item.id)] !== undefined);

  // "By seat" (SaaS design pass, 2026-09-25): groups lines by the REAL CartLine.seat field
  // (see Cart.tsx's new SeatTag) instead of a manual per-line payer assignment -- seat 0
  // stands in for "Shared" (no seat assigned), so a starter everyone split still gets billed
  // to someone rather than silently dropped from the split.
  const seatGroups = useMemo(() => {
    const totals = new Map<number, number>();
    lines.forEach((line) => {
      const seat = line.seat ?? 0;
      totals.set(seat, (totals.get(seat) ?? 0) + lineTotal(line));
    });
    return Array.from(totals.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([seat, amount]) => ({ seat, amount }));
  }, [lines]);
  const seatSplitPossible = seatGroups.length > 1 || (seatGroups.length === 1 && seatGroups[0].seat !== 0);

  const tenderedAmount = Number(tendered) || 0;
  const changeDue = tenderedAmount - total;

  const splitValid =
    splitBy === 'amount'
      ? amountValid
      : splitBy === 'percentage'
      ? percentValid
      : splitBy === 'item'
      ? allLinesAssigned
      : seatSplitPossible;

  function handleConfirm() {
    if (!splitMode) {
      onConfirm({ method });
      return;
    }
    if (splitBy === 'amount') {
      if (!amountValid) return;
      onConfirm({ charges: shares.map((s) => ({ ...s, amount: Number(s.amount) })) });
    } else if (splitBy === 'seat') {
      if (!seatSplitPossible) return;
      onConfirm({
        charges: seatGroups.map(({ seat, amount }) => ({
          method: seatMethods[seat] ?? 'card',
          amount: Math.round(amount * 100) / 100,
          note: seat === 0 ? 'Shared' : `Seat ${seat}`,
        })),
      });
    } else if (splitBy === 'percentage') {
      if (!percentValid) return;
      // Recompute with the same cent-safe distribution as the default even-split, using
      // each payer's percentage as its relative weight rather than an equal share.
      const cents = percentages.map((p) => Math.round((total * p * 100) / 100));
      const totalCents = Math.round(total * 100);
      const assignedCents = cents.reduce((s, c) => s + c, 0);
      const diff = totalCents - assignedCents;
      if (diff !== 0) cents[cents.length - 1] += diff; // fold any rounding remainder into the last payer
      onConfirm({
        charges: cents.map((c, i) => ({ method: percentMethods[i], amount: c / 100, note: `${percentages[i]}%` })),
      });
    } else {
      if (!allLinesAssigned) return;
      onConfirm({
        charges: itemPayerTotals.map((amount, i) => ({
          method: itemMethods[i],
          amount: Math.round(amount * 100) / 100,
          note: lines
            .filter((l) => itemAssignments[l.lineKey ?? String(l.item.id)] === i)
            .map((l) => lineLabel(l))
            .join(', '),
        })),
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Take payment</h2>
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
          <div className="mt-5 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              {(['card', 'cash'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  disabled={submitting}
                  className={`rounded-xl border-2 py-4 text-sm font-medium capitalize transition-colors ${
                    method === m ? 'border-brand bg-brand/5 text-brand' : 'border-border text-ink-muted'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Quick cash tender + change calculator (spec) -- see QUICK_CASH_STEPS' comment
                above for why this never changes what's actually charged. */}
            {method === 'cash' && (
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-sunken/60 p-3">
                <div className="flex flex-wrap gap-2">
                  {QUICK_CASH_STEPS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      disabled={submitting}
                      onClick={() => setTendered(String(amount))}
                      className="touch-target flex-1 rounded-lg border border-border bg-surface text-sm font-semibold text-ink hover:border-brand hover:text-brand"
                    >
                      €{amount}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setTendered(total.toFixed(2))}
                    className="touch-target flex-1 rounded-lg border border-border bg-surface text-sm font-semibold text-ink hover:border-brand hover:text-brand"
                  >
                    Exact
                  </button>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-muted">Tendered</span>
                  <span className="font-bold tabular-nums text-ink">€{tenderedAmount.toFixed(2)}</span>
                </div>
                <NumericKeypad value={tendered} onChange={setTendered} maxLength={8} />
                <div
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-bold ${
                    changeDue >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                  }`}
                >
                  <span>{changeDue >= 0 ? 'Change due' : 'Still owed'}</span>
                  <span className="tabular-nums">€{Math.abs(changeDue).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {splitMode && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex gap-1 rounded-lg bg-surface-sunken p-1 text-xs font-medium">
              {(['amount', 'seat', 'percentage', 'item'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={
                    submitting ||
                    (mode === 'item' && lines.length === 0) ||
                    (mode === 'seat' && !seatSplitPossible)
                  }
                  onClick={() => setSplitBy(mode)}
                  className={`flex-1 rounded-md py-1.5 capitalize transition-colors disabled:opacity-40 ${
                    splitBy === mode ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted'
                  }`}
                  title={mode === 'seat' && !seatSplitPossible ? 'Assign items to seats in the order sidebar first' : undefined}
                >
                  {mode === 'item' ? 'By item' : mode === 'amount' ? 'Equally' : mode}
                </button>
              ))}
            </div>

            {splitBy !== 'seat' && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-ink-muted">Split into</span>
              <input
                type="number"
                min={2}
                max={10}
                value={splitCount}
                disabled={submitting}
                onChange={(e) => resizePayerList(Number(e.target.value) || 2)}
                className="w-16 rounded-lg border border-border px-2 py-1 text-center text-sm"
              />
              <span className="text-ink-muted">ways</span>
            </div>
            )}

            {splitBy === 'amount' && (
              <>
                <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                  {shares.map((share, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-14 text-xs text-ink-muted">#{i + 1}</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={share.amount}
                        disabled={submitting}
                        onChange={(e) => updateShareAmount(i, Number(e.target.value) || 0)}
                        className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm"
                      />
                      <select
                        value={share.method}
                        disabled={submitting}
                        onChange={(e) => updateShareMethod(i, e.target.value as 'cash' | 'card')}
                        className="rounded-lg border border-border px-2 py-1.5 text-sm"
                      >
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                      </select>
                    </div>
                  ))}
                </div>
                <p className={`text-xs font-medium ${amountValid ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {amountValid
                    ? 'Shares match the total.'
                    : splitDifference > 0
                    ? `€${splitDifference.toFixed(2)} still unassigned.`
                    : `€${Math.abs(splitDifference).toFixed(2)} over the total.`}
                </p>
              </>
            )}

            {splitBy === 'percentage' && (
              <>
                <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                  {percentages.map((pct, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-14 text-xs text-ink-muted">#{i + 1}</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={pct}
                        disabled={submitting}
                        onChange={(e) =>
                          setPercentages((prev) => prev.map((p, idx) => (idx === i ? Number(e.target.value) || 0 : p)))
                        }
                        className="w-20 rounded-lg border border-border px-2 py-1.5 text-sm"
                      />
                      <span className="text-xs text-ink-muted">%</span>
                      <span className="flex-1 text-right text-sm text-ink-muted">
                        €{percentValid && percentAmounts[i] !== undefined ? percentAmounts[i].toFixed(2) : '—'}
                      </span>
                      <select
                        value={percentMethods[i]}
                        disabled={submitting}
                        onChange={(e) =>
                          setPercentMethods((prev) => prev.map((m, idx) => (idx === i ? (e.target.value as 'cash' | 'card') : m)))
                        }
                        className="rounded-lg border border-border px-2 py-1.5 text-sm"
                      >
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                      </select>
                    </div>
                  ))}
                </div>
                <p className={`text-xs font-medium ${percentValid ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {percentValid ? 'Percentages add up to 100%.' : `Percentages sum to ${percentSum}% (need 100%).`}
                </p>
              </>
            )}

            {splitBy === 'seat' && (
              <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                {seatGroups.map(({ seat, amount }) => (
                  <div key={seat} className="flex items-center gap-2 text-sm">
                    <span className="w-16 flex-shrink-0 text-xs text-ink-muted">{seat === 0 ? 'Shared' : `Seat ${seat}`}</span>
                    <span className="flex-1 text-right font-semibold tabular-nums text-ink">€{amount.toFixed(2)}</span>
                    <select
                      value={seatMethods[seat] ?? 'card'}
                      disabled={submitting}
                      onChange={(e) => setSeatMethods((prev) => ({ ...prev, [seat]: e.target.value as 'cash' | 'card' }))}
                      className="rounded-lg border border-border px-2 py-1.5 text-sm"
                    >
                      <option value="card">Card</option>
                      <option value="cash">Cash</option>
                    </select>
                  </div>
                ))}
              </div>
            )}

            {splitBy === 'item' && (
              <>
                <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                  {lines.map((line) => {
                    const key = line.lineKey ?? String(line.item.id);
                    return (
                      <div key={key} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{lineLabel(line)}</span>
                        <span className="w-14 text-right text-ink-muted">€{lineTotal(line).toFixed(2)}</span>
                        <select
                          value={itemAssignments[key] ?? ''}
                          disabled={submitting}
                          onChange={(e) =>
                            setItemAssignments((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                          }
                          className="rounded-lg border border-border px-2 py-1.5 text-sm"
                        >
                          <option value="" disabled>
                            Assign…
                          </option>
                          {Array.from({ length: splitCount }, (_, i) => (
                            <option key={i} value={i}>
                              #{i + 1}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-col gap-1.5 border-t border-neutral-100 pt-2">
                  {itemPayerTotals.map((amount, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-14 text-xs text-ink-muted">#{i + 1}</span>
                      <span className="flex-1 text-ink-muted">€{amount.toFixed(2)}</span>
                      <select
                        value={itemMethods[i]}
                        disabled={submitting}
                        onChange={(e) => setItemMethods((prev) => prev.map((m, idx) => (idx === i ? (e.target.value as 'cash' | 'card') : m)))}
                        className="rounded-lg border border-border px-2 py-1.5 text-sm"
                      >
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                      </select>
                    </div>
                  ))}
                </div>
                <p className={`text-xs font-medium ${allLinesAssigned ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {allLinesAssigned ? 'Every item is assigned to a payer.' : 'Assign every item to a payer before charging.'}
                </p>
              </>
            )}
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
