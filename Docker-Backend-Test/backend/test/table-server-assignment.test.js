'use strict';
/**
 * Seat / server assignment (CTO forensic audit 2026-09-21, P1 "Seat / server assignment").
 * See migrations_local/0021_table_server_assignment.js and the PATCH /:table_number/
 * assign-server route in routes/tables.js for the exact, deliberately-scoped feature this
 * covers -- WHO is serving a table, not a full per-seat model.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('table-server-assignment');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('tables').insert({ table_number: '70', status: 'occupied', x: 0, y: 0, length: 80, width: 80 });
});

after(async () => {
    await teardownTestApp(ctx);
});

test('assigns a real staff member to a table', async () => {
    const createRes = await request(ctx.app).post('/users').set('asmara-token', token)
        .send({ name: 'Waiter One', email: 'waiter-assign@test.local', password: 'Test1234!', role: 'waiter' });
    const serverId = createRes.body.user.id;

    const res = await request(ctx.app).patch('/tables/70/assign-server').set('asmara-token', token).send({ server_id: serverId });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const tablesRes = await request(ctx.app).get('/tables/').set('asmara-token', token);
    const table = tablesRes.body.tables.find((t) => t.table_number === '70');
    assert.equal(table.assigned_server_id, serverId);
});

test('rejects assigning a staff id that does not exist in this tenant', async () => {
    const res = await request(ctx.app).patch('/tables/70/assign-server').set('asmara-token', token).send({ server_id: 999999 });
    assert.equal(res.status, 400);
});

test('unassigns by sending server_id: null', async () => {
    const res = await request(ctx.app).patch('/tables/70/assign-server').set('asmara-token', token).send({ server_id: null });
    assert.equal(res.status, 200);

    const tablesRes = await request(ctx.app).get('/tables/').set('asmara-token', token);
    const table = tablesRes.body.tables.find((t) => t.table_number === '70');
    assert.equal(table.assigned_server_id, null);
});

test('rejects an unknown table number', async () => {
    const res = await request(ctx.app).patch('/tables/does-not-exist/assign-server').set('asmara-token', token).send({ server_id: null });
    assert.equal(res.status, 404);
});

test('a kitchen role (no tables.manage) is refused server assignment', async () => {
    const kitchenToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'kitchen-assign@test.local', role: 'kitchen' });
    const res = await request(ctx.app).patch('/tables/70/assign-server').set('asmara-token', kitchenToken).send({ server_id: null });
    assert.equal(res.status, 403);
});
