'use strict';
/**
 * Table/Floor management redesign (project audit 2026-09-15). Covers the new
 * capacity/section metadata, GET /tables/ returning it, tableOrders' new created_at field,
 * the scoped "free selected" endpoint, and completing the merge feature (POST alias +
 * sync-log recording) for the table_number-based /orders/link route.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('table-floor');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('GET /tables/ includes capacity and section (both null until set)', async () => {
    const res = await request(ctx.app).get('/tables').set('asmara-token', token);
    assert.equal(res.status, 200);
    const table1 = res.body.tables.find((t) => t.table_number === '1');
    assert.ok(table1);
    assert.ok('capacity' in table1);
    assert.ok('section' in table1);
});

test('PATCH /tables/:table_number/details requires settings.manage -- a cashier is forbidden', async () => {
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'cashier@table-floor.local', role: 'cashier' });
    const res = await request(ctx.app).patch('/tables/1/details').set('asmara-token', cashierToken).send({ capacity: 4 });
    assert.equal(res.status, 403);
});

test('PATCH /tables/:table_number/details sets capacity and section for an admin', async () => {
    const res = await request(ctx.app).patch('/tables/1/details').set('asmara-token', token).send({ capacity: 6, section: 'Patio' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const row = await ctx.knex('tables').where('table_number', '1').first();
    assert.equal(row.capacity, 6);
    assert.equal(row.section, 'Patio');
});

test('PATCH /tables/:table_number/details on an unknown table returns 404', async () => {
    const res = await request(ctx.app).patch('/tables/does-not-exist/details').set('asmara-token', token).send({ capacity: 2 });
    assert.equal(res.status, 404);
});

test('GET /orders/ tableOrders includes created_at for elapsed-time display', async () => {
    const res = await request(ctx.app).get('/orders').set('asmara-token', token);
    assert.equal(res.status, 200);
    const seeded = res.body.tableOrders['3']; // seeded by setupTestApp on table 3
    assert.ok(seeded);
    assert.ok(seeded.created_at, 'tableOrders entries must carry created_at');
});

test('POST /tables/free/:table_numbers frees only the named table(s), not the whole floor', async () => {
    await ctx.knex('tables').insert([
        { table_number: 'floor-a', status: 'occupied', x: 0, y: 0, length: 80, width: 80, tenant_id: 1 },
        { table_number: 'floor-b', status: 'occupied', x: 100, y: 0, length: 80, width: 80, tenant_id: 1 },
    ]);
    const res = await request(ctx.app).post('/tables/free/floor-a').set('asmara-token', token);
    assert.equal(res.status, 200);

    const a = await ctx.knex('tables').where('table_number', 'floor-a').first();
    const b = await ctx.knex('tables').where('table_number', 'floor-b').first();
    assert.equal(a.status, 'free');
    assert.equal(b.status, 'occupied', 'a table not named in the request must be untouched');
});

test('POST /tables/free/:table_numbers accepts a "+"-joined merged group', async () => {
    await ctx.knex('tables').insert([
        { table_number: 'merge-a', status: 'occupied', linked_to: 'merge-a+merge-b', x: 0, y: 0, length: 80, width: 80, tenant_id: 1 },
        { table_number: 'merge-b', status: 'occupied', linked_to: 'merge-a+merge-b', x: 100, y: 0, length: 80, width: 80, tenant_id: 1 },
    ]);
    const res = await request(ctx.app).post('/tables/free/merge-a+merge-b').set('asmara-token', token);
    assert.equal(res.status, 200);
    const a = await ctx.knex('tables').where('table_number', 'merge-a').first();
    const b = await ctx.knex('tables').where('table_number', 'merge-b').first();
    assert.equal(a.status, 'free');
    assert.equal(a.linked_to, null);
    assert.equal(b.status, 'free');
    assert.equal(b.linked_to, null);
});

test('POST /orders/link/:tables merges tables and records a sync-log change', async () => {
    await ctx.knex('tables').insert([
        { table_number: 'link-a', status: 'free', x: 0, y: 0, length: 80, width: 80, tenant_id: 1 },
        { table_number: 'link-b', status: 'free', x: 100, y: 0, length: 80, width: 80, tenant_id: 1 },
    ]);
    const res = await request(ctx.app).post('/orders/link/link-a+link-b').set('asmara-token', token).send({ terminal_id: 'term-floor-test' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const a = await ctx.knex('tables').where('table_number', 'link-a').first();
    const b = await ctx.knex('tables').where('table_number', 'link-b').first();
    assert.equal(a.linked_to, 'link-a+link-b');
    assert.equal(b.linked_to, 'link-a+link-b');

    const logged = await ctx.knex('sync_log').where('entity_type', 'table_merge').orderBy('id', 'desc').first();
    assert.ok(logged);
    assert.equal(logged.terminal_id, 'term-floor-test');
    const payload = JSON.parse(logged.payload);
    assert.deepEqual(payload.tables, ['link-a', 'link-b']);
});

test('the original GET /orders/link/:tables route still works unchanged (Preservation Contract)', async () => {
    await ctx.knex('tables').insert([
        { table_number: 'legacy-a', status: 'free', x: 0, y: 0, length: 80, width: 80, tenant_id: 1 },
        { table_number: 'legacy-b', status: 'free', x: 100, y: 0, length: 80, width: 80, tenant_id: 1 },
    ]);
    const res = await request(ctx.app).get('/orders/link/legacy-a+legacy-b').set('asmara-token', token);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);
});

test('a second tenant cannot free or merge the first tenant\'s tables', async () => {
    const { seedSecondTenant } = require('./_helpers');
    const other = await seedSecondTenant(request, ctx.app, ctx.knex);

    const freeRes = await request(ctx.app).post('/tables/free/floor-b').set('asmara-token', other.token);
    assert.equal(freeRes.status, 200); // the route itself succeeds (no matching rows for this tenant)

    const stillOccupied = await ctx.knex('tables').where('table_number', 'floor-b').first();
    assert.equal(stillOccupied.status, 'occupied', 'tenant 2 must not be able to affect tenant 1\'s table via a table_number guess');
});
