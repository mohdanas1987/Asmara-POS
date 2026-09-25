'use strict';
/**
 * Conflict records (CTO doc "Asmara POS -- Remaining Work Only", Phase 21/item 2: "conflict
 * records" -- previously a conflict was only ever a transient 409 response, nothing durable).
 * See migrations_local/0027 and services/conflictLog.js.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedSecondTenant } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('sync-conflicts');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('cash_register').insert({ tenant_id: 1, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString() });
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a stale expected_version on /orders/to-kitchen is recorded as a durable, resolved conflict', async () => {
    await ctx.knex('orders').insert({
        id: 'conflict-order-1', tenant_id: 1, tables: '90', status: 'in-kitchen', payment_status: 'pending',
        total: 10, data: JSON.stringify({ quantity: { 1: 1 } }), version: 3,
    });

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/90')
        .set('asmara-token', token)
        .send({ order_id: 'conflict-order-1', expected_version: 1, terminal_id: 'kiosk-A', data: { quantity: { 1: 9 } }, total: 90 });
    assert.equal(res.status, 409);

    const rows = await ctx.knex('sync_conflicts').where({ tenant_id: 1, entity_type: 'order', entity_id: 'conflict-order-1' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].route, 'orders.to-kitchen');
    assert.equal(rows[0].local_version, 1);
    assert.equal(rows[0].server_version, 3);
    assert.equal(rows[0].terminal_id, 'kiosk-A');
    assert.equal(rows[0].resolution, 'rejected_stale_write');
    assert.ok(rows[0].resolved_at, 'a reject-stale conflict is resolved the moment it is detected, not left pending');
});

test('a stale expected_version on /orders/create is also recorded', async () => {
    await ctx.knex('orders').insert({
        id: 'conflict-order-2', tenant_id: 1, tables: '91', status: 'in-kitchen', payment_status: 'pending',
        total: 10, data: JSON.stringify({ cash: 10 }), version: 4,
    });

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'conflict-order-2', expected_version: 1, total: 10, payment_mode: 'cash', data: { cash: 10 } });
    assert.equal(res.status, 409);

    const rows = await ctx.knex('sync_conflicts').where({ tenant_id: 1, entity_type: 'order', entity_id: 'conflict-order-2', route: 'orders.create' });
    assert.equal(rows.length, 1);
});

test('a rejected total-mismatch is recorded under a distinct entity_type from a version conflict', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Pasta', price: 12, tenant_id: 1, category_id: 1, seq: 300 });
    await ctx.knex('orders').insert({
        id: 'conflict-order-3', tenant_id: 1, tables: '92', status: 'in-kitchen', payment_status: 'pending',
        total: 12, data: JSON.stringify({ quantity: { [itemId]: 1 } }), version: 1,
    });

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'conflict-order-3', total: 1, payment_mode: 'cash', data: { cash: 1 } });
    assert.equal(res.status, 409);
    assert.equal(res.body.totalMismatch, true);

    const rows = await ctx.knex('sync_conflicts').where({ tenant_id: 1, entity_type: 'order_total', entity_id: 'conflict-order-3' });
    assert.equal(rows.length, 1);
    const detail = JSON.parse(rows[0].detail);
    assert.equal(detail.submitted_total, 1);
    assert.equal(detail.computed_total, 12);
});

test('GET /sync/conflicts lists recorded conflicts, newest first, scoped to the caller\'s own tenant', async () => {
    const { token: token2 } = await seedSecondTenant(request, ctx.app, ctx.knex);

    const listRes = await request(ctx.app).get('/sync/conflicts').set('asmara-token', token);
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.conflicts.length >= 3, 'expects at least the 3 conflicts recorded by the earlier tests in this file');

    const otherTenantRes = await request(ctx.app).get('/sync/conflicts').set('asmara-token', token2);
    assert.equal(otherTenantRes.status, 200);
    assert.equal(otherTenantRes.body.conflicts.length, 0, 'a different tenant must never see tenant 1\'s conflict records');
});

test('a version-matching (non-conflicting) request never creates a conflict row', async () => {
    await ctx.knex('orders').insert({
        id: 'conflict-order-4', tenant_id: 1, tables: '93', status: 'in-kitchen', payment_status: 'pending',
        total: 10, data: JSON.stringify({ quantity: { 1: 1 } }), version: 1,
    });

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/93')
        .set('asmara-token', token)
        .send({ order_id: 'conflict-order-4', expected_version: 1, data: { quantity: { 1: 2 } }, total: 20 });
    assert.equal(res.status, 200);

    const rows = await ctx.knex('sync_conflicts').where({ tenant_id: 1, entity_id: 'conflict-order-4' });
    assert.equal(rows.length, 0);
});
