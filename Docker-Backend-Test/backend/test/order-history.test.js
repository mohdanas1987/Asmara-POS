'use strict';
/**
 * Order domain normalization, phase 2 (CTO feedback 2026-09-22, item 8: "order_status_history
 * / order_table_history ... Historical transactional data should not depend on mutable JSON
 * structures."). Verifies that the append-only history tables added in
 * migrations_local/0022_order_status_table_history.js actually get real rows written at every
 * order-lifecycle mutation point this slice wired up: order open, to-kitchen, charge/payment,
 * cancel, finish, and table transfer/split. Deliberately additive -- these tests only check
 * that history rows exist and are correct; they do not touch (and would fail loudly if they
 * broke) any of the existing order/payment/table behavior these routes already had.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('order-history');
    token = await loginAsAdmin(request, ctx.app);
    // GET /orders/init looks up the open register by (tenant_id, user_id, status) -- must be
    // scoped to the SAME admin user_id setupTestApp created, or the lookup finds nothing and
    // the whole route short-circuits with "Start with cash register to continue!".
    await ctx.knex('cash_register').insert({
        tenant_id: 1, user_id: ctx.userId, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
    // Extra free tables beyond the two (1, 2) setupTestApp already seeds, so each test below
    // can open its own order on its own table without interfering with the others.
    await ctx.knex('tables').insert([
        { table_number: '10', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '11', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '12', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '13', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '14', status: 'free', x: 0, y: 0, length: 80, width: 80 },
    ]);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('GET /orders/init/:table records an order-opened status row and a table "open" row', async () => {
    const res = await request(ctx.app)
        .get('/orders/init/10')
        .set('asmara-token', token)
        .send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const orderId = res.body.order.id;

    const statusRows = await ctx.knex('order_status_history').where({ tenant_id: 1, order_id: orderId });
    assert.equal(statusRows.length, 1);
    assert.equal(statusRows[0].from_status, null);
    assert.equal(statusRows[0].to_status, 'ongoing');
    assert.equal(statusRows[0].reason, 'init');

    const tableRows = await ctx.knex('order_table_history').where({ tenant_id: 1, order_id: orderId });
    assert.equal(tableRows.length, 1);
    assert.equal(tableRows[0].from_table, null);
    assert.equal(tableRows[0].to_table, '10');
    assert.equal(tableRows[0].event_type, 'open');
});

test('POST /orders/to-kitchen records the ongoing -> in-kitchen status transition', async () => {
    const init = await request(ctx.app).get('/orders/init/11').set('asmara-token', token).send({});
    const orderId = init.body.order.id;

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/11')
        .set('asmara-token', token)
        .send({ order_id: orderId, data: { quantity: {} }, total: 0 });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await ctx.knex('order_status_history').where({ tenant_id: 1, order_id: orderId }).orderBy('id', 'asc');
    // row 0 is the 'init' row from GET /orders/init above; row 1 is this to-kitchen transition.
    assert.equal(rows.length, 2);
    assert.equal(rows[1].from_status, 'ongoing');
    assert.equal(rows[1].to_status, 'in-kitchen');
    assert.equal(rows[1].reason, 'to-kitchen');
});

test('POST /orders/create records the pending -> paid payment_status transition on charge', async () => {
    const init = await request(ctx.app).get('/orders/init/12').set('asmara-token', token).send({});
    const orderId = init.body.order.id;
    await request(ctx.app).post('/orders/to-kitchen/12').set('asmara-token', token)
        .send({ order_id: orderId, data: { quantity: {} }, total: 5 });

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: orderId, total: 5, payment_mode: 'cash', data: { cash: 5 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await ctx.knex('order_status_history').where({ tenant_id: 1, order_id: orderId, reason: 'orders.create:payment_status' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].from_status, 'pending');
    assert.equal(rows[0].to_status, 'paid');
});

test('POST /orders/payment-update records a payment_status transition', async () => {
    const init = await request(ctx.app).get('/orders/init/13').set('asmara-token', token).send({});
    const orderId = init.body.order.id;
    await request(ctx.app).post('/orders/to-kitchen/13').set('asmara-token', token)
        .send({ order_id: orderId, data: { quantity: {} }, total: 10 });
    // Partial charge first so payment_status is still not fully 'paid' going into payment-update.
    await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: orderId, total: 10, payment_mode: 'cash', data: { cash: 4 } });

    const res = await request(ctx.app)
        .post('/orders/payment-update')
        .set('asmara-token', token)
        .send({ order_id: orderId, payment_mode: 'cash', data: { cash: 6 }, charges: [{ method: 'cash', amount: 6 }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await ctx.knex('order_status_history').where({ tenant_id: 1, order_id: orderId, reason: 'payment-update' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].to_status, 'paid');
});

test('cancel records a status row with the pre-delete status as fromStatus', async () => {
    const init = await request(ctx.app).get('/orders/init/14').set('asmara-token', token).send({});
    const orderId = init.body.order.id;

    const res = await request(ctx.app)
        .post(`/orders/cancel/${orderId}/14`)
        .set('asmara-token', token)
        .send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await ctx.knex('order_status_history').where({ tenant_id: 1, order_id: orderId, reason: 'cancel' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].from_status, 'ongoing');
    assert.equal(rows[0].to_status, 'cancelled');
});

test('finish records a status row transitioning into completed', async () => {
    // Table 3 was seeded occupied with seed_order_001 by _helpers -- use it directly instead
    // of going through /orders/init, since finish only needs a real order id + table.
    const res = await request(ctx.app)
        .post('/orders/finish/seed_order_001/3')
        .set('asmara-token', token)
        .send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await ctx.knex('order_status_history').where({ tenant_id: 1, order_id: 'seed_order_001', reason: 'finish' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].from_status, 'ongoing');
    assert.equal(rows[0].to_status, 'completed');
});

test('POST /tables/transfer records a table_history "transfer" row', async () => {
    const init = await request(ctx.app).get('/orders/init/1').set('asmara-token', token).send({});
    const orderId = init.body.order.id;

    const res = await request(ctx.app)
        .post('/tables/transfer')
        .set('asmara-token', token)
        .send({ from_table: '1', to_table: '2' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await ctx.knex('order_table_history').where({ tenant_id: 1, order_id: orderId, event_type: 'transfer' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].from_table, '1');
    assert.equal(rows[0].to_table, '2');
});

test('splitting a merged table records a table_history "split" row for the surviving order', async () => {
    await ctx.knex('tables').insert([
        { table_number: '20', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '21', status: 'free', x: 0, y: 0, length: 80, width: 80 },
    ]);
    await ctx.knex('tables').where('table_number', '20').update({ linked_to: '20+21' });
    await ctx.knex('tables').where('table_number', '21').update({ linked_to: '20+21' });

    await ctx.knex('orders').insert({
        id: 'order-split-1', tenant_id: 1, tables: '20+21', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const res = await request(ctx.app)
        .post('/tables/split-table/20+21')
        .set('asmara-token', token)
        .send({ keep_on: '20' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await ctx.knex('order_table_history').where({ tenant_id: 1, order_id: 'order-split-1', event_type: 'split' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].from_table, '20+21');
    assert.equal(rows[0].to_table, '20');
});
