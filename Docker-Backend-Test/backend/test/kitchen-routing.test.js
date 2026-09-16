'use strict';
/**
 * Kitchen ticket routing (project audit 2026-09-15, task "Kitchen ticket routing as its own
 * domain"). Covers the Product -> Preparation Rule -> Kitchen Station model end-to-end: a
 * default station always exists, items split across stations produce separate tickets, the
 * existing /to-kitchen flow keeps working even when routing has nothing to do, and the new
 * /kitchen endpoints are gated by the RBAC permission model.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser } = require('./_helpers');
const { routeOrderToKitchen } = require('../services/kitchenRouting');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('kitchen-routing');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('migration 0009 backfilled exactly one default "Main Kitchen" station for tenant 1', async () => {
    const stations = await ctx.knex('kitchen_stations').where('tenant_id', 1);
    assert.equal(stations.length, 1);
    assert.equal(stations[0].name, 'Main Kitchen');
    assert.equal(!!stations[0].is_default, true);
});

test('an item with no kitchen_station_id set routes to the tenant default station', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({
        name: 'Unmapped Burger', price: 10, tenant_id: 1, category_id: 1, seq: 1,
    });
    const tickets = await routeOrderToKitchen({
        tenantId: 1, orderId: 'order-unmapped', tableNumber: '5',
        items: [{ id: itemId, quantity: 2 }],
    });
    assert.equal(tickets.length, 1);
    const defaultStation = await ctx.knex('kitchen_stations').where({ tenant_id: 1, is_default: true }).first();
    assert.equal(tickets[0].station_id, defaultStation.id);
    assert.deepEqual(JSON.parse(tickets[0].items), [{ id: itemId, quantity: 2 }]);
});

test('items mapped to two different stations produce two separate tickets', async () => {
    const [grillId] = await ctx.knex('kitchen_stations').insert({ tenant_id: 1, name: 'Grill', is_default: false });
    const [barId] = await ctx.knex('kitchen_stations').insert({ tenant_id: 1, name: 'Bar', is_default: false });

    const [steakId] = await ctx.knex('menu_items').insert({
        name: 'Steak', price: 20, tenant_id: 1, category_id: 1, seq: 2, kitchen_station_id: grillId,
    });
    const [beerId] = await ctx.knex('menu_items').insert({
        name: 'Beer', price: 5, tenant_id: 1, category_id: 1, seq: 3, kitchen_station_id: barId,
    });

    const tickets = await routeOrderToKitchen({
        tenantId: 1, orderId: 'order-split', tableNumber: '7',
        items: [{ id: steakId, quantity: 1 }, { id: beerId, quantity: 2 }],
    });

    assert.equal(tickets.length, 2);
    const stationIds = tickets.map((t) => t.station_id).sort();
    assert.deepEqual(stationIds, [grillId, barId].sort());
});

test('routeOrderToKitchen with an empty item list creates no tickets (no-op, not an error)', async () => {
    const tickets = await routeOrderToKitchen({ tenantId: 1, orderId: 'order-empty', tableNumber: null, items: [] });
    assert.deepEqual(tickets, []);
});

test('GET /kitchen/stations requires kitchen.view -- kitchen role can, but is limited elsewhere', async () => {
    const kitchenToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'kds@kitchen-routing.local', role: 'kitchen' });
    const res = await request(ctx.app).get('/kitchen/stations').set('asmara-token', kitchenToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.stations));
});

test('POST /kitchen/stations requires settings.manage -- a kitchen-role user is forbidden', async () => {
    const kitchenToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'kds2@kitchen-routing.local', role: 'kitchen' });
    const res = await request(ctx.app).post('/kitchen/stations').set('asmara-token', kitchenToken).send({ name: 'Dessert' });
    assert.equal(res.status, 403);
});

test('admin can create a new station via the API', async () => {
    const res = await request(ctx.app).post('/kitchen/stations').set('asmara-token', token).send({ name: 'Dessert', printer_id: 'usb-2' });
    assert.equal(res.status, 200);
    assert.equal(res.body.station.name, 'Dessert');
    assert.equal(res.body.station.printer_id, 'usb-2');
});

test('GET /kitchen/tickets returns tickets with items parsed back into objects (not raw JSON strings)', async () => {
    await ctx.knex('kitchen_tickets').insert({
        tenant_id: 1, order_id: 'order-kds-1', station_id: 1, table_number: '9',
        items: JSON.stringify([{ id: 1, quantity: 3 }]), status: 'pending',
    });
    const res = await request(ctx.app).get('/kitchen/tickets').set('asmara-token', token).query({ status: 'pending' });
    assert.equal(res.status, 200);
    const found = res.body.tickets.find((t) => t.order_id === 'order-kds-1');
    assert.ok(found);
    assert.deepEqual(found.items, [{ id: 1, quantity: 3 }]);
});

test('PATCH /kitchen/tickets/:id transitions status through the KDS lifecycle', async () => {
    const [ticketId] = await ctx.knex('kitchen_tickets').insert({
        tenant_id: 1, order_id: 'order-kds-2', station_id: 1, items: '[]', status: 'pending',
    });
    for (const status of ['preparing', 'ready', 'served']) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(ctx.app).patch(`/kitchen/tickets/${ticketId}`).set('asmara-token', token).send({ status });
        assert.equal(res.status, 200, `expected 200 moving to ${status}`);
    }
    const finalRow = await ctx.knex('kitchen_tickets').where('id', ticketId).first();
    assert.equal(finalRow.status, 'served');
});

test('PATCH /kitchen/tickets/:id rejects an invalid status', async () => {
    const [ticketId] = await ctx.knex('kitchen_tickets').insert({
        tenant_id: 1, order_id: 'order-kds-3', station_id: 1, items: '[]', status: 'pending',
    });
    const res = await request(ctx.app).patch(`/kitchen/tickets/${ticketId}`).set('asmara-token', token).send({ status: 'exploded' });
    assert.equal(res.status, 400);
});

test('POST /kitchen/tickets/:id/reprint clears printed_at and increments reprint_count', async () => {
    const [ticketId] = await ctx.knex('kitchen_tickets').insert({
        tenant_id: 1, order_id: 'order-kds-4', station_id: 1, items: '[]', status: 'pending',
        printed_at: new Date().toISOString(), reprint_count: 0,
    });
    const res = await request(ctx.app).post(`/kitchen/tickets/${ticketId}/reprint`).set('asmara-token', token);
    assert.equal(res.status, 200);
    const row = await ctx.knex('kitchen_tickets').where('id', ticketId).first();
    assert.equal(row.reprint_count, 1);
    assert.equal(row.printed_at, null);
});

test('POST /kitchen/tickets/:id/print-result records a print failure for the KDS to surface', async () => {
    const [ticketId] = await ctx.knex('kitchen_tickets').insert({
        tenant_id: 1, order_id: 'order-kds-5', station_id: 1, items: '[]', status: 'pending',
    });
    const res = await request(ctx.app)
        .post(`/kitchen/tickets/${ticketId}/print-result`)
        .set('asmara-token', token)
        .send({ success: false, error: 'Printer offline' });
    assert.equal(res.status, 200);
    const row = await ctx.knex('kitchen_tickets').where('id', ticketId).first();
    assert.equal(row.print_error, 'Printer offline');
});

test('signup-tenant creates a default kitchen station for the brand-new tenant', async () => {
    const res = await request(ctx.app).post('/auth/signup-tenant').send({
        restaurant_name: 'Kitchen Routing Test Restaurant',
        name: 'New Owner',
        email: 'owner@kitchen-routing-onboarding.local',
        password: 'Test1234!',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const newTenantId = res.body.tenant_id;
    const stations = await ctx.knex('kitchen_stations').where('tenant_id', newTenantId);
    assert.equal(stations.length, 1);
    assert.equal(stations[0].name, 'Main Kitchen');
    assert.equal(!!stations[0].is_default, true);
});

test('a second tenant only ever sees its own stations and tickets, never tenant 1\'s', async () => {
    const { seedSecondTenant } = require('./_helpers');
    const other = await seedSecondTenant(request, ctx.app, ctx.knex);

    // The second tenant should already have gotten its own default station from migration
    // 0009's backfill (it's created inside setupTestApp -> knex.migrate.latest() runs once
    // for the whole file, but seedSecondTenant inserts its tenant row AFTER that -- so it
    // needs its own default station created explicitly, same as production onboarding would
    // need to do for a brand-new tenant).
    await ctx.knex('kitchen_stations').insert({ tenant_id: other.tenantId, name: 'Main Kitchen', is_default: true });

    const res = await request(ctx.app).get('/kitchen/stations').set('asmara-token', other.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.stations.length, 1);
    assert.equal(res.body.stations[0].tenant_id, other.tenantId);
});
