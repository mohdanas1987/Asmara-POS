'use strict';
/**
 * Table merge/split certification (CTO feedback 2026-09-22, item 13). A real, previously-
 * undetected bug: POST/GET /orders/link/:tables (table merge) patched `linked_to` on the
 * named tables with NO check on their current state at all -- unlike /tables/transfer
 * (requires the destination to be `free`) or /tables/split-table (requires an active order to
 * be non-completed before treating it as "the" order to keep).
 *
 * The concrete failure this let through: table 1 has its own active order (a party already
 * seated and ordering). A cashier merges it with free table 2 to seat more guests at the same
 * party. GET /orders/init/"1+2" skips its own free-table check entirely for "+"-joined params
 * (see that route's comment) and unconditionally inserts a BRAND-NEW order -- table 1's
 * original, already-in-progress order is left in the database, unpaid, but no longer
 * reachable from the merged tile in the floor plan. Reproduced below before the fix, then
 * verified fixed.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('table-merge-safety');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('tables').insert([
        { table_number: 'ms-1', status: 'free', x: 0, y: 0, length: 80, width: 80, tenant_id: 1 },
        { table_number: 'ms-2', status: 'free', x: 100, y: 0, length: 80, width: 80, tenant_id: 1 },
        { table_number: 'ms-3', status: 'free', x: 200, y: 0, length: 80, width: 80, tenant_id: 1 },
        { table_number: 'ms-4', status: 'free', x: 300, y: 0, length: 80, width: 80, tenant_id: 1 },
    ]);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('merging two free tables still works exactly as before', async () => {
    const res = await request(ctx.app).post('/orders/link/ms-1+ms-2').set('asmara-token', token).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const a = await ctx.knex('tables').where('table_number', 'ms-1').first();
    const b = await ctx.knex('tables').where('table_number', 'ms-2').first();
    assert.equal(a.linked_to, 'ms-1+ms-2');
    assert.equal(b.linked_to, 'ms-1+ms-2');
});

test('re-running the exact same merge (idempotent retry) is still a safe no-op, not newly rejected', async () => {
    const res = await request(ctx.app).post('/orders/link/ms-1+ms-2').set('asmara-token', token).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('merging a table that already has its own active order is rejected -- no orphaned order, no duplicate order', async () => {
    // ms-3 already has a real, active order sitting on it (not free) -- the exact scenario
    // that used to silently orphan an order.
    await ctx.knex('tables').where('table_number', 'ms-3').update({ status: 'order ongoing' });
    const existingId = 'order-merge-safety-1';
    await ctx.knex('orders').insert({
        id: existingId, tenant_id: 1, tables: 'ms-3', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: { 1: 2 } }), total: 20, version: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const res = await request(ctx.app).post('/orders/link/ms-3+ms-4').set('asmara-token', token).send({});
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.status, false);
    assert.match(res.body.message, /active order|different merged group/i);

    // The fix's whole point: neither table's linked_to was touched, and the pre-existing
    // order is still exactly where it was -- not orphaned, and no phantom second order exists.
    const ms3 = await ctx.knex('tables').where('table_number', 'ms-3').first();
    const ms4 = await ctx.knex('tables').where('table_number', 'ms-4').first();
    assert.equal(ms3.linked_to, null);
    assert.equal(ms4.linked_to, null);

    const ordersOnGroup = await ctx.knex('orders').where('tenant_id', 1).where('tables', 'ms-3+ms-4');
    assert.equal(ordersOnGroup.length, 0, 'no new order must have been created for the rejected merge');

    const originalOrder = await ctx.knex('orders').where({ id: existingId }).first();
    assert.ok(originalOrder, 'the pre-existing order on ms-3 must still exist, completely untouched');
    assert.equal(originalOrder.tables, 'ms-3');
});

test('merging a table that is already part of a DIFFERENT merged group is rejected', async () => {
    await ctx.knex('tables').insert([
        { table_number: 'ms-5', status: 'occupied', linked_to: 'ms-5+ms-6', x: 0, y: 0, length: 80, width: 80, tenant_id: 1 },
        { table_number: 'ms-6', status: 'occupied', linked_to: 'ms-5+ms-6', x: 100, y: 0, length: 80, width: 80, tenant_id: 1 },
        { table_number: 'ms-7', status: 'free', x: 200, y: 0, length: 80, width: 80, tenant_id: 1 },
    ]);

    const res = await request(ctx.app).post('/orders/link/ms-5+ms-7').set('asmara-token', token).send({});
    assert.equal(res.status, 409, JSON.stringify(res.body));

    const ms5 = await ctx.knex('tables').where('table_number', 'ms-5').first();
    assert.equal(ms5.linked_to, 'ms-5+ms-6', 'a rejected merge attempt must not disturb the table\'s existing real merge group');
});

test('merging a nonexistent table returns 404 and touches nothing', async () => {
    const res = await request(ctx.app).post('/orders/link/ms-1+does-not-exist').set('asmara-token', token).send({});
    assert.equal(res.status, 404, JSON.stringify(res.body));

    const ms1 = await ctx.knex('tables').where('table_number', 'ms-1').first();
    assert.notEqual(ms1.linked_to, 'ms-1+does-not-exist');
});
