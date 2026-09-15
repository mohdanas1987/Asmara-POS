/**
 * Billing groundwork: fully dynamic plans + payment partners (platform admin manages them,
 * nothing hardcoded), plus the public plan list used by the signup form and the
 * subscription that gets created for every new tenant. No route here processes a real
 * charge -- see routes/billing-admin.js and routes/billing.js comments.
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
    ctx = await setupTestApp('billing');
    tenantAdminToken = await loginAsAdmin(request, ctx.app);

    const salt = await bcrypt.genSalt(8);
    const password = await bcrypt.hash('Test1234!', salt);
    const [platformAdminId] = await ctx.knex('users').insert({
        name: 'Platform Admin', email: 'platform-admin-billing@test.local', password,
        type: 'platform_admin', tenant_id: 1, status: true,
    });
    platformAdminToken = jwt.sign({ user: { id: platformAdminId, tenant_id: 1 } }, JWT_SECRET);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a normal tenant admin cannot manage plans (403)', async () => {
    const res = await request(ctx.app)
        .post('/superadmin/billing/plans')
        .set('asmara-token', tenantAdminToken)
        .send({ name: 'Starter', slug: 'starter' });
    assert.equal(res.status, 403);
});

test('platform admin can create, list, and update a plan -- nothing hardcoded', async () => {
    const createRes = await request(ctx.app)
        .post('/superadmin/billing/plans')
        .set('asmara-token', platformAdminToken)
        .send({
            name: 'Starter', slug: 'starter', price_cents: 4900, currency: 'EUR',
            billing_interval: 'monthly', features: ['1 POS terminal', 'Email support'], is_default: true,
        });
    assert.equal(createRes.status, 200);
    assert.equal(createRes.body.status, true);
    const planId = createRes.body.plan.id;
    assert.equal(Boolean(createRes.body.plan.is_default), true);

    const listRes = await request(ctx.app).get('/superadmin/billing/plans').set('asmara-token', platformAdminToken);
    assert.ok(listRes.body.plans.find((p) => p.id === planId));

    const patchRes = await request(ctx.app)
        .patch(`/superadmin/billing/plans/${planId}`)
        .set('asmara-token', platformAdminToken)
        .send({ price_cents: 5900 });
    assert.equal(patchRes.body.plan.price_cents, 5900);

    // A second plan created as default should un-default the first (only one default at a time).
    const secondRes = await request(ctx.app)
        .post('/superadmin/billing/plans')
        .set('asmara-token', platformAdminToken)
        .send({ name: 'Pro', slug: 'pro', price_cents: 9900, is_default: true });
    assert.equal(secondRes.status, 200);

    const refetch = await request(ctx.app).get('/superadmin/billing/plans').set('asmara-token', platformAdminToken);
    const starter = refetch.body.plans.find((p) => p.id === planId);
    const pro = refetch.body.plans.find((p) => p.id === secondRes.body.plan.id);
    assert.equal(Boolean(starter.is_default), false);
    assert.equal(Boolean(pro.is_default), true);
});

test('public GET /billing/plans is unauthenticated and only returns active plans', async () => {
    const unauthedRes = await request(ctx.app).get('/billing/plans');
    assert.equal(unauthedRes.status, 200);
    assert.ok(unauthedRes.body.plans.find((p) => p.slug === 'starter'));

    // Deactivate one plan; it should disappear from the public list but still exist for admins.
    const listRes = await request(ctx.app).get('/superadmin/billing/plans').set('asmara-token', platformAdminToken);
    const pro = listRes.body.plans.find((p) => p.slug === 'pro');
    const starter = listRes.body.plans.find((p) => p.slug === 'starter');
    // Restore starter as the default before deactivating pro (pro currently holds
    // is_default from the previous test's exclusivity check) -- otherwise deactivating pro
    // would leave the platform with no default plan at all, which is exactly the bug this
    // suite checks for below via the "signing up without picking a plan" test.
    await request(ctx.app)
        .patch(`/superadmin/billing/plans/${starter.id}`)
        .set('asmara-token', platformAdminToken)
        .send({ is_default: true });
    await request(ctx.app)
        .patch(`/superadmin/billing/plans/${pro.id}`)
        .set('asmara-token', platformAdminToken)
        .send({ is_active: false });

    const afterRes = await request(ctx.app).get('/billing/plans');
    assert.equal(afterRes.body.plans.find((p) => p.slug === 'pro'), undefined);

    const adminAfterRes = await request(ctx.app).get('/superadmin/billing/plans').set('asmara-token', platformAdminToken);
    assert.ok(adminAfterRes.body.plans.find((p) => p.slug === 'pro'));

    // Deactivating a plan that was the default also clears is_default -- a deactivated plan
    // must never remain the auto-offered signup default (that would silently leave new
    // signups with no plan at all).
    const proAfter = adminAfterRes.body.plans.find((p) => p.slug === 'pro');
    assert.equal(Boolean(proAfter.is_default), false);
});

test('platform admin can create and deactivate a payment partner (sandbox by default)', async () => {
    const createRes = await request(ctx.app)
        .post('/superadmin/billing/payment-providers')
        .set('asmara-token', platformAdminToken)
        .send({ name: 'Mollie (sandbox)', provider_key: 'mollie' });
    assert.equal(createRes.status, 200);
    assert.equal(createRes.body.payment_provider.mode, 'sandbox');

    const secondRes = await request(ctx.app)
        .post('/superadmin/billing/payment-providers')
        .set('asmara-token', platformAdminToken)
        .send({ name: 'Stripe (sandbox)', provider_key: 'stripe', mode: 'sandbox' });
    assert.equal(secondRes.status, 200);

    const listRes = await request(ctx.app).get('/superadmin/billing/payment-providers').set('asmara-token', platformAdminToken);
    assert.ok(listRes.body.payment_providers.length >= 2);

    const patchRes = await request(ctx.app)
        .patch(`/superadmin/billing/payment-providers/${createRes.body.payment_provider.id}`)
        .set('asmara-token', platformAdminToken)
        .send({ is_active: false });
    assert.equal(Boolean(patchRes.body.payment_provider.is_active), false);
});

test('signing up a new restaurant with a chosen plan creates a real subscription', async () => {
    const plansRes = await request(ctx.app).get('/billing/plans');
    const starter = plansRes.body.plans.find((p) => p.slug === 'starter');

    const signupRes = await request(ctx.app).post('/auth/signup-tenant').send({
        restaurant_name: 'Plan Picking Bistro', name: 'Owner Person',
        email: 'planpicker@test.local', password: 'Test1234!', plan_id: starter.id,
    });
    assert.equal(signupRes.status, 200);
    assert.equal(signupRes.body.subscription_status, 'trialing');
    assert.equal(signupRes.body.plan_id, starter.id);

    const subRes = await request(ctx.app)
        .get(`/superadmin/billing/tenants/${signupRes.body.tenant_id}/subscription`)
        .set('asmara-token', platformAdminToken);
    assert.equal(subRes.body.subscription.plan.slug, 'starter');
});

test('signing up without picking a plan falls back to the platform default plan', async () => {
    const signupRes = await request(ctx.app).post('/auth/signup-tenant').send({
        restaurant_name: 'No Plan Chosen Diner', name: 'Owner Two',
        email: 'noplan@test.local', password: 'Test1234!',
    });
    assert.equal(signupRes.status, 200);
    // 'starter' is_default is true at this point in the suite (Pro was deactivated, Starter
    // stayed the default from the earlier test).
    const subRes = await request(ctx.app)
        .get(`/superadmin/billing/tenants/${signupRes.body.tenant_id}/subscription`)
        .set('asmara-token', platformAdminToken);
    assert.equal(subRes.body.subscription.plan.slug, 'starter');
});

test('platform admin can assign/change a tenant subscription directly', async () => {
    const plansRes = await request(ctx.app).get('/superadmin/billing/plans').set('asmara-token', platformAdminToken);
    const pro = plansRes.body.plans.find((p) => p.slug === 'pro');

    const providersRes = await request(ctx.app).get('/superadmin/billing/payment-providers').set('asmara-token', platformAdminToken);
    const stripeProvider = providersRes.body.payment_providers.find((p) => p.provider_key === 'stripe');

    // tenant 1 (the seeded default tenant) has no subscription yet from setupTestApp.
    const assignRes = await request(ctx.app)
        .post('/superadmin/billing/tenants/1/subscription')
        .set('asmara-token', platformAdminToken)
        .send({ plan_id: pro.id, payment_provider_id: stripeProvider.id, status: 'active' });
    assert.equal(assignRes.status, 200);
    assert.equal(assignRes.body.subscription.status, 'active');
    assert.equal(assignRes.body.subscription.plan.slug, 'pro');
    assert.equal(assignRes.body.subscription.paymentProvider.provider_key, 'stripe');

    // Tenant list surfaces it directly (usage/health at a glance).
    const tenantsRes = await request(ctx.app).get('/superadmin/tenants').set('asmara-token', platformAdminToken);
    const tenant1 = tenantsRes.body.tenants.find((t) => t.id === 1);
    assert.equal(tenant1.subscription_status, 'active');
    assert.equal(tenant1.plan_name, 'Pro');
});

test('deleting a plan still in use deactivates instead of destroying subscription history', async () => {
    const plansRes = await request(ctx.app).get('/superadmin/billing/plans').set('asmara-token', platformAdminToken);
    const pro = plansRes.body.plans.find((p) => p.slug === 'pro');

    const delRes = await request(ctx.app)
        .delete(`/superadmin/billing/plans/${pro.id}`)
        .set('asmara-token', platformAdminToken);
    assert.equal(delRes.status, 200);
    assert.equal(Boolean(delRes.body.plan.is_active), false);

    // The subscription referencing it is untouched.
    const subRes = await request(ctx.app)
        .get('/superadmin/billing/tenants/1/subscription')
        .set('asmara-token', platformAdminToken);
    assert.equal(subRes.body.subscription.plan_id, pro.id);
});
