'use strict';
/**
 * Payment / order idempotency (CTO forensic audit 2026-09-21, P0 "Payment idempotency +
 * recovery"). A retried POST /orders/create or POST /orders/:order/refund carrying the same
 * client-supplied `idempotency_key` must replay the ORIGINAL result -- never re-run the
 * charge or refund a second time. A request that never sends a key is completely unaffected
 * (Preservation Contract for every existing caller/test).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('payment-idempotency');
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

test('retrying /orders/create with the same idempotency_key replays the original response and only charges once', async () => {
    await insertOrder('order-idem-1', 15);
    const key = 'test-idem-key-1';

    const first = await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-idem-1', total: 15, payment_mode: 'cash', data: { cash: 15 }, idempotency_key: key });
    assert.equal(first.body.status, true);

    const second = await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-idem-1', total: 15, payment_mode: 'cash', data: { cash: 15 }, idempotency_key: key });
    assert.equal(second.status, first.status);
    assert.deepEqual(second.body, first.body, 'a retried request must replay the exact original response');

    const ledgerRes = await request(ctx.app).get('/orders/order-idem-1/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions.length, 1, 'the charge must only be recorded once, not twice, despite two requests');
});

test('two DIFFERENT idempotency_keys for the same order are both honored as separate real charges', async () => {
    await insertOrder('order-idem-2', 40);

    await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-idem-2', total: 20, payment_mode: 'cash', data: { cash: 20 }, idempotency_key: 'key-a' });
    await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-idem-2', total: 20, payment_mode: 'cash', data: { cash: 20 }, idempotency_key: 'key-b' });

    const ledgerRes = await request(ctx.app).get('/orders/order-idem-2/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions.length, 2, 'two genuinely different keys must both be recorded as real, separate charges');
});

test('a request with no idempotency_key at all behaves exactly as before (no replay protection, no error)', async () => {
    await insertOrder('order-idem-3', 10);
    const res = await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-idem-3', total: 10, payment_mode: 'card', data: { card: 10 } });
    assert.equal(res.body.status, true);
});

test('retrying a refund with the same idempotency_key only debits the drawer once', async () => {
    await insertOrder('order-idem-4', 30);
    await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-idem-4', total: 30, payment_mode: 'cash', data: { cash: 30 } });

    const key = 'refund-idem-key-1';
    const first = await request(ctx.app).post('/orders/order-idem-4/refund').set('asmara-token', token)
        .send({ amount: 10, method: 'cash', idempotency_key: key });
    assert.equal(first.body.status, true);

    const second = await request(ctx.app).post('/orders/order-idem-4/refund').set('asmara-token', token)
        .send({ amount: 10, method: 'cash', idempotency_key: key });
    assert.deepEqual(second.body, first.body);

    const ledgerRes = await request(ctx.app).get('/orders/order-idem-4/payments').set('asmara-token', token);
    const refunds = ledgerRes.body.transactions.filter((t) => t.type === 'refund');
    assert.equal(refunds.length, 1, 'the refund must only be recorded once despite two identical-key requests');
});
