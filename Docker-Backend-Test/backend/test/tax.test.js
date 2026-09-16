'use strict';
/**
 * VAT-inclusive pricing (project audit 2026-09-15, task "Menu UX refinement"). Verifies the
 * corrected formula directly, plus through a real POST /items/create response, to confirm
 * the fix actually reaches the API and isn't just correct in isolation.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');
const { calculateInclusiveTax, calculateNetPrice, parseTaxRate, parsePrice } = require('../utils/tax');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('tax');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a EUR 10.90 price at 9% VAT contains EUR 0.90 of VAT, not EUR 0.981 (the old exclusive-formula bug)', () => {
    const tax = calculateInclusiveTax(10.90, '9');
    assert.ok(Math.abs(tax - 0.90) < 0.005, `expected ~0.90, got ${tax}`);
});

test('the net (ex-VAT) price of that same EUR 10.90 item is EUR 10.00', () => {
    const net = calculateNetPrice(10.90, '9');
    assert.ok(Math.abs(net - 10.00) < 0.01, `expected ~10.00, got ${net}`);
});

test('a 0% or missing tax rate yields zero tax, never NaN or a crash', () => {
    assert.equal(calculateInclusiveTax(10, '0'), 0);
    assert.equal(calculateInclusiveTax(10, null), 0);
    assert.equal(calculateInclusiveTax(10, 'null'), 0);
    assert.equal(calculateInclusiveTax(10, ''), 0);
});

test('parseTaxRate extracts the number from formats used across this codebase ("9", "9 VAT", "9.5%")', () => {
    assert.equal(parseTaxRate('9'), 9);
    assert.equal(parseTaxRate('9 VAT'), 9);
    assert.equal(parseTaxRate('9.5%'), 9.5);
});

test('parsePrice handles the comma-decimal / spaced string formats this app stores prices as', () => {
    assert.equal(parsePrice('12,50'), 12.5);
    assert.equal(parsePrice(' 12.50 '), 12.5);
    assert.equal(parsePrice(12.5), 12.5);
});

test('POST /items/create-custom returns the corrected (inclusive) taxAmount, not the old overstated one', async () => {
    const res = await request(ctx.app)
        .post('/items/create-custom')
        .set('asmara-token', token)
        .field('name', 'VAT Test Item')
        .field('price', '10.90')
        .field('tax', '9')
        .field('category_id', '1');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const taxAmount = Number(res.body.product.taxAmount);
    assert.ok(Math.abs(taxAmount - 0.90) < 0.01, `expected taxAmount ~0.90, got ${taxAmount}`);
});

test('POST /items/create (the real route the live frontend calls) now persists tax and returns a correct taxAmount', async () => {
    // Regression test for a real, separate gap found while writing this suite: /items/create
    // never included `tax` in its insert payload at all, so every item created through the
    // actual production UI got tax = null and taxAmount always computed to 0 downstream
    // (POS feed, order lines, X/Z reports). Fixed alongside the formula fix.
    const res = await request(ctx.app)
        .post('/items/create')
        .set('asmara-token', token)
        .field('name', 'VAT Test Item (create route)')
        .field('price', '10.90')
        .field('tax', '9')
        .field('barcode', `VAT-CREATE-${Date.now()}`)
        .field('category_id', '1');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.product.tax, '9', `expected tax to be persisted, got ${JSON.stringify(res.body.product.tax)}`);
    const taxAmount = Number(res.body.product.taxAmount);
    assert.ok(Math.abs(taxAmount - 0.90) < 0.01, `expected taxAmount ~0.90, got ${taxAmount}`);
});
