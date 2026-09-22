'use strict';
/**
 * Bill splitting, item/seat/percentage modes (CTO feedback 2026-09-22, item 7). The
 * pre-existing test/bill-splitting.test.js covers the RECORDING side (an itemized `charges`
 * array reaching the ledger correctly) -- these tests cover the actually-new COMPUTATION side
 * (services/payments/billSplit.js + POST /orders/:order/bill-split/preview) that the
 * codebase's own comments flagged as out of scope before now: splitting evenly with correct
 * cent-rounding, splitting by percentage with correct cent-rounding, and splitting by which
 * physical items each payer is covering.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');
const billSplit = require('../services/payments/billSplit');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('bill-split');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

// --- Pure unit tests on the computation service (no HTTP, no DB) ---

test('even split of a non-divisible total distributes the leftover cent(s) rather than losing them', () => {
    const shares = billSplit.computeEvenSplit(10, 3); // €10.00 / 3 = €3.333...
    assert.equal(shares.length, 3);
    const total = shares.reduce((sum, s) => sum + billSplit.toCents(s.amount), 0);
    assert.equal(total, 1000, 'three shares must sum to exactly €10.00, not €9.99 or €10.02');
    // First share(s) absorb the extra cent(s): 334 + 333 + 333 = 1000.
    assert.deepEqual(shares.map((s) => billSplit.toCents(s.amount)).sort((a, b) => b - a), [334, 333, 333]);
});

test('even split rejects fewer than 2 payers', () => {
    assert.throws(() => billSplit.computeEvenSplit(10, 1));
});

test('percentage split of an odd total sums back exactly, with the largest remainder getting the stray cent', () => {
    const shares = billSplit.computePercentageSplit(10.01, [
        { label: 'A', percent: 50 },
        { label: 'B', percent: 30 },
        { label: 'C', percent: 20 },
    ]);
    const totalCents = shares.reduce((sum, s) => sum + billSplit.toCents(s.amount), 0);
    assert.equal(totalCents, 1001, 'percentage shares must sum to exactly the original total to the cent');
});

test('percentage split rejects percentages that do not sum to 100', () => {
    assert.throws(() => billSplit.computePercentageSplit(10, [{ label: 'A', percent: 60 }, { label: 'B', percent: 30 }]), /sum to 100/);
});

test('item split: fully assigning every line to different payers computes correct per-payer amounts', () => {
    const lines = [
        { itemId: '1', qty: 1 }, // burger, 10.00
        { itemId: '2', qty: 1 }, // fries, 4.00
    ];
    const products = new Map([
        ['1', { id: '1', price: '10.00' }],
        ['2', { id: '2', price: '4.00' }],
    ]);
    const shares = billSplit.computeItemSplit({
        lines, products,
        assignments: [
            { label: 'Seat 1', items: [{ lineIndex: 0, qty: 1 }] },
            { label: 'Seat 2', items: [{ lineIndex: 1, qty: 1 }] },
        ],
    });
    assert.equal(shares.find((s) => s.label === 'Seat 1').amount, 10);
    assert.equal(shares.find((s) => s.label === 'Seat 2').amount, 4);
});

test('item split: a shared line (qty 2) can be split by sub-quantity across two payers', () => {
    const lines = [{ itemId: '1', qty: 2 }]; // shared appetizer, 2x €6.00 = €12.00
    const products = new Map([['1', { id: '1', price: '6.00' }]]);
    const shares = billSplit.computeItemSplit({
        lines, products,
        assignments: [
            { label: 'Seat 1', items: [{ lineIndex: 0, qty: 1 }] },
            { label: 'Seat 2', items: [{ lineIndex: 0, qty: 1 }] },
        ],
    });
    assert.equal(shares.find((s) => s.label === 'Seat 1').amount, 6);
    assert.equal(shares.find((s) => s.label === 'Seat 2').amount, 6);
});

test('item split: modifiers are included in the assigned payer\'s amount', () => {
    const lines = [
        { itemId: '1', qty: 1, modifiers: [{ name: 'Extra cheese', price_delta: 1.5 }] },
        { itemId: '2', qty: 1 },
    ];
    const products = new Map([
        ['1', { id: '1', price: '10.00' }],
        ['2', { id: '2', price: '4.00' }],
    ]);
    const shares = billSplit.computeItemSplit({
        lines, products,
        assignments: [
            { label: 'Seat 1', items: [{ lineIndex: 0, qty: 1 }] }, // burger + cheese = 11.50
            { label: 'Seat 2', items: [{ lineIndex: 1, qty: 1 }] }, // fries = 4.00
        ],
    });
    assert.equal(shares.find((s) => s.label === 'Seat 1').amount, 11.5);
    assert.equal(shares.find((s) => s.label === 'Seat 2').amount, 4);
});

test('item split rejects a payer with no items assigned', () => {
    const lines = [{ itemId: '1', qty: 1 }];
    const products = new Map([['1', { id: '1', price: '10.00' }]]);
    assert.throws(() => billSplit.computeItemSplit({
        lines, products,
        assignments: [{ label: 'Seat 1', items: [{ lineIndex: 0, qty: 1 }] }, { label: 'Seat 2', items: [] }],
    }), /no items assigned/);
});

test('item split rejects an under-assigned line (would silently undercharge)', () => {
    const lines = [{ itemId: '1', qty: 2 }];
    const products = new Map([['1', { id: '1', price: '10.00' }]]);
    assert.throws(() => billSplit.computeItemSplit({
        lines, products,
        assignments: [
            { label: 'Seat 1', items: [{ lineIndex: 0, qty: 1 }] },
            { label: 'Seat 2', items: [{ lineIndex: 0, qty: 0.0001 }] }, // covers only ~1.0001 of 2 units
        ],
    }), /not fully assigned/);
});

test('item split rejects an over-assigned line (more units claimed than exist)', () => {
    const lines = [{ itemId: '1', qty: 1 }];
    const products = new Map([['1', { id: '1', price: '10.00' }]]);
    assert.throws(() => billSplit.computeItemSplit({
        lines, products,
        assignments: [
            { label: 'Seat 1', items: [{ lineIndex: 0, qty: 1 }] },
            { label: 'Seat 2', items: [{ lineIndex: 0, qty: 1 }] },
        ],
    }), /over-assigned/);
});

// --- End-to-end route tests ---

test('POST /orders/:order/bill-split/preview (even) returns shares summing to the order total', async () => {
    await ctx.knex('orders').insert({
        id: 'order-billsplit-1', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 10, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const res = await request(ctx.app).post('/orders/order-billsplit-1/bill-split/preview').set('asmara-token', token)
        .send({ mode: 'even', count: 3 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.shares.length, 3);
    const sum = res.body.shares.reduce((s, x) => s + x.amount, 0);
    assert.equal(Math.round(sum * 100), 1000);
});

test('POST /orders/:order/bill-split/preview (percentage) validates and returns correct shares', async () => {
    await ctx.knex('orders').insert({
        id: 'order-billsplit-2', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 50, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const res = await request(ctx.app).post('/orders/order-billsplit-2/bill-split/preview').set('asmara-token', token)
        .send({ mode: 'percentage', shares: [{ label: 'Alex', percent: 70 }, { label: 'Sam', percent: 30 }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.shares.find((s) => s.label === 'Alex').amount, 35);
    assert.equal(res.body.shares.find((s) => s.label === 'Sam').amount, 15);
});

test('POST /orders/:order/bill-split/preview (items) computes shares from real order lines', async () => {
    const [burgerId] = await ctx.knex('menu_items').insert({ name: 'Burger', price: '10.00', tax: '9', tenant_id: 1, category_id: 1, seq: 1 });
    const [friesId] = await ctx.knex('menu_items').insert({ name: 'Fries', price: '4.00', tax: '9', tenant_id: 1, category_id: 1, seq: 2 });
    await ctx.knex('orders').insert({
        id: 'order-billsplit-3', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({
            quantity: { [burgerId]: 1, [friesId]: 1 },
            lines: [{ itemId: burgerId, qty: 1 }, { itemId: friesId, qty: 1 }],
        }),
        total: 14, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const res = await request(ctx.app).post('/orders/order-billsplit-3/bill-split/preview').set('asmara-token', token)
        .send({
            mode: 'items',
            assignments: [
                { label: 'Seat 1', items: [{ lineIndex: 0, qty: 1 }] },
                { label: 'Seat 2', items: [{ lineIndex: 1, qty: 1 }] },
            ],
        });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.shares.find((s) => s.label === 'Seat 1').amount, 10);
    assert.equal(res.body.shares.find((s) => s.label === 'Seat 2').amount, 4);
    assert.equal(res.body.warning, null, 'lines fully cover the order total -- no mismatch warning expected');
});

test('a computed item split can be charged for real through the existing /orders/create `charges` path', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Pizza', price: '20.00', tax: '9', tenant_id: 1, category_id: 1, seq: 3 });
    await ctx.knex('cash_register').insert({ tenant_id: 1, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString() });
    await ctx.knex('orders').insert({
        id: 'order-billsplit-4', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: { [itemId]: 2 }, lines: [{ itemId, qty: 2 }] }),
        total: 40, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const previewRes = await request(ctx.app).post('/orders/order-billsplit-4/bill-split/preview').set('asmara-token', token)
        .send({
            mode: 'items',
            assignments: [
                { label: 'Seat 1', items: [{ lineIndex: 0, qty: 1 }] },
                { label: 'Seat 2', items: [{ lineIndex: 0, qty: 1 }] },
            ],
        });
    assert.equal(previewRes.status, 200, JSON.stringify(previewRes.body));

    const charges = previewRes.body.shares.map((s) => ({ method: 'cash', amount: s.amount, note: s.label }));
    const chargeRes = await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-billsplit-4', total: 40, payment_mode: 'split', data: { cash: 40 }, charges });
    assert.equal(chargeRes.status, 200, JSON.stringify(chargeRes.body));
    assert.equal(chargeRes.body.order.payment_status, 'paid');

    const ledgerRes = await request(ctx.app).get('/orders/order-billsplit-4/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions.length, 2);
    assert.equal(Number(ledgerRes.body.netPaid), 40);
});

test('POST /orders/:order/bill-split/preview rejects an unknown mode', async () => {
    await ctx.knex('orders').insert({
        id: 'order-billsplit-5', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 10, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const res = await request(ctx.app).post('/orders/order-billsplit-5/bill-split/preview').set('asmara-token', token)
        .send({ mode: 'not-a-real-mode' });
    assert.equal(res.status, 400);
});

test('POST /orders/:order/bill-split/preview 404s for a nonexistent order', async () => {
    const res = await request(ctx.app).post('/orders/does-not-exist/bill-split/preview').set('asmara-token', token)
        .send({ mode: 'even', count: 2 });
    assert.equal(res.status, 404);
});
