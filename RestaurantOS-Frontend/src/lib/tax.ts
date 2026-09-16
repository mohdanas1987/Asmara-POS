/**
 * Menu UX refinement (project audit 2026-09-15, task #36): frontend mirror of the backend's
 * utils/tax.js. Kept intentionally tiny and dependency-free (no import across the
 * frontend/backend boundary) so the POS/menu UI can show a correct VAT breakdown without a
 * round-trip, using the exact same inclusive-VAT formula the backend now uses for real
 * calculations (item.price is already VAT-inclusive in this Dutch restaurant -- nothing is
 * added at checkout, so tax = price * rate / (100 + rate), not price * rate / 100).
 */

export function parseTaxRate(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '' || raw === 'null') return 0;
  const match = String(raw).match(/-?\d+(\.\d+)?/);
  if (!match) return 0;
  const rate = parseFloat(match[0]);
  return Number.isFinite(rate) ? rate : 0;
}

export function parsePrice(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return raw;
  const cleaned = String(raw).trim().replace(',', '.');
  const price = parseFloat(cleaned);
  return Number.isFinite(price) ? price : 0;
}

/** The VAT contained within an already-VAT-inclusive price. */
export function calculateInclusiveTax(rawPrice: unknown, rawTax: unknown): number {
  const price = parsePrice(rawPrice);
  const rate = parseTaxRate(rawTax);
  if (rate <= 0) return 0;
  return (price * rate) / (100 + rate);
}

/** The ex-VAT (net) price. */
export function calculateNetPrice(rawPrice: unknown, rawTax: unknown): number {
  return parsePrice(rawPrice) - calculateInclusiveTax(rawPrice, rawTax);
}
