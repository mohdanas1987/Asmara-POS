'use strict';
/**
 * Bill splitting (task #49). The `modes` object accepted by POST /orders/create and
 * /orders/payment-update can only ever represent one charge per distinct payment METHOD
 * (it's a { method: amount } object) -- two people who both pay by card can't both be
 * recorded through it. This adds a purely additive `charges` array alongside it: itemized
 * { method, amount, note? } rows, merged into the same ledger. A caller that never sends
 * `charges` (every existing frontend call before this task, and the existing payments-ledger
 * suite) is completely unaffected -- covered by the first test below.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('bill-splitting');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('cash_register').insert({
        tenant_id: 1, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
});

after(async () => {
    await teardownTestApp(ctx);
});

async function insertOrder(id, total) {
    await ctx.knex('orders').insert({
        id, tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
}

test('a normal single-method charge (no `charges` array) behaves exactly as before', async () => {
    await insertOrder('order-split-none', 20);

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-split-none', total: 20, payment_mode: 'card', data: { card: 20 } });

    assert.equal(res.body.status, true);
    assert.equal(res.body.order.payment_status, 'paid');

    const ledgerRes = await request(ctx.app).get('/orders/order-split-none/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions.length, 1);
    assert.equal(Number(ledgerRes.body.transactions[0].amount), 20);
});

test('splitting a bill three ways (two of them the same method) records three separate ledger rows and sums to the full total', async () => {
    await insertOrder('order-split-three', 30);

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({
            order_id: 'order-split-three',
            total: 30,
            payment_mode: 'split',
            data: { cash: 10, card: 20 }, // merged-by-method total, for display/order.data only
            charges: [
                { method: 'cash', amount: 10, note: 'Seat 1' },
                { method: 'card', amount: 10, note: 'Seat 2' },
                { method: 'card', amount: 10, note: 'Seat 3' },
            ],
        });

    assert.equal(res.body.status, true);
    assert.equal(res.body.order.payment_status, 'paid');

    const ledgerRes = await request(ctx.app).get('/orders/order-split-three/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions.length, 3, 'each split charge should be its own ledger row, even the two sharing a method');
    assert.equal(Number(ledgerRes.body.netPaid), 30);
    const notes = ledgerRes.body.transactions.map((t) => t.note).sort();
    assert.deepEqual(notes, ['Seat 1', 'Seat 2', 'Seat 3']);
});

test('an underpaid split (charges sum to less than the total) correctly shows partial, not paid', async () => {
    await insertOrder('order-split-partial', 50);

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({
            order_id: 'order-split-partial',
            total: 50,
            payment_mode: 'split',
            data: { cash: 20 },
            charges: [
                { method: 'cash', amount: 20, note: 'Seat 1' },
                // Seat 2 hasn't paid yet.
            ],
        });

    assert.equal(res.body.order.payment_status, 'partial');
});

test('a malformed charges entry (negative amount, missing method) is silently ignored rather than crashing or being recorded', async () => {
    await insertOrder('order-split-malformed', 15);

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({
            order_id: 'order-split-malformed',
            total: 15,
            payment_mode: 'split',
            data: { cash: 15 },
            charges: [
                { method: 'cash', amount: 15 },
                { amount: 5 }, // no method -- must be dropped, not crash
                { method: 'card', amount: -5 }, // negative -- must be dropped
            ],
        });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);

    const ledgerRes = await request(ctx.app).get('/orders/order-split-malformed/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions.length, 1, 'only the one valid charge should have been recorded');
    assert.equal(Number(ledgerRes.body.netPaid), 15);
});
