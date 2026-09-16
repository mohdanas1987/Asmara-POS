/**
 * Optimistic locking (execution plan gap: "no version column, no conflict-safe writes on
 * orders"). POST /orders/to-kitchen/:table? is the one route with a genuine lost-update race:
 * it reads an order's item quantities, diffs the client's desired new quantities against that
 * read, and blindly patches -- so two terminals editing the same order from the same stale
 * read would otherwise have one silently overwrite the other's changes.
 *
 * `expected_version` is optional so existing/older-frontend callers are completely unaffected
 * (asserted below); a caller that opts in gets a real conflict check instead.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('orders-optimistic-locking');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a brand-new order sent to kitchen starts at version 1', async () => {
    const res = await request(ctx.app)
        .post('/orders/to-kitchen/1')
        .set('asmara-token', token)
        .send({ data: { quantity: { 1: 2 } }, total: 10 });

    assert.equal(res.body.status, true);
    assert.equal(res.body.order.version, 1);
});

test('updating an existing order without expected_version still works unchanged (backward compatible)', async () => {
    const [orderId] = await ctx.knex('orders').insert({
        id: 'test-lock-1',
        tenant_id: 1,
        tables: '2',
        status: 'in-kitchen',
        payment_status: 'pending',
        total: 10,
        data: JSON.stringify({ quantity: { 1: 1 } }),
        version: 1,
    });

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/2')
        .set('asmara-token', token)
        .send({ order_id: 'test-lock-1', data: { quantity: { 1: 3 } }, total: 15 });

    assert.equal(res.body.status, true);
    assert.equal(res.body.order.version, 2);
});

test('a stale expected_version is rejected with a 409 conflict and does not apply the change', async () => {
    await ctx.knex('orders').insert({
        id: 'test-lock-2',
        tenant_id: 1,
        tables: '2',
        status: 'in-kitchen',
        payment_status: 'pending',
        total: 10,
        data: JSON.stringify({ quantity: { 1: 1 } }),
        version: 3,
    });

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/2')
        .set('asmara-token', token)
        .send({ order_id: 'test-lock-2', expected_version: 1, data: { quantity: { 1: 9 } }, total: 90 });

    assert.equal(res.status, 409);
    assert.equal(res.body.status, false);
    assert.equal(res.body.conflict, true);

    const stored = await ctx.knex('orders').where({ id: 'test-lock-2' }).first();
    assert.equal(stored.version, 3);
    assert.equal(JSON.parse(stored.data).quantity['1'], 1);
});

test('a matching expected_version succeeds and increments the version', async () => {
    await ctx.knex('orders').insert({
        id: 'test-lock-3',
        tenant_id: 1,
        tables: '2',
        status: 'in-kitchen',
        payment_status: 'pending',
        total: 10,
        data: JSON.stringify({ quantity: { 1: 1 } }),
        version: 5,
    });

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/2')
        .set('asmara-token', token)
        .send({ order_id: 'test-lock-3', expected_version: 5, data: { quantity: { 1: 4 } }, total: 40 });

    assert.equal(res.body.status, true);
    assert.equal(res.body.order.version, 6);
});
