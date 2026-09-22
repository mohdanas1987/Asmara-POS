'use strict';
/**
 * Item-level table transfer (CTO forensic audit 2026-09-21, P1 "Item/seat-level table
 * transfer" -- flagged as missing; whole-order /tables/transfer already existed and is
 * covered by test/table-transfer.test.js, but moving only SOME of a table's items to another
 * table -- e.g. "table 4 wants to split off and move to table 7" -- was not possible).
 *
 * See the extensive comment above POST /transfer-items in routes/tables.js for the exact,
 * deliberate scope this covers (whole-line granularity, not sub-quantity or a seat model;
 * client-supplied post-split totals, the same trust boundary /to-kitchen already uses for
 * order totals; kitchen tickets already fired are left alone).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');
const Order = require('../models/Order');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('table-transfer-items');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('tables').insert([
        { table_number: '10', status: 'occupied', x: 0, y: 100, length: 80, width: 80 },
        { table_number: '11', status: 'free', x: 100, y: 100, length: 80, width: 80 },
        { table_number: '12', status: 'occupied', x: 200, y: 100, length: 80, width: 80 },
    ]);
});

after(async () => {
    await teardownTestApp(ctx);
});

async function seedOrderWithLines(tableNumber, lines) {
    const order = await Order.query().insertAndFetch({
        tenant_id: 1,
        tables: tableNumber,
        status: 'ongoing',
        version: 1,
        data: JSON.stringify({ quantity: {}, lines }),
        total: lines.length * 10,
    });
    return order.id;
}

test('rejects when line_indexes is missing or empty', async () => {
    const orderId = await seedOrderWithLines('10', [{ itemId: 1, qty: 1 }, { itemId: 2, qty: 1 }]);
    const res = await request(ctx.app).post('/tables/transfer-items').set('asmara-token', token)
        .send({ from_table: '10', to_table: '11', line_indexes: [], from_table_total: 10, to_table_total: 10 });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /line_indexes/);
    // clean up this order so it doesn't collide with later tests on table 10
    await ctx.knex('orders').where({ id: orderId }).delete();
});

test('rejects an order with fewer than 2 lines (nothing meaningful to split)', async () => {
    const orderId = await seedOrderWithLines('10', [{ itemId: 1, qty: 1 }]);
    const res = await request(ctx.app).post('/tables/transfer-items').set('asmara-token', token)
        .send({ from_table: '10', to_table: '11', line_indexes: [0], from_table_total: 0, to_table_total: 10 });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /at least 2 distinct lines/);
    await ctx.knex('orders').where({ id: orderId }).delete();
});

test('rejects selecting every line (should use whole-table transfer instead)', async () => {
    const orderId = await seedOrderWithLines('10', [{ itemId: 1, qty: 1 }, { itemId: 2, qty: 1 }]);
    const res = await request(ctx.app).post('/tables/transfer-items').set('asmara-token', token)
        .send({ from_table: '10', to_table: '11', line_indexes: [0, 1], from_table_total: 0, to_table_total: 20 });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /whole-table transfer/);
    await ctx.knex('orders').where({ id: orderId }).delete();
});

test('rejects an out-of-range line index', async () => {
    const orderId = await seedOrderWithLines('10', [{ itemId: 1, qty: 1 }, { itemId: 2, qty: 1 }]);
    const res = await request(ctx.app).post('/tables/transfer-items').set('asmara-token', token)
        .send({ from_table: '10', to_table: '11', line_indexes: [5], from_table_total: 10, to_table_total: 10 });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /valid positions/);
    await ctx.knex('orders').where({ id: orderId }).delete();
});

test('rejects when the destination table is not free', async () => {
    const orderId = await seedOrderWithLines('10', [{ itemId: 1, qty: 1 }, { itemId: 2, qty: 1 }]);
    const res = await request(ctx.app).post('/tables/transfer-items').set('asmara-token', token)
        .send({ from_table: '10', to_table: '12', line_indexes: [0], from_table_total: 10, to_table_total: 10 });
    assert.equal(res.status, 409);
    await ctx.knex('orders').where({ id: orderId }).delete();
});

test('moves selected lines to a new order on the destination table, splits totals and quantities correctly', async () => {
    const lines = [
        { itemId: 100, qty: 2, modifiers: [] },
        { itemId: 200, qty: 1, modifiers: [] },
        { itemId: 300, qty: 3, modifiers: [] },
    ];
    const orderId = await seedOrderWithLines('10', lines);

    // Move line index 1 (itemId 200) to table 11; keep lines 0 and 2 on table 10.
    const res = await request(ctx.app).post('/tables/transfer-items').set('asmara-token', token)
        .send({ from_table: '10', to_table: '11', line_indexes: [1], from_table_total: 40, to_table_total: 8 });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.sourceOrder.id, orderId);
    assert.equal(res.body.sourceOrder.tables, '10');
    assert.equal(Number(res.body.sourceOrder.total), 40);
    assert.equal(res.body.newOrder.tables, '11');
    assert.equal(Number(res.body.newOrder.total), 8);
    assert.notEqual(res.body.newOrder.id, orderId, 'the moved lines must live on a genuinely new, separate order');

    const sourceData = JSON.parse(res.body.sourceOrder.data);
    assert.equal(sourceData.lines.length, 2);
    assert.deepEqual(sourceData.lines.map((l) => l.itemId), [100, 300]);
    assert.deepEqual(sourceData.quantity, { 100: 2, 300: 3 });

    const newData = JSON.parse(res.body.newOrder.data);
    assert.equal(newData.lines.length, 1);
    assert.equal(newData.lines[0].itemId, 200);
    assert.deepEqual(newData.quantity, { 200: 1 });

    // Table statuses: destination now occupied (inherits source's prior status), source order
    // still has lines left so its table is untouched by this route (still whatever it was).
    const tablesRes = await request(ctx.app).get('/tables/').set('asmara-token', token);
    const byNumber = Object.fromEntries(tablesRes.body.tables.map((t) => [t.table_number, t.status]));
    assert.equal(byNumber['11'], 'occupied');

    await ctx.knex('orders').whereIn('id', [orderId, res.body.newOrder.id]).delete();
    await ctx.knex('tables').where({ table_number: '11' }).update({ status: 'free' });
});

test('a waiter (no tables.transfer by default) is refused item-level transfer', async () => {
    const { seedStaffUser } = require('./_helpers');
    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-item-transfer@test.local', role: 'kitchen' });
    const orderId = await seedOrderWithLines('10', [{ itemId: 1, qty: 1 }, { itemId: 2, qty: 1 }]);
    const res = await request(ctx.app).post('/tables/transfer-items').set('asmara-token', waiterToken)
        .send({ from_table: '10', to_table: '11', line_indexes: [0], from_table_total: 10, to_table_total: 10 });
    assert.equal(res.status, 403);
    await ctx.knex('orders').where({ id: orderId }).delete();
});
