'use strict';
/**
 * Audit event log (CTO forensic audit 2026-09-21, P1 "Complete audit-event coverage" --
 * flagged as needing verification that every sensitive op actually emits an event; there was
 * no audit trail of any kind in this codebase before this task). Proves a representative
 * sample of the sensitive ops this pass wired up actually write a real, readable event: order
 * void, refund, table transfer (whole + item-level), a role-permission change, and a staff
 * role change.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser } = require('./_helpers');
const { PERMISSIONS } = require('../config/permissions');
const Order = require('../models/Order');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('audit-log');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

async function latestEvent(eventType) {
    const res = await request(ctx.app).get(`/audit?event_type=${eventType}`).set('asmara-token', token);
    assert.equal(res.status, 200);
    return res.body.events[0];
}

test('voiding an order writes an order.void audit event', async () => {
    const order = await Order.query().insertAndFetch({ tenant_id: 1, tables: '50', status: 'ongoing', version: 1 });
    await request(ctx.app).post(`/orders/cancel/${order.id}/50`).set('asmara-token', token);

    const event = await latestEvent('order.void');
    assert.ok(event, 'expected an order.void event to exist');
    assert.equal(event.entity_type, 'order');
    assert.equal(String(event.entity_id), String(order.id));
    assert.equal(event.actor_role, 'admin');
});

test('a refund writes a payment.refund audit event', async () => {
    const order = await Order.query().insertAndFetch({ tenant_id: 1, tables: '51', status: 'completed', total: 20, version: 1 });
    // A refund can only ever be for money actually paid -- record a real charge first (same
    // payment ledger every checkout uses) so there's something to refund against.
    const paymentLedger = require('../services/payments/paymentLedger');
    await paymentLedger.recordCharges({ tenantId: 1, orderId: order.id, payments: [{ method: 'card', amount: 20 }], createdBy: 1 });

    await request(ctx.app).post(`/orders/${order.id}/refund`).set('asmara-token', token).send({ amount: 5, method: 'card', reason: 'test' });

    const event = await latestEvent('payment.refund');
    assert.ok(event);
    assert.equal(String(event.entity_id), String(order.id));
    assert.equal(event.payload.amount, 5);
    assert.equal(event.payload.method, 'card');
});

test('a whole-table transfer writes a table.transfer audit event', async () => {
    await ctx.knex('tables').insert([
        { table_number: '60', status: 'occupied', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '61', status: 'free', x: 100, y: 0, length: 80, width: 80 },
    ]);
    const order = await Order.query().insertAndFetch({ tenant_id: 1, tables: '60', status: 'ongoing', version: 1 });

    const res = await request(ctx.app).post('/tables/transfer').set('asmara-token', token).send({ from_table: '60', to_table: '61' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const event = await latestEvent('table.transfer');
    assert.ok(event);
    assert.equal(event.payload.from_table, '60');
    assert.equal(event.payload.to_table, '61');
    assert.equal(String(event.entity_id), String(order.id));
});

test('an item-level table transfer writes a table.transfer_items audit event', async () => {
    await ctx.knex('tables').insert([
        { table_number: '62', status: 'occupied', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '63', status: 'free', x: 100, y: 0, length: 80, width: 80 },
    ]);
    await Order.query().insertAndFetch({
        tenant_id: 1, tables: '62', status: 'ongoing', version: 1,
        data: JSON.stringify({ quantity: {}, lines: [{ itemId: 1, qty: 1 }, { itemId: 2, qty: 1 }] }),
        total: 20,
    });

    const res = await request(ctx.app).post('/tables/transfer-items').set('asmara-token', token)
        .send({ from_table: '62', to_table: '63', line_indexes: [0], from_table_total: 10, to_table_total: 10 });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const event = await latestEvent('table.transfer_items');
    assert.ok(event);
    assert.equal(event.payload.from_table, '62');
    assert.equal(event.payload.to_table, '63');
});

test('granting a role-permission override writes a role_permission.change audit event', async () => {
    await request(ctx.app).patch('/roles/permissions').set('asmara-token', token)
        .send({ role: 'waiter', permission: PERMISSIONS.REPORTS_VIEW, enabled: true });

    const event = await latestEvent('role_permission.change');
    assert.ok(event);
    assert.equal(event.entity_id, 'waiter');
    assert.equal(event.payload.permission, PERMISSIONS.REPORTS_VIEW);
    assert.equal(event.payload.enabled, true);

    // clean up so this override doesn't leak into other tests
    await request(ctx.app).delete('/roles/permissions').set('asmara-token', token)
        .send({ role: 'waiter', permission: PERMISSIONS.REPORTS_VIEW });
});

test('changing a staff member\'s role writes a staff.update audit event', async () => {
    const createRes = await request(ctx.app).post('/users').set('asmara-token', token)
        .send({ name: 'Audit Target', email: 'audit-target@test.local', password: 'Test1234!', role: 'waiter' });
    const userId = createRes.body.user.id;

    await request(ctx.app).patch(`/users/${userId}`).set('asmara-token', token).send({ role: 'manager' });

    const event = await latestEvent('staff.update');
    assert.ok(event);
    assert.equal(String(event.entity_id), String(userId));
    assert.equal(event.payload.changes.role, 'manager');
    assert.equal(event.payload.previous_role, 'waiter');
});

test('merging tables writes a table.merge audit event (CTO doc "Remaining Work Only", item 6)', async () => {
    await ctx.knex('tables').insert([
        { table_number: '70', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '71', status: 'free', x: 100, y: 0, length: 80, width: 80 },
    ]);

    const res = await request(ctx.app).post('/orders/link/70+71').set('asmara-token', token);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const event = await latestEvent('table.merge');
    assert.ok(event, 'expected a table.merge event to exist');
    assert.equal(event.entity_id, '70+71');
    assert.deepEqual(event.payload.tables, ['70', '71']);
});

test('splitting a merged group writes a table.split audit event (CTO doc "Remaining Work Only", item 6)', async () => {
    await ctx.knex('tables').insert([
        { table_number: '72', status: 'free', linked_to: '72+73', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '73', status: 'free', linked_to: '72+73', x: 100, y: 0, length: 80, width: 80 },
    ]);

    const res = await request(ctx.app).post('/tables/split-table/72+73').set('asmara-token', token).send({ keep_on: '72' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const event = await latestEvent('table.split');
    assert.ok(event, 'expected a table.split event to exist');
    assert.equal(event.entity_id, '72+73');
    assert.equal(event.payload.keep_on, '72');
    assert.deepEqual(event.payload.freed, ['73']);
});

test('editing an already-in-kitchen order\'s line quantities writes an order.line_edit audit event (CTO doc "Remaining Work Only", item 6)', async () => {
    const order = await ctx.knex('orders').insert({
        id: 'audit-line-edit-1', tenant_id: 1, tables: '74', status: 'in-kitchen', payment_status: 'pending',
        total: 10, data: JSON.stringify({ quantity: { 5: 1 } }), version: 1,
    });
    void order;

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/74')
        .set('asmara-token', token)
        .send({ order_id: 'audit-line-edit-1', data: { quantity: { 5: 3 } }, total: 30 });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const event = await latestEvent('order.line_edit');
    assert.ok(event, 'expected an order.line_edit event to exist');
    assert.equal(String(event.entity_id), 'audit-line-edit-1');
    assert.equal(event.payload.quantity_delta['5'], 2, 'the recorded delta must be the CHANGE (3 - 1), not the new absolute quantity');
});

test('a waiter (no reports.view by default) is refused GET /audit', async () => {
    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-audit@test.local', role: 'waiter' });
    const res = await request(ctx.app).get('/audit').set('asmara-token', waiterToken);
    assert.equal(res.status, 403);
});
