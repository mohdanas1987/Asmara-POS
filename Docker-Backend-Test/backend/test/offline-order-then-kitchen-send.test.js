'use strict';
/**
 * CTO remediation doc, Section 2 ("offline kitchen ticket flow: local order -> local kitchen
 * ticket -> correct sync on reconnect with no duplicate tickets").
 *
 * Ground truth established before writing this: the mechanisms this needs already exist and
 * are independently tested elsewhere -- GET /orders/init/:table is idempotent
 * (offline-order-init.test.js, offline-order-init-query-key.test.js) and POST
 * /orders/to-kitchen is idempotent (pre-existing coverage). What was NOT tested anywhere is
 * the actual END-TO-END CHAIN this session's offline order creation
 * (RestaurantOS-Frontend/src/lib/offline/offlineOrders.ts + useOnlineStatus.ts's replay())
 * produces when a flush fires twice: open the table (replay-safe), THEN send its first items
 * to kitchen using the REAL id that open-table just returned (replay-safe too) -- and prove
 * that chain, replayed in full more than once, creates exactly one order and one kitchen
 * ticket, never two.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('offline-order-then-kitchen-send');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('cash_register').insert({
        tenant_id: 1, user_id: ctx.userId, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
    await ctx.knex('tables').insert([
        { table_number: '40', status: 'free', x: 0, y: 0, length: 80, width: 80 },
    ]);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('the full offline chain (open table, then send to kitchen), each step replayed twice, produces exactly one order and one kitchen send -- no duplicate tickets', async () => {
    const initKey = 'offline-chain-init-40';
    const kitchenKey = 'offline-chain-kitchen-40';

    // Step 1: "createOfflineOrder"'s queued 'orders.init-offline' action, replayed twice --
    // simulates the 'online' event and the 20s poll both firing a flush before the first
    // response was processed (exactly what useOnlineStatus.ts's own comment describes).
    const initFirst = await request(ctx.app)
        .get(`/orders/init/40?idempotency_key=${initKey}`)
        .set('asmara-token', token);
    assert.equal(initFirst.status, 200, JSON.stringify(initFirst.body));
    const orderId = initFirst.body.order.id;

    const initSecond = await request(ctx.app)
        .get(`/orders/init/40?idempotency_key=${initKey}`)
        .set('asmara-token', token);
    assert.equal(initSecond.body.order.id, orderId, 'replaying the open-table action must return the SAME order');

    // Step 2: once resolveOrderIdForReplay (offlineOrders.ts) has the real id, the queued
    // 'orders.to-kitchen' action is sent with it -- replayed twice the same way.
    const kitchenPayload = {
        order_id: orderId,
        data: { quantity: { 1: 2 }, lines: [] },
        total: 20,
        idempotency_key: kitchenKey,
    };
    const kitchenFirst = await request(ctx.app).post('/orders/to-kitchen/40').set('asmara-token', token).send(kitchenPayload);
    assert.equal(kitchenFirst.status, 200, JSON.stringify(kitchenFirst.body));

    const kitchenSecond = await request(ctx.app).post('/orders/to-kitchen/40').set('asmara-token', token).send(kitchenPayload);
    assert.equal(kitchenSecond.status, 200, JSON.stringify(kitchenSecond.body));
    assert.equal(kitchenSecond.body.order.id, kitchenFirst.body.order.id, 'replaying the kitchen-send action must return the SAME order/ticket, not a new one');

    // Exactly one order for table 40, no matter how many times either step was replayed.
    const orders = await ctx.knex('orders').where({ tenant_id: 1, tables: '40' });
    assert.equal(orders.length, 1, 'exactly one order must exist for table 40 after the full chain replayed twice at each step');
    assert.equal(orders[0].status, 'in-kitchen');

    // Exactly one status-history row for the ongoing->in-kitchen transition, proving the
    // second kitchen-send replay never re-ran the handler's side effects.
    const historyRows = await ctx.knex('order_status_history').where({ tenant_id: 1, order_id: orderId, reason: 'to-kitchen' });
    assert.equal(historyRows.length, 1, 'the replayed kitchen-send must not produce a second status-history row');
});
