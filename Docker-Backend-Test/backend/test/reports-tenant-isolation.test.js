'use strict';
/**
 * Data-integrity fix (project audit 2026-09-16): utils.js's generateReport (used by
 * POST /orders/x-report, /orders/z-report, and GET /orders/day-close/:id) had NO tenant
 * scoping anywhere -- the orders query, the cash-register lookup, and, worst of all, the
 * Z-report close-out's cleanup step (delete pending/dataless orders, free every table) all
 * operated across every tenant in the database, not just the one running the report. This
 * suite proves a Z-report run for tenant 1 can no longer see, delete, or free anything
 * belonging to tenant 2.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedSecondTenant } = require('./_helpers');

let ctx;
let token;
let other;

before(async () => {
    ctx = await setupTestApp('reports-tenant-isolation');
    token = await loginAsAdmin(request, ctx.app);
    other = await seedSecondTenant(request, ctx.app, ctx.knex);

    // Tenant 1: an open cash register with one paid order sitting in it, plus a genuinely
    // abandoned (pending, dataless) order in the SAME register -- the kind of row the
    // Z-report close-out is supposed to clean up.
    const [t1RegisterId] = await ctx.knex('cash_register').insert({
        tenant_id: 1, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
    await ctx.knex('orders').insert({
        id: 'tenant1-paid', tenant_id: 1, tables: '3', status: 'completed', payment_status: 'paid',
        payment_mode: 'Cash', cash_register_id: t1RegisterId,
        data: JSON.stringify({ total: 20, quantity: {}, modes: { Cash: 20 } }),
        total: 20, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await ctx.knex('orders').insert({
        id: 'tenant1-abandoned', tenant_id: 1, tables: null, status: 'ongoing', payment_status: 'pending',
        cash_register_id: t1RegisterId, data: null, total: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    // Tenant 2: its own open register, its own pending/dataless order, and an occupied table
    // that must NOT be freed by tenant 1's Z-report.
    const [t2RegisterId] = await ctx.knex('cash_register').insert({
        tenant_id: other.tenantId, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
    await ctx.knex('orders').insert({
        id: 'tenant2-pending', tenant_id: other.tenantId, tables: null, status: 'ongoing', payment_status: 'pending',
        cash_register_id: t2RegisterId, data: null, total: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await ctx.knex('tables').where({ table_number: '1', tenant_id: other.tenantId }).update({ status: 'occupied' });
});

after(async () => {
    await teardownTestApp(ctx);
});

test('tenant 1 running today\'s Z-report only ever touches tenant 1\'s own data', async () => {
    const res = await request(ctx.app)
        .post('/orders/z-report')
        .set('asmara-token', token)
        .send({ today: true, currency: '€ ' });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, true, JSON.stringify(res.body));

    // Tenant 1's own abandoned order was cleaned up, as intended.
    const t1Abandoned = await ctx.knex('orders').where('id', 'tenant1-abandoned').first();
    assert.equal(t1Abandoned, undefined, "tenant 1's own abandoned order should have been deleted");

    // Tenant 2's pending order must survive completely untouched.
    const t2Pending = await ctx.knex('orders').where('id', 'tenant2-pending').first();
    assert.ok(t2Pending, "tenant 2's pending order must NOT be deleted by tenant 1's Z-report");

    // Tenant 2's occupied table must still be occupied, not freed.
    const t2Table = await ctx.knex('tables').where({ table_number: '1', tenant_id: other.tenantId }).first();
    assert.equal(t2Table.status, 'occupied', "tenant 2's table must NOT be freed by tenant 1's Z-report");

    // The generated report row belongs to tenant 1.
    const reportsRes = await request(ctx.app).get('/orders/reports').set('asmara-token', token);
    assert.ok(reportsRes.body.reports.length >= 1, 'the Z-report should be visible back to the tenant that generated it');
});

test("tenant 1's Z-report total is computed only from tenant 1's own paid orders", async () => {
    // A third tenant (created directly, not via seedSecondTenant -- that helper hardcodes a
    // single slug/email, so it can only ever be called once per test file) with a much larger
    // paid order: if generateReport ever regresses back to being unscoped, this would inflate
    // tenant 1's reported total.
    const [thirdTenantId] = await ctx.knex('tenants').insert({ name: 'Third Restaurant', slug: 'third-restaurant', status: true });
    const [t3RegisterId] = await ctx.knex('cash_register').insert({
        tenant_id: thirdTenantId, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
    await ctx.knex('orders').insert({
        id: 'tenant3-big-paid', tenant_id: thirdTenantId, tables: '1', status: 'completed', payment_status: 'paid',
        payment_mode: 'Cash', cash_register_id: t3RegisterId,
        data: JSON.stringify({ total: 9999, quantity: {}, modes: { Cash: 9999 } }),
        total: 9999, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const res = await request(ctx.app)
        .post('/orders/x-report')
        .set('asmara-token', token)
        .send({ today: true, currency: '€ ' });

    assert.equal(res.status, 200);
    assert.ok(!res.body.html.includes('9999'), "tenant 3's EUR 9999 order must never appear in tenant 1's report");
});
