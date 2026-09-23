'use strict';
/**
 * CTO remediation doc, Section 4 ("offline payment recording... must distinguish 'payment
 * recorded locally' from 'payment externally confirmed'").
 *
 * Ground truth (see migrations_local/0025's own comment): POST /orders/create's `charges`
 * path has no live payment-provider verification step for EITHER online or offline charges
 * -- cash/card are staff-attested facts either way. So there is nothing to distinguish an
 * offline charge FROM in terms of correctness/trust; what's added is purely descriptive
 * metadata (`recorded_offline`) so a manager reviewing the ledger can see which charges came
 * through the offline queue, without it ever affecting payment_status or netPaid.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;
let orderId;

before(async () => {
    ctx = await setupTestApp('payment-recorded-offline');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('cash_register').insert({
        tenant_id: 1, user_id: ctx.userId, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
    const order = await ctx.knex('orders').insert({
        id: 'order-recorded-offline-1', tenant_id: 1, status: 'in-kitchen', payment_status: 'pending', total: '20.00', version: 1,
    }).returning('id');
    orderId = order[0].id ?? order[0] ?? 'order-recorded-offline-1';
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a charge sent with recorded_offline:true is tagged recorded_offline in the ledger', async () => {
    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({
            order_id: 'order-recorded-offline-1',
            total: 20,
            payment_mode: 'cash',
            data: { cash: 20 },
            recorded_offline: true,
        });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const ledgerRes = await request(ctx.app).get('/orders/order-recorded-offline-1/payments').set('asmara-token', token);
    assert.equal(ledgerRes.status, 200);
    assert.equal(ledgerRes.body.transactions.length, 1);
    assert.equal(ledgerRes.body.transactions[0].recorded_offline, 1, 'the ledger row must be tagged recorded_offline');
    // The tag is purely descriptive -- payment_status derivation must be completely unaffected.
    assert.equal(ledgerRes.body.netPaid, 20);
});

test('an ordinary ONLINE charge (no recorded_offline field at all) is tagged false -- fully backward compatible', async () => {
    await ctx.knex('orders').insert({
        id: 'order-recorded-offline-2', tenant_id: 1, status: 'in-kitchen', payment_status: 'pending', total: '15.00', version: 1,
    });

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-recorded-offline-2', total: 15, payment_mode: 'card', data: { card: 15 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const ledgerRes = await request(ctx.app).get('/orders/order-recorded-offline-2/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions[0].recorded_offline, 0);
});
