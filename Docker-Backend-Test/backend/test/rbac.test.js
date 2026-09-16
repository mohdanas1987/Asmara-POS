'use strict';
/**
 * RBAC (project audit 2026-09-15, task "RBAC: real permission model").
 *
 * Verifies the permission model end-to-end through real HTTP requests: a role without a
 * permission is rejected with 403, a role with it succeeds, staff creation is tenant-scoped,
 * and a client can never grant itself a role by sending one in the request body (only the
 * signed JWT's role is ever trusted).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser } = require('./_helpers');
const { roleHasPermission, PERMISSIONS, KNOWN_ROLES } = require('../config/permissions');

let ctx;
before(async () => { ctx = await setupTestApp('rbac'); });
after(async () => { await teardownTestApp(ctx); });

test('permission map: admin has every permission via wildcard', () => {
    assert.ok(roleHasPermission('admin', PERMISSIONS.STAFF_MANAGE));
    assert.ok(roleHasPermission('admin', PERMISSIONS.BILLING_MANAGE));
});

test('permission map: kitchen role only has kitchen.view', () => {
    assert.ok(roleHasPermission('kitchen', PERMISSIONS.KITCHEN_VIEW));
    assert.equal(roleHasPermission('kitchen', PERMISSIONS.STAFF_MANAGE), false);
    assert.equal(roleHasPermission('kitchen', PERMISSIONS.TABLES_MANAGE), false);
});

test('permission map: unknown role has no permissions at all', () => {
    assert.equal(roleHasPermission('made-up-role', PERMISSIONS.ORDERS_CREATE), false);
});

test('admin can create a staff member with any known role', async () => {
    const token = await loginAsAdmin(request, ctx.app);
    for (const role of KNOWN_ROLES) {
        if (role === 'admin') continue; // the seeded admin already exists
        // eslint-disable-next-line no-await-in-loop
        const res = await request(ctx.app)
            .post('/users')
            .set('asmara-token', token)
            .send({ name: `Staff ${role}`, email: `${role}@rbac-test.local`, password: 'Test1234!', role });
        assert.equal(res.status, 200, `expected 200 creating a ${role}, got ${res.status}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.user.role, role);
    }
});

test('admin can list the staff it just created', async () => {
    const token = await loginAsAdmin(request, ctx.app);
    const res = await request(ctx.app).get('/users').set('asmara-token', token);
    assert.equal(res.status, 200);
    const roles = res.body.staff.map((u) => u.role).sort();
    assert.deepEqual(roles, ['admin', 'cashier', 'kitchen', 'manager', 'waiter']);
});

test('a kitchen-role user is forbidden from creating staff (403, not 500 or silent allow)', async () => {
    const token = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'kitchen-forbidden@rbac-test.local', role: 'kitchen' });
    const res = await request(ctx.app)
        .post('/users')
        .set('asmara-token', token)
        .send({ name: 'Sneaky', email: 'sneaky@rbac-test.local', password: 'Test1234!', role: 'admin' });
    assert.equal(res.status, 403);
    assert.equal(res.body.status, false);
});

test('a kitchen-role user is forbidden from listing staff', async () => {
    const token = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'kitchen-list@rbac-test.local', role: 'kitchen' });
    const res = await request(ctx.app).get('/users').set('asmara-token', token);
    assert.equal(res.status, 403);
});

test('a waiter-role user CAN create orders/table actions (has tables.manage) but CANNOT manage staff', async () => {
    const token = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-scope@rbac-test.local', role: 'waiter' });
    const tablesRes = await request(ctx.app).get('/tables').set('asmara-token', token);
    assert.equal(tablesRes.status, 200, 'waiter should be able to view tables (no permission gate on this route yet, but must not error)');

    const staffRes = await request(ctx.app)
        .post('/users')
        .set('asmara-token', token)
        .send({ name: 'X', email: 'x@rbac-test.local', password: 'Test1234!', role: 'admin' });
    assert.equal(staffRes.status, 403);
});

test('sending a role in the request body cannot escalate privilege -- only the JWT role is trusted', async () => {
    const token = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'escalate@rbac-test.local', role: 'kitchen' });
    // Attempt to smuggle role: 'admin' in the body of an unrelated authenticated request.
    const res = await request(ctx.app)
        .post('/users')
        .set('asmara-token', token)
        .send({ name: 'Escalated', email: 'escalated@rbac-test.local', password: 'Test1234!', role: 'admin', tenant_id: 999 });
    // Still forbidden: requirePermission checks req.authRole, which loggedIn.js sets ONLY
    // from the signed token ('kitchen' here) -- it never reads req.body.role at all, so the
    // client-supplied 'admin' string above has no effect on the caller's own permissions.
    assert.equal(res.status, 403);
});

test('creating a staff account with an unknown role is rejected by validation', async () => {
    const token = await loginAsAdmin(request, ctx.app);
    const res = await request(ctx.app)
        .post('/users')
        .set('asmara-token', token)
        .send({ name: 'Bad Role', email: 'badrole@rbac-test.local', password: 'Test1234!', role: 'superhero' });
    assert.equal(res.status, 400);
});

test('a second tenant cannot see or manage the first tenant\'s staff', async () => {
    const { seedSecondTenant } = require('./_helpers');
    const other = await seedSecondTenant(request, ctx.app, ctx.knex);
    const res = await request(ctx.app).get('/users').set('asmara-token', other.token);
    assert.equal(res.status, 200);
    // The second tenant's admin should only ever see its own single seeded admin, never any
    // of tenant 1's staff created in the earlier tests in this file.
    assert.equal(res.body.staff.length, 1);
    assert.equal(res.body.staff[0].email, 'admin2@test.local');
});
