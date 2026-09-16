'use strict';
/**
 * Sales & table-performance reports (task #38 -- the "sales" and "table performance" halves
 * of "Reporting: X/Z, VAT, sales, table performance" that nothing in the app covered before:
 * the X/Z report is scoped to one register session, not a date range, and there was no
 * per-table breakdown anywhere).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedSecondTenant, seedStaffUser } = require('./_helpers');

let ctx;
let token;
let categoryId;
let itemId;

before(async () => {
    ctx = await setupTestApp('sales-and-table-reports');
    token = await loginAsAdmin(request, ctx.app);

    [categoryId] = await ctx.knex('menu_categories').insert({ name: 'Mains', tenant_id: 1 });
    [itemId] = await ctx.knex('menu_items').insert({
        name: 'Doro Wat', price: '10.00', tax: '9', tenant_id: 1, category_id: categoryId,
    });

    // A paid order today, inside the default range, on table 1.
    await ctx.knex('orders').insert({
        id: 'sales-paid-today', tenant_id: 1, tables: '1', status: 'completed', payment_status: 'paid',
        payment_mode: 'Cash', data: JSON.stringify({ total: 20, quantity: { [itemId]: 2 }, price: { [itemId]: 20 }, modes: { Cash: 20 } }),
        total: 20,
        created_at: new Date(Date.now() - 5 * 60000).toISOString(), // started 5 min ago
        updated_at: new Date().toISOString(), // finished now -> ~5 min turnover
    });

    // A paid order far outside the default 30-day range -- must never be counted by default.
    await ctx.knex('orders').insert({
        id: 'sales-paid-old', tenant_id: 1, tables: '2', status: 'completed', payment_status: 'paid',
        payment_mode: 'Card', data: JSON.stringify({ total: 999, quantity: {}, modes: { Card: 999 } }),
        total: 999,
        created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:10:00.000Z',
    });

    // A partial (not fully paid) order today -- must not inflate revenue.
    await ctx.knex('orders').insert({
        id: 'sales-partial-today', tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'partial',
        data: JSON.stringify({ total: 50, quantity: {} }), total: 50,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
});

after(async () => {
    await teardownTestApp(ctx);
});

test('GET /reports/sales only counts paid orders inside the default (trailing 30 day) range', async () => {
    const res = await request(ctx.app).get('/reports/sales').set('asmara-token', token);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);
    assert.equal(res.body.totals.revenue, 20, "the old 2020 order and the partial order must not count");
    assert.equal(res.body.totals.orders, 1);
    assert.equal(res.body.totals.partialOrders, 1);
    assert.equal(res.body.byPaymentMethod.cash, 20);

    const mains = res.body.byCategory.find((c) => c.category === 'Mains');
    assert.ok(mains, 'category breakdown should include Mains');
    assert.equal(mains.revenue, 20);

    const topItem = res.body.topItems.find((i) => String(i.id) === String(itemId));
    assert.ok(topItem, 'Doro Wat should appear in topItems');
    assert.equal(topItem.quantity, 2);
});

test('GET /reports/sales?from=&to= can widen the range to include older orders', async () => {
    const res = await request(ctx.app)
        .get('/reports/sales?from=2020-01-01&to=2020-01-02')
        .set('asmara-token', token);
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.revenue, 999);
    assert.equal(res.body.totals.orders, 1);
});

test('GET /reports/table-performance groups by table, computes turnover, and lists idle tables at zero', async () => {
    const res = await request(ctx.app).get('/reports/table-performance').set('asmara-token', token);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);

    const table1 = res.body.tables.find((t) => t.table === '1');
    assert.ok(table1);
    assert.equal(table1.orders, 1);
    assert.equal(table1.revenue, 20);
    assert.ok(table1.avgTurnoverMinutes > 4 && table1.avgTurnoverMinutes < 6, `expected ~5 min, got ${table1.avgTurnoverMinutes}`);

    // Table 3 exists (seeded by setupTestApp) but had zero paid orders in range -- it should
    // still be listed, not silently dropped, so an idle table is visible as a real signal.
    const table3 = res.body.tables.find((t) => t.table === '3');
    assert.ok(table3, 'an idle table should still appear');
    assert.equal(table3.orders, 0);
    assert.equal(table3.revenue, 0);
    assert.equal(table3.avgTurnoverMinutes, null);

    // Table 2's only paid order is outside the default range -- also zero by default.
    const table2 = res.body.tables.find((t) => t.table === '2');
    assert.equal(table2.orders, 0);
});

test('a kitchen-role user cannot view sales or table-performance reports (reports.view required)', async () => {
    const kitchenToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'kitchen-reports@test.local', role: 'kitchen' });

    const salesRes = await request(ctx.app).get('/reports/sales').set('asmara-token', kitchenToken);
    assert.equal(salesRes.status, 403);

    const tableRes = await request(ctx.app).get('/reports/table-performance').set('asmara-token', kitchenToken);
    assert.equal(tableRes.status, 403);
});

test('a second tenant never sees the first tenant\'s sales or table performance', async () => {
    const other = await seedSecondTenant(request, ctx.app, ctx.knex);

    const salesRes = await request(ctx.app).get('/reports/sales').set('asmara-token', other.token);
    assert.equal(salesRes.body.totals.revenue, 0, "tenant 2 must not see tenant 1's revenue");
    assert.equal(salesRes.body.totals.orders, 0);

    const tableRes = await request(ctx.app).get('/reports/table-performance').set('asmara-token', other.token);
    // Tenant 2 only has its own table '1' (seeded by seedSecondTenant), and it must be idle.
    assert.ok(tableRes.body.tables.every((t) => t.revenue === 0));
});
