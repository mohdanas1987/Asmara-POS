/**
 * Offline billing parity (CTO remediation doc, Section 3): "the local billing engine must
 * compute prices/modifiers/quantities/discounts/VAT/net/gross/total/split allocations
 * IDENTICALLY online and offline... automated tests proving ONLINE CALCULATION == OFFLINE
 * CALCULATION for identical inputs."
 *
 * GROUND TRUTH established by actually reading both sides before writing this (not assumed):
 * there is only ONE tax/pricing calculation on the frontend (lib/tax.ts), used identically
 * whether the network is up or down -- useCart.ts's total/tax/subtotal have no network-aware
 * branch at all (confirmed by reading the whole file). So "online calculation == offline
 * calculation" is trivially true on the client BY CONSTRUCTION, not because two separate
 * implementations were reconciled. The test that actually carries real information is
 * whether the CLIENT's calculation agrees with the SERVER's -- since routes/orders.js's
 * POST /orders/create currently trusts req.body.total from the client outright (a separate,
 * pre-existing finding, not fixed here -- see the tracker's item 20/security note), the one
 * thing standing between "the charged total is right" and "the charged total is whatever the
 * client said" is these two formulas actually agreeing, for every case, not just the common
 * one. This file proves that agreement directly against the backend's real file
 * (Docker-Backend-Test/backend/utils/tax.js), not a hand-copied re-implementation of it that
 * could silently drift out of sync with the real thing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as frontendTax from '../../tax';
// Cross-project, intentional: proves agreement against the ACTUAL backend file, not a copy.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const backendTax = require('../../../../../Docker-Backend-Test/backend/utils/tax.js');

const CASES: Array<{ price: unknown; taxRate: unknown; label: string }> = [
  { price: '10.90', taxRate: '9', label: 'plain Dutch VAT-inclusive menu price' },
  { price: 10.9, taxRate: 9, label: 'numeric inputs instead of strings' },
  { price: '12,50', taxRate: '21', label: 'comma-decimal price, higher VAT rate (non-food)' },
  { price: ' 25.00 ', taxRate: '9%', label: 'whitespace and a literal % suffix on the rate' },
  { price: '0', taxRate: '9', label: 'zero price' },
  { price: '19.99', taxRate: '0', label: 'zero tax rate' },
  { price: '19.99', taxRate: null, label: 'null tax rate (untaxed item)' },
  { price: null, taxRate: '9', label: 'null price' },
  { price: 'not-a-price', taxRate: '9', label: 'malformed price string (the real bug useCart.ts guards against)' },
  { price: '100.00', taxRate: '9 VAT', label: 'a rate string with trailing text' },
];

for (const c of CASES) {
  test(`calculateInclusiveTax agrees between frontend and backend: ${c.label}`, () => {
    const frontendResult = frontendTax.calculateInclusiveTax(c.price, c.taxRate);
    const backendResult = backendTax.calculateInclusiveTax(c.price, c.taxRate);
    assert.equal(
      frontendResult,
      backendResult,
      `frontend=${frontendResult} backend=${backendResult} for price=${JSON.stringify(c.price)} taxRate=${JSON.stringify(c.taxRate)}`
    );
  });

  test(`calculateNetPrice agrees between frontend and backend: ${c.label}`, () => {
    const frontendResult = frontendTax.calculateNetPrice(c.price, c.taxRate);
    const backendResult = backendTax.calculateNetPrice(c.price, c.taxRate);
    assert.equal(frontendResult, backendResult);
  });

  test(`parsePrice agrees between frontend and backend: ${c.label}`, () => {
    assert.equal(frontendTax.parsePrice(c.price), backendTax.parsePrice(c.price));
  });
}

test('a realistic multi-line, multi-modifier cart total matches computing it the "backend way" line by line', () => {
  // Mirrors exactly what useCart.ts's `total`/`tax` useMemo blocks compute: sum of
  // (unitPrice + modifiersDelta) * qty per line, tax as the sum of each line's own
  // calculateInclusiveTax. Modifier price_delta is VAT-inclusive too, same rate as the item
  // it's attached to -- matching useCart.ts's own modifiersDelta() helper.
  const lines = [
    { price: '10.90', tax: '9', qty: 2, modifiersDelta: 0 },
    { price: '25.00', tax: '21', qty: 1, modifiersDelta: 1.5 }, // e.g. "extra topping"
    { price: '4.50', tax: '9', qty: 3, modifiersDelta: 0 },
  ];

  const frontendTotal = lines.reduce((sum, l) => sum + (frontendTax.parsePrice(l.price) + l.modifiersDelta) * l.qty, 0);
  const backendTotal = lines.reduce((sum, l) => sum + (backendTax.parsePrice(l.price) + l.modifiersDelta) * l.qty, 0);
  assert.equal(frontendTotal, backendTotal);

  const frontendTax_ = lines.reduce((sum, l) => {
    const lineTotal = (frontendTax.parsePrice(l.price) + l.modifiersDelta) * l.qty;
    return sum + frontendTax.calculateInclusiveTax(lineTotal, l.tax);
  }, 0);
  const backendTax_ = lines.reduce((sum, l) => {
    const lineTotal = (backendTax.parsePrice(l.price) + l.modifiersDelta) * l.qty;
    return sum + backendTax.calculateInclusiveTax(lineTotal, l.tax);
  }, 0);
  assert.equal(frontendTax_, backendTax_);
});
