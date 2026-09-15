/**
 * Super-admin panel: cross-tenant, mostly-read-only routes gated by requirePlatformAdmin.
 * A platform admin has no public signup path (see that middleware's comment) -- these tests
 * create one directly via knex, exactly as a real operator would.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');
const { JWT_SECRET } = require('../config/auth');

let ctx;
let platformAdminToken;
let tenantAdminToken;

before(async () => {
    ctx = await setupTestApp('superadmin');
    tenantAdminToken = await loginAsAdmin(request, ctx.app);

    const salt = await bcrypt.genSalt(8);
    const password = await bcrypt.hash('Test1234!', salt);
    const [platformAdminId] = await ctx.knex('users').insert({
        name: 'Platform Admin',
        email: 'platform-admin@test.local',
        password,
        type: 'platform_admin',
        tenant_id: 1,
        status: true,
    });
    platformAdminToken = jwt.sign({ user: { id: platformAdminId, tenant_id: 1 } }, JWT_SECRET);

    // A second tenant with its own admin + a couple of orders, so the cross-tenant list has
    // something real to aggregate.
    const [secondTenantId] = await ctx.knex('tenants').insert({ name: 'Second Place', slug: 'second-place', status: true });
    await ctx.knex('orders').insert([
        { id: 'sp-order-1', tenant_id: secondTenantId, source: 'pos', status: 'completed', payment_status: 'paid', total: 15 },
        { id: 'sp-order-2', tenant_id: secondTenantId, source: 'online', status: 'completed', payment_status: 'paid', total: 22 },
    ]);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a normal tenant admin is refused (403), not just filtered', async () => {
    const res = await request(ctx.app).get('/superadmin/tenants').set('asmara-token', tenantAdminToken);
    assert.equal(res.status, 403);
    assert.equal(res.body.status, false);
});

test('an unauthenticated request is refused', async () => {
    const res = await request(ctx.app).get('/superadmin/tenants');
    assert.equal(res.status, 401);
});

test('platform admin sees every tenant with real aggregated usage', async () => {
    const res = await request(ctx.app).get('/superadmin/tenants').set('asmara-token', platformAdminToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);
    assert.ok(res.body.tenants.length >= 2);

    const tenant1 = res.body.tenants.find((t) => t.slug === 'asmara-eindhoven');
    assert.ok(tenant1);
    assert.ok(tenant1.user_count >= 2); // seeded admin + the new platform admin

    const secondPlace = res.body.tenants.find((t) => t.slug === 'second-place');
    assert.ok(secondPlace);
    assert.equal(secondPlace.order_count, 2);
});

test('platform admin can view one tenant in detail', async () => {
    const listRes = await request(ctx.app).get('/superadmin/tenants').set('asmara-token', platformAdminToken);
    const secondPlace = listRes.body.tenants.find((t) => t.slug === 'second-place');

    const res = await request(ctx.app).get(`/superadmin/tenants/${secondPlace.id}`).set('asmara-token', platformAdminToken);
    assert.equal(res.body.status, true);
    assert.equal(res.body.order_count, 2);
});

test('platform admin can suspend and reactivate a tenant (reversible, not destructive)', async () => {
    const listRes = await request(ctx.app).get('/superadmin/tenants').set('asmara-token', platformAdminToken);
    const secondPlace = listRes.body.tenants.find((t) => t.slug === 'second-place');
    assert.equal(Boolean(secondPlace.status), true);

    const suspendRes = await request(ctx.app)
        .post(`/superadmin/tenants/${secondPlace.id}/toggle`)
        .set('asmara-token', platformAdminToken);
    assert.equal(Boolean(suspendRes.body.tenant.status), false);

    // The tenant's own data is still there -- toggling status never deletes anything.
    const stillThere = await ctx.knex('orders').where('tenant_id', secondPlace.id);
    assert.equal(stillThere.length, 2);

    const reactivateRes = await request(ctx.app)
        .post(`/superadmin/tenants/${secondPlace.id}/toggle`)
        .set('asmara-token', platformAdminToken);
    assert.equal(Boolean(reactivateRes.body.tenant.status), true);
});
