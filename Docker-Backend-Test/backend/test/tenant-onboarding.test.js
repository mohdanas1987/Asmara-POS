/**
 * Real tenant onboarding: POST /auth/signup-tenant creates a brand-new restaurant (tenant
 * row) + its first admin user in one transaction and logs them straight in. Closes the gap
 * documented in the Phase 1 build plan and in routes/auth.js's long comment on the old,
 * pre-existing (and, discovered while building this, actually non-functional) /signup route.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { setupTestApp, teardownTestApp } = require('./_helpers');
const { JWT_SECRET } = require('../config/auth');

let ctx;

before(async () => {
    ctx = await setupTestApp('tenant-onboarding');
});

after(async () => {
    await teardownTestApp(ctx);
});

test('creates a new tenant + first admin user, and logs them in', async () => {
    const res = await request(ctx.app).post('/auth/signup-tenant').send({
        restaurant_name: 'Bella Napoli',
        name: 'Marco Rossi',
        email: 'marco@bellanapoli.test',
        password: 'Test1234!',
    });
    assert.equal(res.body.status, true);
    assert.ok(res.body.authToken);
    assert.equal(res.body.tenant_name, 'Bella Napoli');
    assert.equal(res.body.tenant_slug, 'bella-napoli');

    const decoded = jwt.verify(res.body.authToken, JWT_SECRET);
    assert.equal(decoded.user.tenant_id, res.body.tenant_id);

    const user = await ctx.knex('users').where('email', 'marco@bellanapoli.test').first();
    assert.equal(user.tenant_id, res.body.tenant_id);
    assert.equal(user.type, 'admin');

    const tenant = await ctx.knex('tenants').where('id', res.body.tenant_id).first();
    assert.equal(tenant.name, 'Bella Napoli');
});

test('the new tenant is fully isolated -- cannot see tenant 1 (seeded) data', async () => {
    const signupRes = await request(ctx.app).post('/auth/signup-tenant').send({
        restaurant_name: 'Isolated Test Kitchen',
        name: 'Jane Doe',
        email: 'jane@isolatedkitchen.test',
        password: 'Test1234!',
    });
    const token = signupRes.body.authToken;

    const tablesRes = await request(ctx.app).get('/tables').set('asmara-token', token);
    // The new tenant has zero tables of its own -- tenant 1's seeded tables must not leak in.
    assert.equal(tablesRes.body.tables.length, 0);
});

test('two restaurants with the same name get distinct, de-duplicated slugs', async () => {
    const first = await request(ctx.app).post('/auth/signup-tenant').send({
        restaurant_name: 'Pizza Place',
        name: 'Owner One',
        email: 'owner1@pizzaplace.test',
        password: 'Test1234!',
    });
    const second = await request(ctx.app).post('/auth/signup-tenant').send({
        restaurant_name: 'Pizza Place',
        name: 'Owner Two',
        email: 'owner2@pizzaplace.test',
        password: 'Test1234!',
    });
    assert.equal(first.body.tenant_slug, 'pizza-place');
    assert.equal(second.body.tenant_slug, 'pizza-place-2');
    assert.notEqual(first.body.tenant_id, second.body.tenant_id);
});

test('rejects a duplicate email', async () => {
    await request(ctx.app).post('/auth/signup-tenant').send({
        restaurant_name: 'First Shop',
        name: 'Alex',
        email: 'dup@test.local',
        password: 'Test1234!',
    });
    const res = await request(ctx.app).post('/auth/signup-tenant').send({
        restaurant_name: 'Second Shop',
        name: 'Sam',
        email: 'dup@test.local',
        password: 'Test1234!',
    });
    assert.equal(res.body.status, false);
    assert.equal(res.body.key, 'email');
});

test('rejects a short password / missing fields with a 400', async () => {
    const res = await request(ctx.app).post('/auth/signup-tenant').send({
        restaurant_name: 'Bad Shop',
        name: 'Al',
        email: 'notanemail',
        password: '123',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.status, false);
});
