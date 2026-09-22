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

test('a waiter is refused payments.refund by default, matching the hardcoded map', async () => {
    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-rp@test.local', role: 'waiter' });
    const res = await request(ctx.app)
        .post('/orders/seed_order_001/refund')
        .set('asmara-token', waiterToken)
        .send({ amount: 1 });
    assert.equal(res.status, 403);
});

// CTO forensic audit 2026-09-21 ("one especially important security issue remains"): this
// used to be a documented-but-unfixed gap -- PERMISSIONS.ORDERS_VOID existed in the matrix
// but /orders/cancel was fetchuser-only, so a waiter (who the hardcoded map deliberately
// excludes from orders.void) could still cancel any order. Now actually enforced; this test
// replaces the old NOTE that just flagged the gap.
test('a waiter (no orders.void by default) is refused /orders/cancel', async () => {
    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-void@test.local', role: 'waiter' });
    const res = await request(ctx.app)
        .post('/orders/cancel/seed_order_001/1')
        .set('asmara-token', waiterToken);
    assert.equal(res.status, 403);
});

test('a manager (has orders.void by default) can reach /orders/cancel', async () => {
    const managerToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'manager-void@test.local', role: 'manager' });
    const res = await request(ctx.app)
        .post('/orders/cancel/order-that-does-not-exist/1')
        .set('asmara-token', managerToken);
    // Authorization passes (not 403) -- the route then no-ops/errors harmlessly on a
    // nonexistent order id, which is a separate concern from the permission check itself.
    assert.notEqual(res.status, 403);
});

test('granting a waiter orders.void via the override table actually lets them cancel', async () => {
    await request(ctx.app)
        .patch('/roles/permissions')
        .set('asmara-token', adminToken)
        .send({ role: 'waiter', permission: PERMISSIONS.ORDERS_VOID, enabled: true });

    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-void-override@test.local', role: 'waiter' });
    const res = await request(ctx.app)
        .post('/orders/cancel/order-that-does-not-exist/1')
        .set('asmara-token', waiterToken);
    assert.notEqual(res.status, 403, 'the per-tenant override must actually change enforcement, not just the matrix display');

    // Clean up the override so it doesn't leak into any test that runs after this one.
    await request(ctx.app)
        .delete('/roles/permissions')
        .set('asmara-token', adminToken)
        .send({ role: 'waiter', permission: PERMISSIONS.ORDERS_VOID });
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

// Full RBAC enforcement audit (CTO forensic audit 2026-09-21, "Full RBAC enforcement audit"):
// behavioral spot-checks for a representative sample of the routes newly gated by this
// sprint's audit (test/rbac-audit.test.js proves ALL of them are gated by *something*
// structurally; these confirm a handful actually enforce the right permission end-to-end).
test('a waiter (no menu.manage) is refused POST /menu/create', async () => {
    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-menu@test.local', role: 'waiter' });
    const res = await request(ctx.app)
        .post('/menu/create')
        .set('asmara-token', waiterToken)
        .send({ name: 'Sneaky Category' });
    assert.equal(res.status, 403);
});

test('a manager (has menu.manage) can reach POST /menu/create', async () => {
    const managerToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'manager-menu@test.local', role: 'manager' });
    const res = await request(ctx.app)
        .post('/menu/create')
        .set('asmara-token', managerToken)
        .send({ name: 'Desserts' });
    assert.notEqual(res.status, 403);
});

test('a cashier (no settings.manage) is refused POST /tax/create', async () => {
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'cashier-tax@test.local', role: 'cashier' });
    const res = await request(ctx.app)
        .post('/tax/create')
        .set('asmara-token', cashierToken)
        .send({ name: 'VAT', percentage: 20 });
    assert.equal(res.status, 403);
});

test('a kitchen role (no orders.create) is refused POST /orders/create', async () => {
    const kitchenToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'kitchen-create@test.local', role: 'kitchen' });
    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', kitchenToken)
        .send({ order_id: 'seed_order_001', total: 10, payment_mode: 'cash', data: { cash: 10 } });
    assert.equal(res.status, 403);
});

test('a waiter (has orders.create) can reach POST /orders/create', async () => {
    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-create@test.local', role: 'waiter' });
    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', waiterToken)
        .send({ order_id: 'order-that-does-not-exist', total: 10, payment_mode: 'cash', data: { cash: 10 } });
    // Authorization passes (not 403); the route then fails harmlessly on a nonexistent
    // order id, which is a separate concern from the permission check itself.
    assert.notEqual(res.status, 403);
});

test('a cashier (no settings.manage) is refused POST /payments/connect', async () => {
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'cashier-paymentsconnect@test.local', role: 'cashier' });
    const res = await request(ctx.app)
        .post('/payments/connect')
        .set('asmara-token', cashierToken)
        .send({ provider: 'stripe', api_key: 'sk_test_x' });
    assert.equal(res.status, 403);
});

test('a waiter (has tables.transfer) can reach POST /tables/transfer', async () => {
    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-transfer@test.local', role: 'waiter' });
    const res = await request(ctx.app)
        .post('/tables/transfer')
        .set('asmara-token', waiterToken)
        .send({ from_table: '1', to_table: '2' });
    // Authorization passes (not 403); the route then 404s on tables that don't exist in this
    // test's seed data, which is a separate concern from the permission check itself.
    assert.notEqual(res.status, 403);
});

test('a kitchen role (no tables.transfer) is refused POST /tables/transfer', async () => {
    const kitchenToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'kitchen-transfer@test.local', role: 'kitchen' });
    const res = await request(ctx.app)
        .post('/tables/transfer')
        .set('asmara-token', kitchenToken)
        .send({ from_table: '1', to_table: '2' });
    assert.equal(res.status, 403);
});
