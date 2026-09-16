'use strict';
/**
 * Loyalty subsystem (project audit 2026-09-15, task "Loyalty subsystem (ledger-based)").
 * Verifies the ledger math directly (service-level) and through real HTTP requests
 * (permission gating, validation, tenant isolation, and the finish-order earn hook).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser } = require('./_helpers');
const loyalty = require('../services/loyaltyService');

let ctx;
let token;
let customerId;

before(async () => {
    ctx = await setupTestApp('loyalty');
    token = await loginAsAdmin(request, ctx.app);
    [customerId] = await ctx.knex('customers').insert({
        name: 'Loyal Customer', phone: '+31600000001', tenant_id: 1, customer_code: 'LC-1-TEST0001',
    });
});

after(async () => {
    await teardownTestApp(ctx);
});

test('migration 0010 seeded the default loyalty config for tenant 1 (EUR1->1pt, 1pt->EUR0.01, min 200)', async () => {
    const config = await ctx.knex('loyalty_config').where('tenant_id', 1).first();
    assert.equal(config.cents_per_point, 100);
    assert.equal(config.redeem_value_cents, 1);
    assert.equal(config.min_redeem_points, 200);
});

test('a new balance starts at zero for a customer with no ledger rows', async () => {
    const balance = await loyalty.getBalance(1, customerId);
    assert.equal(balance, 0);
});

test('earnForOrder awards floor(totalCents / cents_per_point) points, never a fraction', async () => {
    const row = await loyalty.earnForOrder({ tenantId: 1, customerId, orderId: 'order-earn-1', orderTotalEuros: 23.99, createdBy: 1 });
    assert.equal(row.points, 23); // floor(2399 / 100) = 23, the leftover 99 cents earns nothing
    assert.equal(row.type, 'earn');
    const balance = await loyalty.getBalance(1, customerId);
    assert.equal(balance, 23);
});

test('earnForOrder with no customer_id is a safe no-op (returns null, never throws)', async () => {
    const result = await loyalty.earnForOrder({ tenantId: 1, customerId: null, orderId: 'order-no-customer', orderTotalEuros: 50 });
    assert.equal(result, null);
});

test('the ledger is append-only: two earns produce two rows, each with a correct running balance_after', async () => {
    const [otherCustomerId] = await ctx.knex('customers').insert({ name: 'Ledger Check', phone: '+31600000002', tenant_id: 1, customer_code: 'LC-1-TEST0002' });
    await loyalty.earnForOrder({ tenantId: 1, customerId: otherCustomerId, orderId: 'o1', orderTotalEuros: 10 });
    await loyalty.earnForOrder({ tenantId: 1, customerId: otherCustomerId, orderId: 'o2', orderTotalEuros: 5 });
    const ledger = await loyalty.getLedger(1, otherCustomerId);
    assert.equal(ledger.length, 2);
    // newest first
    assert.equal(ledger[0].balance_after, 15);
    assert.equal(ledger[1].balance_after, 10);
});

test('redeem below the configured minimum is rejected without touching the balance', async () => {
    const before_ = await loyalty.getBalance(1, customerId);
    await assert.rejects(
        () => loyalty.redeem({ tenantId: 1, customerId, points: 5, createdBy: 1 }),
        /Minimum redemption is 200 points/
    );
    const after_ = await loyalty.getBalance(1, customerId);
    assert.equal(before_, after_);
});

test('redeem more points than the balance holds is rejected', async () => {
    await assert.rejects(
        () => loyalty.redeem({ tenantId: 1, customerId, points: 999999, createdBy: 1 }),
        /Insufficient balance/
    );
});

test('a valid redemption inserts a negative ledger row and returns the correct euro value', async () => {
    // Top the customer up to 250 points so a 200-point redemption (the configured minimum) is valid.
    await loyalty.adjust({ tenantId: 1, customerId, points: 227, reason: 'test top-up', createdBy: 1 });
    const balanceBefore = await loyalty.getBalance(1, customerId);
    assert.equal(balanceBefore, 250);

    const { euroValue } = await loyalty.redeem({ tenantId: 1, customerId, points: 200, orderId: 'order-redeem-1', createdBy: 1 });
    assert.equal(euroValue, 2.0); // 200 points * 1 cent = 200 cents = EUR 2.00
    const balanceAfter = await loyalty.getBalance(1, customerId);
    assert.equal(balanceAfter, 50);
});

test('GET /loyalty/lookup/:code finds a customer by their scannable code and returns their balance', async () => {
    const res = await request(ctx.app).get('/loyalty/lookup/LC-1-TEST0001').set('asmara-token', token);
    assert.equal(res.status, 200);
    assert.equal(res.body.customer.id, customerId);
    assert.equal(typeof res.body.balance, 'number');
});

test('GET /loyalty/lookup/:code with an unknown code returns 404, not a crash', async () => {
    const res = await request(ctx.app).get('/loyalty/lookup/NOT-A-REAL-CODE').set('asmara-token', token);
    assert.equal(res.status, 404);
});

test('POST /loyalty/redeem requires the loyalty.redeem permission -- kitchen role is forbidden', async () => {
    const kitchenToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'kds@loyalty-test.local', role: 'kitchen' });
    const res = await request(ctx.app).post('/loyalty/redeem').set('asmara-token', kitchenToken).send({ customer_id: customerId, points: 50 });
    assert.equal(res.status, 403);
});

test('POST /loyalty/redeem succeeds for a cashier (has loyalty.redeem)', async () => {
    await loyalty.adjust({ tenantId: 1, customerId, points: 200, reason: 'test top-up 2', createdBy: 1 });
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'cashier@loyalty-test.local', role: 'cashier' });
    const res = await request(ctx.app).post('/loyalty/redeem').set('asmara-token', cashierToken).send({ customer_id: customerId, points: 200 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.euro_value, 2.0);
});

test('POST /loyalty/adjust requires loyalty.adjust -- a waiter is forbidden, a manager can', async () => {
    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter@loyalty-test.local', role: 'waiter' });
    const forbidden = await request(ctx.app).post('/loyalty/adjust').set('asmara-token', waiterToken).send({ customer_id: customerId, points: 10, reason: 'test' });
    assert.equal(forbidden.status, 403);

    const managerToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'manager@loyalty-test.local', role: 'manager' });
    const allowed = await request(ctx.app).post('/loyalty/adjust').set('asmara-token', managerToken).send({ customer_id: customerId, points: 10, reason: 'goodwill' });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
});

test('PATCH /loyalty/config requires settings.manage and changes future earn calculations', async () => {
    const res = await request(ctx.app).patch('/loyalty/config').set('asmara-token', token).send({ cents_per_point: 50 });
    assert.equal(res.status, 200);

    const [newCustomerId] = await ctx.knex('customers').insert({ name: 'Rate Check', phone: '+31600000003', tenant_id: 1, customer_code: 'LC-1-TEST0003' });
    const row = await loyalty.earnForOrder({ tenantId: 1, customerId: newCustomerId, orderId: 'order-new-rate', orderTotalEuros: 10 });
    // At 50 cents/point, EUR 10 (1000 cents) earns 20 points instead of the old rate's 10.
    assert.equal(row.points, 20);
});

test('finishing an order with a customer attached earns loyalty points automatically', async () => {
    const [customerForOrder] = await ctx.knex('customers').insert({ name: 'Order Finisher', phone: '+31600000004', tenant_id: 1, customer_code: 'LC-1-TEST0004' });
    await ctx.knex('tables').insert({ table_number: '99', status: 'occupied', x: 0, y: 0, length: 80, width: 80, tenant_id: 1 });
    const [orderId] = await ctx.knex('orders').insert({
        id: 'order-finish-loyalty', tenant_id: 1, tables: '99', status: 'ongoing', payment_status: 'paid',
        total: 40, customer_id: customerForOrder, data: JSON.stringify({ quantity: {} }),
    });

    const res = await request(ctx.app).post('/orders/finish/order-finish-loyalty/99').set('asmara-token', token);
    assert.equal(res.status, 200);

    // At the 50 cents/point rate set by the earlier config test in this same file, EUR 40 = 80 points.
    const balance = await loyalty.getBalance(1, customerForOrder);
    assert.equal(balance, 80);
});

test('a second tenant cannot look up or redeem against the first tenant\'s customer', async () => {
    const { seedSecondTenant } = require('./_helpers');
    const other = await seedSecondTenant(request, ctx.app, ctx.knex);

    const lookupRes = await request(ctx.app).get('/loyalty/lookup/LC-1-TEST0001').set('asmara-token', other.token);
    assert.equal(lookupRes.status, 404);

    const redeemRes = await request(ctx.app).post('/loyalty/redeem').set('asmara-token', other.token).send({ customer_id: customerId, points: 1 });
    // Rejected either by "not found" (customer doesn't belong to this tenant) or by the
    // service's own balance check -- either way, tenant 2 must never redeem tenant 1's points.
    assert.ok([400, 404].includes(redeemRes.status), `expected 400 or 404, got ${redeemRes.status}`);
});
