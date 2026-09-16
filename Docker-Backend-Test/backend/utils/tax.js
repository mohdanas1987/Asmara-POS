'use strict';
/**
 * VAT-inclusive pricing (project audit 2026-09-15, task "Menu UX refinement": "VAT-inclusive
 * pricing must be enforced at domain level, not merely fixed visually").
 *
 * REAL BUG FOUND while building this: every place in this codebase that computed a
 * product's tax amount (routes/items.js, routes/orders.js x3, routes/pos.js, and utils.js's
 * X/Z report generator) used the EXCLUSIVE-tax formula `price * rate / 100` -- correct only
 * if `price` does NOT already include VAT. But this is a Dutch restaurant, where consumer-
 * facing prices are legally required to already include VAT (menu prices are what the
 * customer pays, full stop -- nothing is added at checkout, confirmed by reading the actual
 * checkout/payment code, which never adds a tax amount to the charged total). Given an
 * inclusive price, the embedded tax is `price * rate / (100 + rate)`, NOT
 * `price * rate / 100` -- the old formula overstated the VAT portion on every X/Z report
 * and item tax display (e.g. a menu price of EUR 10.90 at 9% VAT actually contains EUR 0.90
 * of VAT and EUR 10.00 net, not EUR 0.981 of VAT as the old formula would have reported).
 *
 * This is the ONE place this calculation happens now; every call site listed above was
 * updated to call this instead of repeating (and never fixing) its own copy of the wrong formula.
 */

/** Extracts the numeric rate from a tax value that might be "9", "9 VAT", "9.5%", etc. */
function parseTaxRate(rawTax) {
  if (rawTax === undefined || rawTax === null || rawTax === 'null' || rawTax === '') return 0;
  const match = String(rawTax).match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

/** Coerces a price that might be a string with spaces/commas (as stored/typed in this app,
 * e.g. "12,50" or " 12.50") into a real number. */
function parsePrice(rawPrice) {
  if (typeof rawPrice === 'number') return rawPrice;
  if (!rawPrice) return 0;
  return parseFloat(String(rawPrice).replace(/\s+/g, '').replace(',', '.')) || 0;
}

/** The VAT amount embedded in an already-VAT-inclusive price. */
function calculateInclusiveTax(rawPrice, rawTax) {
  const rate = parseTaxRate(rawTax);
  const price = parsePrice(rawPrice);
  if (!rate || !price) return 0;
  return (price * rate) / (100 + rate);
}

/** The net (ex-VAT) price, for reports that need to show the pre-tax figure. */
function calculateNetPrice(rawPrice, rawTax) {
  return parsePrice(rawPrice) - calculateInclusiveTax(rawPrice, rawTax);
}

module.exports = { parseTaxRate, parsePrice, calculateInclusiveTax, calculateNetPrice };
