'use strict';
/**
 * Cash-register accounting (CTO forensic audit 2026-09-21, "serious cash-register accounting
 * issue"): POST /orders/create used to credit the open register's `closing_cash` by the
 * order's FULL total regardless of how it was actually paid -- a split cash/card payment, or
 * even a card-only payment, was crediting the drawer money that was never physically put in
 * it. Fixed to credit only the sum of actual 'cash' charges. Refunds get the mirror fix:
 * only a cash refund debits the drawer (a card refund is reversed by the provider).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;
let registerId;

before(async () => {
    ctx = await setupTestApp('cash-register-accounting');
    token = await loginAsAdmin(request, ctx.app);
    [registerId] = await ctx.knex('cash_register').insert({
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

async function closingCash() {
    const row = await ctx.knex('cash_register').where({ id: registerId }).first();
    return Number(row.closing_cash);
}

test('a card-only payment never credits the cash drawer', async () => {
    await insertOrder('order-cash-1', 25);
    const before_ = await closingCash();

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-cash-1', total: 25, payment_mode: 'card', data: { card: 25 } });

    assert.equal(res.body.status, true);
    const after_ = await closingCash();
    assert.equal(after_, before_, 'a card-only sale must not move the cash drawer at all');
});

test('a cash-only payment credits the drawer by exactly the cash amount', async () => {
    await insertOrder('order-cash-2', 25);
    const before_ = await closingCash();

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-cash-2', total: 25, payment_mode: 'cash', data: { cash: 25 } });

    assert.equal(res.body.status, true);
    const after_ = await closingCash();
    assert.equal(after_, before_ + 25);
});

test('a split cash/card payment credits the drawer ONLY by the cash portion, not the full order total', async () => {
    await insertOrder('order-cash-3', 100);
    const before_ = await closingCash();

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({
            order_id: 'order-cash-3',
            total: 100,
            payment_mode: 'split',
            data: { cash: 40, card: 60 },
            charges: [
                { method: 'cash', amount: 40 },
                { method: 'card', amount: 60 },
            ],
        });

    assert.equal(res.body.status, true);
    const after_ = await closingCash();
    assert.equal(after_, before_ + 40, 'only the EUR40 actually collected in cash should move the drawer, not the EUR100 total');
});

test('a cash refund debits the drawer by the refunded amount', async () => {
    await insertOrder('order-cash-4', 20);
    await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-cash-4', total: 20, payment_mode: 'cash', data: { cash: 20 } });
    const afterCharge = await closingCash();

    const res = await request(ctx.app)
        .post('/orders/order-cash-4/refund')
        .set('asmara-token', token)
        .send({ amount: 5, method: 'cash', reason: 'Customer complaint' });

    assert.equal(res.body.status, true);
    const afterRefund = await closingCash();
    assert.equal(afterRefund, afterCharge - 5);
});

test('a card refund never touches the cash drawer', async () => {
    await insertOrder('order-cash-5', 20);
    await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-cash-5', total: 20, payment_mode: 'card', data: { card: 20 } });
    const afterCharge = await closingCash();

    const res = await request(ctx.app)
        .post('/orders/order-cash-5/refund')
        .set('asmara-token', token)
        .send({ amount: 5, method: 'card', reason: 'Customer complaint' });

    assert.equal(res.body.status, true);
    const afterRefund = await closingCash();
    assert.equal(afterRefund, afterCharge, 'a card refund must not change the cash drawer');
});
