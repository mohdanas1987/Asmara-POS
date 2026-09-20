'use strict';
/**
 * Table split (CTO forensic audit 2026-09-20, "table split ... currently merge only works
 * for free tables" -- flagged as a real gap: the only route that existed for undoing a merge
 * (POST/GET /tables/split-table/:table_number) unlinked the tables but then deleted whatever
 * order was already running on them outright, discarding real ordered items. Covers the
 * rewritten behavior: a genuine merged-group split keeps the order alive on whichever table
 * is chosen to keep it, and the legacy single-table behavior (no "+") is unchanged.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');
const Order = require('../models/Order');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('table-split');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

async function linkTables(tableNumbers) {
    const link = tableNumbers.join('+');
    await ctx.knex('tables').whereIn('table_number', tableNumbers).update({ linked_to: link, status: 'occupied' });
    return link;
}

test('splitting a merged group with a running order keeps that order on the chosen table, and frees the rest', async () => {
    const link = await linkTables(['1', '2']);
    const order = await Order.query().insertAndFetch({ tenant_id: 1, tables: link, status: 'ongoing', total: 25, version: 1 });

    const res = await request(ctx.app)
        .post(`/tables/split-table/${encodeURIComponent(link)}`)
        .set('asmara-token', token)
        .send({ keep_on: '2' });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);
    assert.equal(res.body.keptOn, '2');
    assert.deepEqual(res.body.freed, ['1']);

    const updatedOrder = await Order.query().findById(order.id);
    assert.equal(updatedOrder.tables, '2', 'the order must survive the split, moved onto the kept table');
    assert.notEqual(updatedOrder.status, undefined);

    const table1 = await ctx.knex('tables').where({ table_number: '1' }).first();
    const table2 = await ctx.knex('tables').where({ table_number: '2' }).first();
    assert.equal(table1.linked_to, null);
    assert.equal(table1.status, 'free');
    assert.equal(table2.linked_to, null);
    assert.equal(table2.status, 'occupied');
});

test('splitting a merged group with no active order just unlinks and frees every table in it', async () => {
    await linkTables(['1', '2']);

    const res = await request(ctx.app)
        .post('/tables/split-table/1+2')
        .set('asmara-token', token)
        .send({});

    assert.equal(res.status, 200);
    assert.equal(res.body.keptOn, '1', 'with no keep_on given, the first table in the group is kept by default');
    assert.deepEqual(res.body.freed, ['2']);

    const table1 = await ctx.knex('tables').where({ table_number: '1' }).first();
    const table2 = await ctx.knex('tables').where({ table_number: '2' }).first();
    assert.equal(table1.status, 'free');
    assert.equal(table2.status, 'free');
});

test('an invalid keep_on (not a member of the group) falls back to the first table, rather than erroring', async () => {
    const link = await linkTables(['1', '2']);
    const order = await Order.query().insertAndFetch({ tenant_id: 1, tables: link, status: 'ongoing', total: 10, version: 1 });

    const res = await request(ctx.app)
        .post(`/tables/split-table/${encodeURIComponent(link)}`)
        .set('asmara-token', token)
        .send({ keep_on: '99' });

    assert.equal(res.status, 200);
    assert.equal(res.body.keptOn, '1');

    const updatedOrder = await Order.query().findById(order.id);
    assert.equal(updatedOrder.tables, '1');
});

test('splitting a single, non-merged table keeps the legacy behavior: order deleted, table freed', async () => {
    // table 3 comes pre-seeded (see _helpers.js) as occupied with an 'ongoing' order.
    const res = await request(ctx.app)
        .post('/tables/split-table/3')
        .set('asmara-token', token)
        .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Tables freed');

    const table3 = await ctx.knex('tables').where({ table_number: '3' }).first();
    assert.equal(table3.status, 'free');

    const order = await Order.query().findById('seed_order_001');
    assert.equal(order, undefined, 'legacy single-table split still deletes the ongoing order');
});
