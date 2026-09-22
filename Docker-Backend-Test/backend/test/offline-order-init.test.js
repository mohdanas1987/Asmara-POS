'use strict';
/**
 * Offline order creation, first real slice (CTO feedback 2026-09-22, items 2/3 -- "Offline
 * order creation" / "Complete offline outbox/sync engine").
 *
 * Ground truth established this session: the frontend (RestaurantOS-Frontend/src/lib/offline/)
 * already has a real, tested IndexedDB outbox that queues "send to kitchen" and "checkout an
 * EXISTING table order" while offline and replays them, in order, with a reused idempotency
 * key, once connectivity returns (see lib/hooks/useOnlineStatus.ts). Its own comments are
 * explicit that "opening a table / creating a brand-new order while fully offline" was left
 * OUT of that scope, because doing it safely needs two things that did not exist yet:
 *   1. GET /orders/init/:table must be safe to replay more than once with the same intent
 *      (a flush can legitimately fire twice -- the 'online' event and the 20s poll in
 *      useOnlineStatus.ts can both trigger one, or a response can be lost after the order was
 *      already created).
 *   2. A real, told-the-truth answer for what happens when two terminals both queued
 *      "open table 5" while offline and only one can win.
 *
 * This test file exercises (1), which is what actually shipped in this slice: /orders/init is
 * now wrapped in the same `idempotent()` middleware already hardened for /orders/create,
 * /orders/to-kitchen, /orders/payment-update and /orders/:order/refund. (2) is NOT solved by
 * this change -- a genuine two-terminal race for the same table still resolves however the
 * existing `table.status !== 'free'` check already resolved it (whichever request's DB read
 * happens to land first wins; the loser gets "Table is not available!"), and there is still no
 * frontend code that queues "open a new table" while offline at all (see useTables.ts's own
 * comment: openTable() "is out of this pass's offline scope"). That gap is tracked, not
 * bluffed away, in claude/cto-remaining-work-tracker.md.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('offline-order-init');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('cash_register').insert({
        tenant_id: 1, user_id: ctx.userId, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
    await ctx.knex('tables').insert([
        { table_number: '20', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '21', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '22', status: 'free', x: 0, y: 0, length: 80, width: 80 },
    ]);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('replaying a queued "open table" with the SAME idempotency key returns the same order, never a second one', async () => {
    const key = 'offline-init-table-20';

    const first = await request(ctx.app)
        .get('/orders/init/20')
        .set('asmara-token', token)
        .send({ idempotency_key: key });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, true);
    const orderId = first.body.order.id;

    // Simulates the outbox's flush firing twice for the same queued action (the 'online'
    // event and the 20s poll both triggering a flush before the first response was even
    // processed) -- the real scenario this closes.
    const second = await request(ctx.app)
        .get('/orders/init/20')
        .set('asmara-token', token)
        .send({ idempotency_key: key });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.order.id, orderId, 'a replayed open-table request must return the SAME order, not create a second one');

    const orders = await ctx.knex('orders').where({ tenant_id: 1, tables: '20' });
    assert.equal(orders.length, 1, 'exactly one order must exist for table 20, no matter how many times the queued open was replayed');

    const historyRows = await ctx.knex('order_status_history').where({ tenant_id: 1, order_id: orderId });
    assert.equal(historyRows.length, 1, 'the replayed (cached) response must not re-run the handler, so no duplicate history row either');
});

test('a genuinely concurrent double-tap of "open table" (same idempotency_key) only ever creates one order', async () => {
    const key = 'offline-init-table-21-race';

    // Same race-resolution contract already established for /payments/charge (see
    // test/payment-state-machine.test.js's own concurrent-double-tap test): the true race
    // LOSER gets a 409 "already being processed" while the winner's request is still
    // in-flight, rather than a fabricated duplicate success -- it must retry (which the
    // outbox's own attempt-tracking already does) rather than the server silently
    // pretending it also succeeded before it actually knows the outcome.
    const [a, b] = await Promise.all([
        request(ctx.app).get('/orders/init/21').set('asmara-token', token).send({ idempotency_key: key }),
        request(ctx.app).get('/orders/init/21').set('asmara-token', token).send({ idempotency_key: key }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.ok(statuses.includes(200), `expected at least one request to succeed, got ${JSON.stringify(statuses)}`);

    const orders = await ctx.knex('orders').where({ tenant_id: 1, tables: '21' });
    assert.equal(orders.length, 1, 'a genuine race on the same idempotency_key must still only ever create one order');

    // The loser retries with the same key once the winner has settled -- exactly what a
    // real outbox flush retry does -- and must be handed back the SAME order, not a second one.
    const retry = await request(ctx.app).get('/orders/init/21').set('asmara-token', token).send({ idempotency_key: key });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    const finalOrders = await ctx.knex('orders').where({ tenant_id: 1, tables: '21' });
    assert.equal(finalOrders.length, 1, 'the retried loser must be handed the same cached order, never create a second one');
});

test('two DIFFERENT idempotency keys for the same free table still correctly create only one order -- the loser sees the pre-existing table-status conflict check', async () => {
    // This is the still-open gap (item 4, multi-terminal conflict resolution): idempotency
    // only protects against the SAME queued action replaying. Two different terminals each
    // queuing their OWN "open table 22" action offline (different keys, because they never
    // saw each other) still race on the underlying `table.status !== 'free'` check exactly
    // like they did before this change -- this test documents that honestly rather than
    // implying idempotency alone solved multi-terminal conflicts.
    const keyA = 'offline-init-table-22-terminal-a';
    const keyB = 'offline-init-table-22-terminal-b';

    const first = await request(ctx.app).get('/orders/init/22').set('asmara-token', token).send({ idempotency_key: keyA });
    assert.equal(first.status, 200, JSON.stringify(first.body));

    const second = await request(ctx.app).get('/orders/init/22').set('asmara-token', token).send({ idempotency_key: keyB });
    assert.equal(second.status, 403, JSON.stringify(second.body));
    assert.equal(second.body.status, false);
    assert.match(second.body.message, /not available/i);

    const orders = await ctx.knex('orders').where({ tenant_id: 1, tables: '22' });
    assert.equal(orders.length, 1, 'only the first terminal\'s open must have created an order');
});

test('a request with NO idempotency_key (the existing online "tap a free table" flow) is completely unaffected', async () => {
    await ctx.knex('tables').insert({ table_number: '23', status: 'free', x: 0, y: 0, length: 80, width: 80 });

    const res = await request(ctx.app).get('/orders/init/23').set('asmara-token', token).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, true);
    assert.ok(res.body.order.id);
});
