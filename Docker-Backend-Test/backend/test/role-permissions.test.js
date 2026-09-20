'use strict';
/**
 * role_permissions as a real, editable table (CTO forensic audit 2026-09-20, task
 * "role_permissions" -- flagged as missing, correctly). Covers: an untouched tenant behaves
 * identically to the hardcoded default (Preservation Contract), an explicit override
 * actually changes enforcement on a real route, reverting an override restores the default,
 * admin's wildcard can never be overridden, and overrides never leak across tenants.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser, seedSecondTenant } = require('./_helpers');
const { roleHasPermission, roleHasPermissionForTenant, PERMISSIONS } = require('../config/permissions');

let ctx;
let adminToken;

before(async () => {
    ctx = await setupTestApp('role-permissions');
    adminToken = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('with no overrides, the tenant-aware check matches the original hardcoded default exactly', async () => {
    for (const role of ['manager', 'cashier', 'waiter', 'kitchen']) {
        for (const permission of Object.values(PERMISSIONS)) {
            // eslint-disable-next-line no-await-in-loop
            const tenantAware = await roleHasPermissionForTenant(1, role, permission);
            assert.equal(tenantAware, roleHasPermission(role, permission), `${role}/${permission} diverged from default with no override`);
        }
    }
});

test('a waiter is refused orders.void by default, matching the hardcoded map', async () => {
    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-rp@test.local', role: 'waiter' });
    const res = await request(ctx.app)
        .post('/orders/cancel/seed_order_001/1')
        .set('asmara-token', waiterToken);
    assert.equal(res.status, 401);
});

test('GET /roles/permissions returns the full matrix with no overrides marked', async () => {
    const res = await request(ctx.app).get('/roles/permissions').set('asmara-token', adminToken);
    assert.equal(res.status, 200);
    const waiterRow = res.body.matrix.find((r) => r.role === 'waiter');
    const tablesManage = waiterRow.permissions.find((p) => p.permission === PERMISSIONS.TABLES_MANAGE);
    assert.equal(tablesManage.enabled, true);
    assert.equal(tablesManage.isOverride, false);
});

test('granting waiter an extra permission via PATCH actually changes enforcement', async () => {
    const patchRes = await request(ctx.app)
        .patch('/roles/permissions')
        .set('asmara-token', adminToken)
        .send({ role: 'waiter', permission: PERMISSIONS.REPORTS_VIEW, enabled: true });
    assert.equal(patchRes.status, 200);

    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-rp2@test.local', role: 'waiter' });
    const res = await request(ctx.app).get('/reports/sales').set('asmara-token', waiterToken);
    assert.equal(res.status, 200, 'waiter should now be able to view reports after the override');
});

test('the matrix now shows that permission as an explicit override, not just a default', async () => {
    const res = await request(ctx.app).get('/roles/permissions').set('asmara-token', adminToken);
    const waiterRow = res.body.matrix.find((r) => r.role === 'waiter');
    const reportsView = waiterRow.permissions.find((p) => p.permission === PERMISSIONS.REPORTS_VIEW);
    assert.equal(reportsView.enabled, true);
    assert.equal(reportsView.isOverride, true);
    assert.equal(reportsView.default, false, 'the hardcoded default for waiter must be untouched');
});

test('DELETE /roles/permissions reverts to the hardcoded default', async () => {
    const del = await request(ctx.app)
        .delete('/roles/permissions')
        .set('asmara-token', adminToken)
        .send({ role: 'waiter', permission: PERMISSIONS.REPORTS_VIEW });
    assert.equal(del.status, 200);

    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-rp3@test.local', role: 'waiter' });
    const res = await request(ctx.app).get('/reports/sales').set('asmara-token', waiterToken);
    assert.equal(res.status, 403, 'waiter should be refused again once the override is removed');
});

test("admin's access can never be overridden, even by a direct DB row", async () => {
    await ctx.knex('role_permissions').insert({ tenant_id: 1, role: 'admin', permission: PERMISSIONS.BILLING_MANAGE, enabled: false });
    const allowed = await roleHasPermissionForTenant(1, 'admin', PERMISSIONS.BILLING_MANAGE);
    assert.equal(allowed, true, 'admin must always retain full access regardless of any override row');
});

test('a normal tenant admin is refused write access to the roles matrix (settings.manage required)', async () => {
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'cashier-rp@test.local', role: 'cashier' });
    const res = await request(ctx.app)
        .patch('/roles/permissions')
        .set('asmara-token', cashierToken)
        .send({ role: 'waiter', permission: PERMISSIONS.TABLES_MANAGE, enabled: false });
    assert.equal(res.status, 403);
});

test('an override for one tenant never affects another tenant\'s effective permissions', async () => {
    const second = await seedSecondTenant(request, ctx.app, ctx.knex);
    await request(ctx.app)
        .patch('/roles/permissions')
        .set('asmara-token', adminToken) // tenant 1
        .send({ role: 'cashier', permission: PERMISSIONS.REPORTS_VIEW, enabled: true });

    const tenant2Effective = await roleHasPermissionForTenant(second.tenantId, 'cashier', PERMISSIONS.REPORTS_VIEW);
    assert.equal(tenant2Effective, roleHasPermission('cashier', PERMISSIONS.REPORTS_VIEW), "tenant 2 must still see the plain default, unaffected by tenant 1's override");
});
