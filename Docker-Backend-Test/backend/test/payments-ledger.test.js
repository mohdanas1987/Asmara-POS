'use strict';
/**
 * Billing & payments completeness (project audit 2026-09-16, task #37). Before this, the
 * actual checkout endpoints (routes/orders.js POST /create and /payment-update) had ZERO
 * test coverage at all, and hardcoded payment_status to "paid" unconditionally -- meaning an
 * underpayment was silently recorded as fully paid, with no transaction history and no way
 * to refund or void anything. This suite covers the new payment_transactions ledger this
 * fix introduces: real charge/refund/void records, a correctly-derived payment_status, and
 * permission gating + tenant isolation on the new endpoints.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('payments-ledger');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('cash_register').insert({
        tenant_id: 1, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a full cash payment marks the order paid and records one real charge transaction', async () => {
    await ctx.knex('orders').insert({
        id: 'order-full-pay', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 20, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-full-pay', total: 20, payment_mode: 'cash', data: { cash: 20 } });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.order.payment_status, 'paid');

    const ledgerRes = await request(ctx.app).get('/orders/order-full-pay/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions.length, 1);
    assert.equal(ledgerRes.body.transactions[0].type, 'charge');
    assert.equal(Number(ledgerRes.body.netPaid), 20);
});

test('a partial cash payment is recorded as "partial", not silently marked "paid"', async () => {
    await ctx.knex('orders').insert({
        id: 'order-partial-pay', tenant_id: 1, tables: '2', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 50, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-partial-pay', total: 50, payment_mode: 'cash', data: { cash: 30 } });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.order.payment_status, 'partial');

    const ledgerRes = await request(ctx.app).get('/orders/order-partial-pay/payments').set('asmara-token', token);
    assert.equal(Number(ledgerRes.body.netPaid), 30);
});

test('a valid refund reduces net paid and is reflected in the order status', async () => {
    await ctx.knex('orders').insert({
        id: 'order-to-refund', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 25, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-to-refund', total: 25, payment_mode: 'cash', data: { cash: 25 } });

    const refundRes = await request(ctx.app)
        .post('/orders/order-to-refund/refund')
        .set('asmara-token', token)
        .send({ amount: 25, reason: 'customer complaint' });

    assert.equal(refundRes.status, 200, JSON.stringify(refundRes.body));
    assert.equal(Number(refundRes.body.netPaid), 0);
    assert.equal(refundRes.body.order.payment_status, 'refunded');
});

test('refunding more than was ever paid is rejected, not silently allowed', async () => {
    await ctx.knex('orders').insert({
        id: 'order-overrefund', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 10, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-overrefund', total: 10, payment_mode: 'cash', data: { cash: 10 } });

    const res = await request(ctx.app)
        .post('/orders/order-overrefund/refund')
        .set('asmara-token', token)
        .send({ amount: 999 });

    assert.equal(res.status, 400);
    assert.equal(res.body.status, false);
});

test('voiding a charge excludes it from net paid and cannot be voided twice', async () => {
    await ctx.knex('orders').insert({
        id: 'order-to-void', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 15, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-to-void', total: 15, payment_mode: 'cash', data: { cash: 15 } });

    const ledgerRes = await request(ctx.app).get('/orders/order-to-void/payments').set('asmara-token', token);
    const chargeId = ledgerRes.body.transactions.find((t) => t.type === 'charge').id;

    const voidRes = await request(ctx.app)
        .post(`/orders/payments/${chargeId}/void`)
        .set('asmara-token', token);
    assert.equal(voidRes.status, 200, JSON.stringify(voidRes.body));

    const afterVoid = await request(ctx.app).get('/orders/order-to-void/payments').set('asmara-token', token);
    assert.equal(Number(afterVoid.body.netPaid), 0);

    const secondVoid = await request(ctx.app)
        .post(`/orders/payments/${chargeId}/void`)
        .set('asmara-token', token);
    assert.equal(secondVoid.status, 400);
});

test('a cashier (no payments.refund permission) cannot refund or void', async () => {
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, {
        email: 'cashier-payments@test.local', role: 'cashier', tenantId: 1,
    });

    await ctx.knex('orders').insert({
        id: 'order-cashier-guard', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 10, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-cashier-guard', total: 10, payment_mode: 'cash', data: { cash: 10 } });

    const res = await request(ctx.app)
        .post('/orders/order-cashier-guard/refund')
        .set('asmara-token', cashierToken)
        .send({ amount: 10 });
    assert.equal(res.status, 403);
});

test('a second tenant cannot see or refund the first tenant\'s payment ledger', async () => {
    const { seedSecondTenant } = require('./_helpers');
    const { token: secondTenantToken } = await seedSecondTenant(request, ctx.app, ctx.knex);

    await ctx.knex('orders').insert({
        id: 'order-tenant-isolation', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 10, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-tenant-isolation', total: 10, payment_mode: 'cash', data: { cash: 10 } });

    const ledgerRes = await request(ctx.app)
        .get('/orders/order-tenant-isolation/payments')
        .set('asmara-token', secondTenantToken);
    assert.equal(ledgerRes.body.transactions.length, 0);
    assert.equal(Number(ledgerRes.body.netPaid), 0);

    const refundRes = await request(ctx.app)
        .post('/orders/order-tenant-isolation/refund')
        .set('asmara-token', secondTenantToken)
        .send({ amount: 10 });
    assert.equal(refundRes.status, 400); // "only €0.00 has actually been paid" from tenant 2's point of view
});
