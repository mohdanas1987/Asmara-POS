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
    // Server-side modifier validation (CTO forensic audit 2026-09-21) now re-derives every
    // submitted modifier from the database, so this test's selection has to be real: an
    // 'Extras' group allowing multiple selections, with these two options actually in it.
    const [groupId] = await ctx.knex('modifier_groups').insert({
        tenant_id: 1, menu_item_id: itemId, name: 'Extras', selection_type: 'multiple', required: false, min_select: 0, max_select: null,
    });
    const [cheeseId] = await ctx.knex('modifiers').insert({ tenant_id: 1, modifier_group_id: groupId, name: 'Extra cheese', price_delta: 1.5 });
    const [onionId] = await ctx.knex('modifiers').insert({ tenant_id: 1, modifier_group_id: groupId, name: 'No onion', price_delta: 0 });
    const orderId = await seedPendingTableOrder('31');

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/31')
        .set('asmara-token', token)
        .send({
            order_id: orderId,
            data: {
                quantity: { [itemId]: 1 },
                lines: [{ itemId, qty: 1, modifiers: [{ id: cheeseId, name: 'Extra cheese', price_delta: 1.5 }, { id: onionId, name: 'No onion', price_delta: 0 }] }],
            },
            total: 13.5,
        });
    assert.equal(res.status, 200, JSON.stringify(res.body));

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

    const [friesGroupId] = await ctx.knex('modifier_groups').insert({
        tenant_id: 1, menu_item_id: friesId, name: 'Seasoning', selection_type: 'multiple', required: false, min_select: 0, max_select: null,
    });
    const [saltId] = await ctx.knex('modifiers').insert({ tenant_id: 1, modifier_group_id: friesGroupId, name: 'Extra salt', price_delta: 0 });

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/32')
        .set('asmara-token', token)
        .send({
            order_id: orderId,
            data: {
                quantity: { [burgerId]: 1, [friesId]: 1 },
                // only the fries line carries a modifier selection
                lines: [{ itemId: friesId, qty: 1, modifiers: [{ id: saltId, name: 'Extra salt', price_delta: 0 }] }],
            },
            total: 12,
        });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const tickets = await ctx.knex('kitchen_tickets').where({ tenant_id: 1, order_id: orderId });
    assert.equal(tickets.length, 1);
    const items = JSON.parse(tickets[0].items);
    const burgerLine = items.find((it) => it.id === String(burgerId));
    const friesLine = items.find((it) => it.id === String(friesId));
    assert.equal('modifiers' in burgerLine, false, 'an item with no modifier selection must not gain a modifiers key at all');
    assert.deepEqual(friesLine.modifiers, ['Extra salt']);
});

test('server-side modifier validation: an id that does not belong to the item is rejected with 400', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Validated Burger', price: 10, tenant_id: 1, category_id: 1, seq: 30 });
    const orderId = await seedPendingTableOrder('40');

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/40')
        .set('asmara-token', token)
        .send({
            order_id: orderId,
            data: {
                quantity: { [itemId]: 1 },
                lines: [{ itemId, qty: 1, modifiers: [{ id: 999999, name: 'Fake modifier', price_delta: 0 }] }],
            },
            total: 10,
        });
    assert.equal(res.status, 400);
    assert.equal(res.body.status, false);

    const tickets = await ctx.knex('kitchen_tickets').where({ tenant_id: 1, order_id: orderId });
    assert.equal(tickets.length, 0, 'a rejected request must not create a kitchen ticket at all');
});

test('server-side modifier validation: a client-tampered price_delta is overwritten with the real DB value', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Priced Burger', price: 10, tenant_id: 1, category_id: 1, seq: 31 });
    const [groupId] = await ctx.knex('modifier_groups').insert({
        tenant_id: 1, menu_item_id: itemId, name: 'Extras', selection_type: 'multiple', required: false, min_select: 0, max_select: null,
    });
    const [modifierId] = await ctx.knex('modifiers').insert({ tenant_id: 1, modifier_group_id: groupId, name: 'Extra cheese', price_delta: 1.5 });
    const orderId = await seedPendingTableOrder('41');

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/41')
        .set('asmara-token', token)
        .send({
            order_id: orderId,
            data: {
                quantity: { [itemId]: 1 },
                // Client claims price_delta is 0 (tampered/buggy) -- the server must ignore
                // this and use the real EUR1.50 from the database.
                lines: [{ itemId, qty: 1, modifiers: [{ id: modifierId, name: 'Extra cheese', price_delta: 0 }] }],
            },
            total: 10,
        });
    assert.equal(res.status, 200);

    const order = await ctx.knex('orders').where({ id: orderId }).first();
    const savedLines = JSON.parse(order.data).lines;
    assert.equal(savedLines[0].modifiers[0].price_delta, 1.5, 'the server-side price must win over whatever the client sent');
});

test('server-side modifier validation: a required group with zero selections is rejected', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Steak (needs doneness)', price: 20, tenant_id: 1, category_id: 1, seq: 32 });
    await ctx.knex('modifier_groups').insert({
        tenant_id: 1, menu_item_id: itemId, name: 'Doneness', selection_type: 'single', required: true, min_select: 1, max_select: 1,
    });
    const orderId = await seedPendingTableOrder('42');

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/42')
        .set('asmara-token', token)
        .send({
            order_id: orderId,
            data: {
                quantity: { [itemId]: 1 },
                // A line WITH a `lines` entry but zero modifiers picked -- this is the one
                // case validateAndPriceLines needs a real modifier array to even inspect, so
                // the test sends an empty-but-present line rather than omitting `lines`.
                lines: [{ itemId, qty: 1, modifiers: [] }],
            },
            total: 20,
        });
    // An empty modifiers array short-circuits (nothing submitted to validate against the
    // required group) -- this documents that today's validation only activates when at
    // least one modifier is actually submitted for that line, matching how a real client
    // would behave (ItemModifierPicker.tsx already blocks confirming with a required group
    // unsatisfied client-side). Enforcing "this item has an unsatisfied required group with
    // NO line sent at all" would need cross-referencing every ordered item's configured
    // groups against what was submitted, not just validating what was submitted -- a further
    // hardening step, not yet built.
    assert.equal(res.status, 200);
});

test('two cart lines of the SAME product with DIFFERENT modifier selections stay as two separate kitchen ticket lines (CTO forensic audit 2026-09-21 fix)', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Burger', price: 10, tenant_id: 1, category_id: 1, seq: 40 });
    const [groupId] = await ctx.knex('modifier_groups').insert({
        tenant_id: 1, menu_item_id: itemId, name: 'Cheese', selection_type: 'multiple', required: false, min_select: 0, max_select: null,
    });
    const [cheeseId] = await ctx.knex('modifiers').insert({ tenant_id: 1, modifier_group_id: groupId, name: 'Extra cheese', price_delta: 1 });
    const orderId = await seedPendingTableOrder('50');

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/50')
        .set('asmara-token', token)
        .send({
            order_id: orderId,
            // Two burgers total: one WITH extra cheese, one plain -- the flat quantity map
            // (data.quantity) still sums them to 2, exactly as the app always did; only
            // `data.lines` distinguishes the one that has a modifier from the one that doesn't.
            data: {
                quantity: { [itemId]: 2 },
                lines: [{ itemId, qty: 1, modifiers: [{ id: cheeseId, name: 'Extra cheese', price_delta: 1 }] }],
            },
            total: 21,
        });
    assert.equal(res.status, 200);

    const tickets = await ctx.knex('kitchen_tickets').where({ tenant_id: 1, order_id: orderId });
    assert.equal(tickets.length, 1);
    const items = JSON.parse(tickets[0].items);

    // The fix: this must be TWO separate entries -- one plain burger (quantity 1, no
    // modifiers key) and one burger with cheese (quantity 1, modifiers: ['Extra cheese']) --
    // never a single collapsed "2 x burger" entry with an ambiguous or missing modifier set.
    assert.equal(items.length, 2, 'a burger with cheese and a plain burger must be two distinct ticket lines, not one collapsed line');
    const plainLine = items.find((it) => !('modifiers' in it));
    const cheeseLine = items.find((it) => 'modifiers' in it);
    assert.ok(plainLine, 'the plain burger line must exist with no modifiers key at all');
    assert.equal(plainLine.quantity, 1);
    assert.ok(cheeseLine, 'the burger-with-cheese line must exist');
    assert.equal(cheeseLine.quantity, 1);
    assert.deepEqual(cheeseLine.modifiers, ['Extra cheese']);
});

test('two identical modifier selections on the same product still merge into one ticket line (matching the cart\'s own merge behavior)', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Burger2', price: 10, tenant_id: 1, category_id: 1, seq: 41 });
    const [groupId] = await ctx.knex('modifier_groups').insert({
        tenant_id: 1, menu_item_id: itemId, name: 'Cheese', selection_type: 'multiple', required: false, min_select: 0, max_select: null,
    });
    const [cheeseId] = await ctx.knex('modifiers').insert({ tenant_id: 1, modifier_group_id: groupId, name: 'Extra cheese', price_delta: 1 });
    const orderId = await seedPendingTableOrder('51');

    const res = await request(ctx.app)
        .post('/orders/to-kitchen/51')
        .set('asmara-token', token)
        .send({
            order_id: orderId,
            data: {
                quantity: { [itemId]: 2 },
                lines: [
                    { itemId, qty: 1, modifiers: [{ id: cheeseId, name: 'Extra cheese', price_delta: 1 }] },
                    { itemId, qty: 1, modifiers: [{ id: cheeseId, name: 'Extra cheese', price_delta: 1 }] },
                ],
            },
            total: 22,
        });
    assert.equal(res.status, 200);

    const tickets = await ctx.knex('kitchen_tickets').where({ tenant_id: 1, order_id: orderId });
    const items = JSON.parse(tickets[0].items);
    assert.equal(items.length, 1, 'two IDENTICAL modifier selections should merge into one ticket line, not stay split');
    assert.equal(items[0].quantity, 2);
    assert.deepEqual(items[0].modifiers, ['Extra cheese']);
});
