'use strict';
/**
 * Modifiers wired into real order lines (CTO forensic audit 2026-09-20, "Gate 1: Order
 * domain completion" -- flagged as the single biggest concrete gap: modifier configuration
 * (migration 0015, groups + options) existed, but was never connected to an actual cart,
 * order, or kitchen ticket). Covers the backend half of that wiring: the POS's own
 * `data.lines` per-line detail (see frontend lib/api.ts's OrderLineDetail) flowing through
 * POST /orders/to-kitchen/:table into a real kitchen_tickets row that carries a modifier
 * summary -- and the Preservation Contract that an order with NO modifier selections
 * produces byte-for-byte the same ticket shape as before this feature existed.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');
const Order = require('../models/Order');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('order-modifiers');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

// Order.id is a model-generated nanoid (see Order.$beforeInsert), not an auto-increment
// column -- going through the Objection model here (as the real app always does) instead of
// a raw knex insert, which would leave `id` unset and violate the primary key.
async function seedPendingTableOrder(tableNumber) {
    const order = await Order.query().insertAndFetch({
        tenant_id: 1, tables: tableNumber, status: 'pending', version: 1,
    });
    return order.id;
}

test('a plain item with no modifiers produces a kitchen ticket with the exact same {id, quantity} shape as before this feature', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Plain Burger', price: 10, tenant_id: 1, category_id: 1, seq: 20 });
    const orderId = await seedPendingTableOrder('30');

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/30')
        .set('asmara-token', token)
        .send({ order_id: orderId, data: { quantity: { [itemId]: 2 } }, total: 20 });
    assert.equal(res.status, 200);

    const tickets = await ctx.knex('kitchen_tickets').where({ tenant_id: 1, order_id: orderId });
    assert.equal(tickets.length, 1);
    const items = JSON.parse(tickets[0].items);
    assert.deepEqual(items, [{ id: String(itemId), quantity: 2 }]);
});

test('an item with a modifier selection carries a modifier-name summary on its kitchen ticket line', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Custom Burger', price: 12, tenant_id: 1, category_id: 1, seq: 21 });
    const orderId = await seedPendingTableOrder('31');

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/31')
        .set('asmara-token', token)
        .send({
            order_id: orderId,
            data: {
                quantity: { [itemId]: 1 },
                lines: [{ itemId, qty: 1, modifiers: [{ id: 1, name: 'Extra cheese', price_delta: 1.5 }, { id: 2, name: 'No onion', price_delta: 0 }] }],
            },
            total: 13.5,
        });
    assert.equal(res.status, 200);

    const tickets = await ctx.knex('kitchen_tickets').where({ tenant_id: 1, order_id: orderId });
    assert.equal(tickets.length, 1);
    const items = JSON.parse(tickets[0].items);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, String(itemId));
    assert.equal(items[0].quantity, 1);
    assert.deepEqual(items[0].modifiers, ['Extra cheese', 'No onion']);
});

test('data.lines with no matching modifiers for the routed item id leaves that item untouched', async () => {
    const [burgerId] = await ctx.knex('menu_items').insert({ name: 'Untouched Burger', price: 9, tenant_id: 1, category_id: 1, seq: 22 });
    const [friesId] = await ctx.knex('menu_items').insert({ name: 'Side Fries', price: 3, tenant_id: 1, category_id: 1, seq: 23 });
    const orderId = await seedPendingTableOrder('32');

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/32')
        .set('asmara-token', token)
        .send({
            order_id: orderId,
            data: {
                quantity: { [burgerId]: 1, [friesId]: 1 },
                // only the fries line carries a modifier selection
                lines: [{ itemId: friesId, qty: 1, modifiers: [{ id: 3, name: 'Extra salt', price_delta: 0 }] }],
            },
            total: 12,
        });
    assert.equal(res.status, 200);

    const tickets = await ctx.knex('kitchen_tickets').where({ tenant_id: 1, order_id: orderId });
    assert.equal(tickets.length, 1);
    const items = JSON.parse(tickets[0].items);
    const burgerLine = items.find((it) => it.id === String(burgerId));
    const friesLine = items.find((it) => it.id === String(friesId));
    assert.equal('modifiers' in burgerLine, false, 'an item with no modifier selection must not gain a modifiers key at all');
    assert.deepEqual(friesLine.modifiers, ['Extra salt']);
});
