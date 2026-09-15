/**
 * Phase 1 / Task #10 (multi-tenant schema + tenant-aware queries) regression suite.
 *
 * setupTestApp() seeds "tenant 1" (the original, only-ever-existed restaurant). This file
 * additionally seeds a second, completely independent restaurant (its own tenant row, its
 * own admin login, its own table numbered "1" -- deliberately colliding with tenant 1's
 * table "1" to prove the per-tenant uniqueness constraint and per-tenant scoping both hold).
 * Every test here logs in as ONE of the two restaurants and asserts it can never read or
 * write the other's data, even when it guesses an id or a table number that does exist --
 * just for the other tenant.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedSecondTenant } = require('./_helpers');

let ctx, tenant1Token, tenant2;
before(async () => {
    ctx = await setupTestApp('multitenancy');
    tenant1Token = await loginAsAdmin(request, ctx.app);
    tenant2 = await seedSecondTenant(request, ctx.app, ctx.knex);
});
after(async () => { await teardownTestApp(ctx); });

test('two tenants can each have their own "table 1" without a uniqueness conflict', async () => {
    // seedSecondTenant() already inserted a second "table 1" for tenant 2 -- if the
    // per-tenant unique constraint were wrong (e.g. still globally unique on table_number
    // alone), that insert in the `before` hook above would already have thrown and this
    // whole file would fail to even start. Getting here at all is the real assertion; this
    // test also double-checks both rows actually exist, scoped correctly.
    const row1 = await ctx.knex('tables').where({ tenant_id: 1, table_number: '1' }).first();
    const row2 = await ctx.knex('tables').where({ tenant_id: tenant2.tenantId, table_number: '1' }).first();
    assert.ok(row1, 'tenant 1 has a table "1"');
    assert.ok(row2, 'tenant 2 has its own, separate table "1"');
    assert.notEqual(row1.id, row2.id);
});

test('tenant 2 sees only its own tables, not tenant 1\'s', async () => {
    const res = await request(ctx.app).get('/tables/').set('asmara-token', tenant2.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.tables.length, 1, 'tenant 2 only ever inserted one table');
});

test('tenant 1 sees only its own tables, not tenant 2\'s', async () => {
    const res = await request(ctx.app).get('/tables/').set('asmara-token', tenant1Token);
    assert.equal(res.status, 200);
    assert.equal(res.body.tables.length, 3, 'tenant 1 was seeded with three tables');
});

test('a tax created by tenant 2 is invisible to tenant 1', async () => {
    const created = await request(ctx.app).post('/tax/create').set('asmara-token', tenant2.token)
        .send({ name: 'Tenant 2 Only Tax', amount: '21', status: true });
    assert.equal(created.status, 200);
    assert.equal(created.body.status, true);

    const tenant1List = await request(ctx.app).get('/tax/list').set('asmara-token', tenant1Token);
    assert.ok(!tenant1List.body.taxes.some(t => t.name === 'Tenant 2 Only Tax'),
        'tenant 1\'s tax list must not contain tenant 2\'s tax');

    const tenant2List = await request(ctx.app).get('/tax/list').set('asmara-token', tenant2.token);
    assert.ok(tenant2List.body.taxes.some(t => t.name === 'Tenant 2 Only Tax'),
        'tenant 2 must see its own tax');
});

test('tenant 2 cannot update a tax record that belongs to tenant 1 by guessing its id', async () => {
    const tenant1Tax = await ctx.knex('tables').where({ tenant_id: 1 }).first(); // sanity: reuse tenant1 context
    const [tax1Id] = await ctx.knex('taxes').insert({ name: 'Tenant 1 VAT', amount: '9', status: true, tenant_id: 1 });

    const res = await request(ctx.app).post('/tax/update').set('asmara-token', tenant2.token)
        .send({ id: tax1Id, name: 'Hijacked!', amount: '99', status: true });
    assert.equal(res.status, 200); // route always returns 200-shaped JSON, check the row instead
    assert.equal(res.body.status, true);
    assert.equal(res.body.tax, undefined, 'patchAndFetchById scoped to the wrong tenant finds nothing to patch');

    const stillOriginal = await ctx.knex('taxes').where({ id: tax1Id }).first();
    assert.equal(stillOriginal.name, 'Tenant 1 VAT', 'tenant 1\'s tax row must be unchanged');
});

test('tenant 2 cannot transfer an order sitting on tenant 1\'s table', async () => {
    // Tenant 1 has an active order on table "3" (seeded by setupTestApp). Tenant 2 tries to
    // "transfer" using table numbers that only exist, and only mean something, for tenant 1.
    const res = await request(ctx.app).post('/tables/transfer').set('asmara-token', tenant2.token)
        .send({ from_table: '3', to_table: '2' });
    // Neither "3" nor "2" exist for tenant 2 -- the route must report the SOURCE table
    // (tenant-scoped lookup) as not existing, not silently operate on tenant 1's table 3.
    assert.equal(res.status, 404);

    const tenant1Table3 = await ctx.knex('tables').where({ tenant_id: 1, table_number: '3' }).first();
    assert.equal(tenant1Table3.status, 'occupied', 'tenant 1\'s table 3 must be untouched by tenant 2\'s request');
});

test('logging in resolves the correct tenant automatically from the account\'s email', async () => {
    const res = await request(ctx.app).post('/auth/login')
        .send({ email: 'admin2@test.local', password: 'Test1234!' });
    assert.equal(res.status, 200);
    // Decode the JWT payload (base64url) just enough to confirm the tenant_id was embedded --
    // no secret needed to just read the payload segment.
    const payload = JSON.parse(Buffer.from(res.body.authToken.split('.')[1], 'base64').toString('utf8'));
    assert.equal(payload.user.tenant_id, tenant2.tenantId);
});
