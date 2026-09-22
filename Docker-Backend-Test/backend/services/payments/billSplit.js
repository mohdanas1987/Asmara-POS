'use strict';
/**
 * Bill splitting, item/seat/percentage modes (CTO feedback 2026-09-22, item 7: "Full item/
 * seat/percentage bill splitting"). Pre-existing support (task #49, see test/bill-splitting
 * .test.js) already lets the CLIENT compute arbitrary per-payer amounts and send them as an
 * itemized `charges` array to POST /orders/create -- that recording path is correct and is
 * NOT changed here. What was actually missing, and what the codebase's own comments say was
 * "explicitly out of scope" (PaymentModal.tsx historically supported even/custom AMOUNT
 * splits only), is computing those per-payer amounts correctly in the first place for the
 * two harder cases: splitting by which physical items/seats each person is paying for, and
 * splitting by percentage -- both of which have real, easy-to-get-wrong rounding and
 * coverage pitfalls (a partially-assigned item silently dropping money off the bill; a
 * percentage split whose rounded shares don't add back up to the exact total to the cent).
 *
 * This module is pure computation -- no DB writes, no ledger interaction. The actual charge
 * is still recorded through the existing, tested `charges` array path on /orders/create or
 * /orders/payment-update (see routes/orders.js's `bill-split/preview` route in this same
 * commit for how a computed breakdown is turned into that array).
 */
const { parsePrice } = require('../../utils/tax');

function toCents(amountEuros) {
  return Math.round(Number(amountEuros) * 100);
}
function fromCents(cents) {
  return Math.round(cents) / 100;
}

/**
 * Splits `totalEuros` evenly across `count` payers, distributing any leftover cent(s) one at
 * a time to the first shares so the sum is EXACTLY totalEuros to the cent -- never silently
 * off by a cent the way naive `total / count` rounding can be.
 */
function computeEvenSplit(totalEuros, count) {
  if (!Number.isInteger(count) || count < 2) {
    throw new Error('An even split needs at least 2 payers.');
  }
  const totalCents = toCents(totalEuros);
  const base = Math.floor(totalCents / count);
  let remainder = totalCents - base * count;
  const shares = [];
  for (let i = 0; i < count; i += 1) {
    let cents = base;
    if (remainder > 0) {
      cents += 1;
      remainder -= 1;
    }
    shares.push({ label: `Payer ${i + 1}`, amount: fromCents(cents) });
  }
  return shares;
}

/**
 * Splits `totalEuros` by percentage. `shares` is [{ label, percent }, ...] and percentages
 * must sum to 100 (within a small float tolerance) -- rejecting anything else rather than
 * silently normalizing it, since a caller sending percentages that don't add up almost
 * certainly has a real bug on its side. Rounding remainder (from converting each percentage
 * to a whole number of cents) is placed entirely on the LARGEST share, which is the
 * conventional, least-surprising place for a stray cent to land (nobody notices an extra
 * cent on the biggest bill; everybody notices it on the smallest one).
 */
function computePercentageSplit(totalEuros, shares) {
  if (!Array.isArray(shares) || shares.length < 2) {
    throw new Error('A percentage split needs at least 2 shares.');
  }
  const percentSum = shares.reduce((sum, s) => sum + Number(s.percent || 0), 0);
  if (Math.abs(percentSum - 100) > 0.01) {
    throw new Error(`Percentages must sum to 100 (got ${percentSum}).`);
  }
  const totalCents = toCents(totalEuros);
  const rawCents = shares.map((s) => (Number(s.percent) / 100) * totalCents);
  const roundedCents = rawCents.map((c) => Math.floor(c));
  let allocated = roundedCents.reduce((a, b) => a + b, 0);
  let remainder = totalCents - allocated;

  // Distribute remaining cents (from flooring each share) largest-fractional-part-first --
  // the standard "largest remainder" apportionment method, so the rounding is as fair as
  // possible across shares rather than dumping it all on one.
  const fractionalOrder = rawCents
    .map((c, i) => ({ i, frac: c - Math.floor(c) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < fractionalOrder.length && remainder > 0; k += 1) {
    roundedCents[fractionalOrder[k].i] += 1;
    remainder -= 1;
  }

  return shares.map((s, i) => ({ label: s.label || `Share ${i + 1}`, percent: Number(s.percent), amount: fromCents(roundedCents[i]) }));
}

/**
 * Splits an order's actual line items across payers by (lineIndex, qty) assignment -- real
 * item/seat-level splitting, not just an arbitrary amount someone typed in. Every unit of
 * every line MUST be assigned to exactly one payer; this deliberately throws rather than
 * silently prorating or dropping an unassigned line, because a bill-splitting bug that quietly
 * undercharges a table is a real, ongoing revenue leak that a human should have to notice and
 * fix at the point of entry, not discover in a month-end reconciliation.
 *
 * `lines` is the same per-line shape used everywhere else in this codebase (order.data.lines
 * -- itemId/qty/modifiers, see services/orderLineSnapshot.js's own header comment for the
 * exact shape). `products` is a Map<string, Item> for looking up price/tax, exactly as
 * orderLineSnapshot.js already does -- deliberately NOT importing that file's internals here
 * to avoid coupling two independently-tested modules; the per-line gross-amount formula is
 * intentionally duplicated (kept in sync by the shared test in test/bill-split.test.js that
 * cross-checks both against the same fixture) rather than risking a shared-refactor
 * regression in the already-shipped, already-tested snapshot path.
 */
function computeItemSplit({ lines, products, assignments }) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('No line items to split.');
  }
  if (!Array.isArray(assignments) || assignments.length < 2) {
    throw new Error('An item split needs at least 2 payers.');
  }

  const lineTotalQty = lines.map((l) => Number(l.qty ?? l.quantity ?? 1));
  const lineAssignedQty = lines.map(() => 0);

  const results = assignments.map((assignment, assignmentIndex) => {
    if (!Array.isArray(assignment.items) || assignment.items.length === 0) {
      throw new Error(`Payer "${assignment.label || assignmentIndex + 1}" has no items assigned.`);
    }
    let cents = 0;
    const claimedLines = [];
    assignment.items.forEach(({ lineIndex, qty }) => {
      if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
        throw new Error(`Invalid line index ${lineIndex}.`);
      }
      const requestedQty = Number(qty ?? 1);
      if (!(requestedQty > 0)) {
        throw new Error(`Invalid quantity for line ${lineIndex}.`);
      }
      lineAssignedQty[lineIndex] += requestedQty;
      if (lineAssignedQty[lineIndex] > lineTotalQty[lineIndex] + 1e-9) {
        throw new Error(
          `Line ${lineIndex} is over-assigned: only ${lineTotalQty[lineIndex]} unit(s) exist but ${lineAssignedQty[lineIndex]} were assigned across payers.`
        );
      }

      const line = lines[lineIndex];
      const product = products.get(String(line.itemId));
      const unitPriceGross = product ? parsePrice(product.price) : 0;
      const modifierDelta = (line.modifiers || []).reduce((sum, m) => sum + (Number(m && m.price_delta) || 0), 0);
      const effectiveUnitPriceGross = unitPriceGross + modifierDelta;
      cents += toCents(effectiveUnitPriceGross * requestedQty);
      claimedLines.push({ lineIndex, qty: requestedQty });
    });
    return { label: assignment.label || `Payer ${assignmentIndex + 1}`, amount: fromCents(cents), items: claimedLines };
  });

  const underAssignedIndex = lineAssignedQty.findIndex((assigned, i) => assigned + 1e-9 < lineTotalQty[i]);
  if (underAssignedIndex !== -1) {
    throw new Error(
      `Line ${underAssignedIndex} is not fully assigned: ${lineAssignedQty[underAssignedIndex]} of ${lineTotalQty[underAssignedIndex]} unit(s) covered. Every item must be assigned to a payer -- partial coverage would silently undercharge the table.`
    );
  }

  return results;
}

function assertSharesSumToTotal(shares, totalEuros, toleranceCents = 1) {
  const sumCents = shares.reduce((sum, s) => sum + toCents(s.amount), 0);
  if (Math.abs(sumCents - toCents(totalEuros)) > toleranceCents) {
    throw new Error(`Computed shares (€${fromCents(sumCents).toFixed(2)}) do not match the total (€${Number(totalEuros).toFixed(2)}).`);
  }
}

module.exports = { computeEvenSplit, computePercentageSplit, computeItemSplit, assertSharesSumToTotal, toCents, fromCents };
