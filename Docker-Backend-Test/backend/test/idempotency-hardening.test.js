'use strict';
/**
 * Idempotency hardening (CTO feedback 2026-09-22, item 11: "Idempotency hardening -- race
 * conditions, payment-specific idempotency, replay-after-restart testing"). The original
 * middlewares/idempotent.js (see test/payment-idempotency.test.js for its sequential-retry
 * coverage) had a documented gap: it only wrote a replay row AFTER the handler finished, so
 * two requests racing with the identical key could both slip past the "does a row exist yet?"
 * check and both actually run the charge. This file exercises the two things the rewrite
 * (reserve-before-run + a 'pending'/'completed' status + a TTL-based crash/restart reclaim)
 * is specifically supposed to fix, which the sequential tests in payment-idempotency.test.js
 * cannot exercise because they never send two requests at the same time.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('idempotency-hardening');
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

test('two genuinely concurrent requests with the same idempotency_key only ever charge once', async () => {
    await insertOrder('order-race-1', 20);
    const key = 'race-key-1';

    // Fired together (not awaited one at a time) -- this is exactly the race the original
    // implementation could not close: both requests reach the middleware before either has
    // finished writing anything.
    const [a, b] = await Promise.all([
        request(ctx.app).post('/orders/create').set('asmara-token', token)
            .send({ order_id: 'order-race-1', total: 20, payment_mode: 'cash', data: { cash: 20 }, idempotency_key: key }),
        request(ctx.app).post('/orders/create').set('asmara-token', token)
            .send({ order_id: 'order-race-1', total: 20, payment_mode: 'cash', data: { cash: 20 }, idempotency_key: key }),
    ]);

    // Whichever way the race resolves, the database-level unique constraint guarantees the
    // real charge only ever ran once. Both responses are either the same successful payload,
    // or one succeeded (200) and the other was refused as a conflict (409) rather than
    // silently re-running the charge.
    const statuses = [a.status, b.status].sort();
    const oneSucceeded = statuses.includes(200);
    assert.ok(oneSucceeded, `expected at least one request to succeed, got statuses ${JSON.stringify(statuses)}`);
    if (statuses[0] !== statuses[1]) {
        assert.deepEqual(statuses, [200, 409], `the loser of a genuine race must get 409, not a silently duplicated charge, got ${JSON.stringify(statuses)}`);
    }

    const ledgerRes = await request(ctx.app).get('/orders/order-race-1/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions.length, 1, 'the concurrent race must still only ever record ONE real charge');
});

test('a fresh "pending" reservation (request still genuinely in flight) refuses a same-key retry with 409, not a re-run', async () => {
    await insertOrder('order-race-2', 5);
    await ctx.knex('idempotency_keys').insert({
        tenant_id: 1, idempotency_key: 'pending-key-fresh', route: 'orders.create',
        status: 'pending', status_code: null, response_json: null,
        created_at: new Date().toISOString(),
    });

    const res = await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-race-2', total: 5, payment_mode: 'cash', data: { cash: 5 }, idempotency_key: 'pending-key-fresh' });
    assert.equal(res.status, 409);
    assert.equal(res.body.conflict, true);

    const ledgerRes = await request(ctx.app).get('/orders/order-race-2/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions.length, 0, 'a request refused as "already in progress" must not have actually charged anything');
});

test('a stale "pending" reservation (simulating a crashed/restarted request) is reclaimed and the retry actually runs', async () => {
    await insertOrder('order-race-3', 8);
    const staleTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago, past the 2 min TTL
    await ctx.knex('idempotency_keys').insert({
        tenant_id: 1, idempotency_key: 'pending-key-stale', route: 'orders.create',
        status: 'pending', status_code: null, response_json: null,
        created_at: staleTimestamp,
    });

    const res = await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-race-3', total: 8, payment_mode: 'cash', data: { cash: 8 }, idempotency_key: 'pending-key-stale' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, true);

    const ledgerRes = await request(ctx.app).get('/orders/order-race-3/payments').set('asmara-token', token);
    assert.equal(ledgerRes.body.transactions.length, 1, 'a reclaimed stale reservation must let the request actually charge');

    const row = await ctx.knex('idempotency_keys').where({ tenant_id: 1, idempotency_key: 'pending-key-stale', route: 'orders.create' }).first();
    assert.equal(row.status, 'completed');
});

test('a failed (non-2xx-equivalent) attempt does not permanently wedge the key -- a real retry can still succeed', async () => {
    // /orders/create with a bogus order_id triggers the handler's own catch block. The
    // reservation for a non-success response must be deleted, not left 'completed' with an
    // error baked in forever.
    const key = 'retryable-key-1';
    const failed = await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-does-not-exist', total: 5, payment_mode: 'cash', data: { cash: 5 }, idempotency_key: key });
    assert.notEqual(failed.status, 200);

    await insertOrder('order-race-4', 12);
    const retried = await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-race-4', total: 12, payment_mode: 'cash', data: { cash: 12 }, idempotency_key: key });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.status, true, 'the same key, reused for a genuinely different (valid) request after a failure, must be free to actually run');
});
