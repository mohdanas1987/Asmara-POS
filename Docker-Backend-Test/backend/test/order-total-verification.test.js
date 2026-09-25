'use strict';
/**
 * Server-authoritative financial totals (CTO doc "Asmara POS -- Remaining Work Only", Phase
 * 24: "the backend currently trusts client-provided totals too much... SERVER CALCULATES
 * TOTAL", with the explicit required test battery: manipulated total, item price, quantity,
 * tax, discount, modifier; stale product price; stale order version).
 *
 * See services/orderTotals.js for the recomputation itself and its header comment for why
 * weight-sold items are a documented, deliberate exception (not silently mis-handled).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');
const Order = require('../models/Order');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('order-total-verification');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('cash_register').insert({
        tenant_id: 1, user_id: ctx.userId, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
});

after(async () => {
    await teardownTestApp(ctx);
});

async function seedPendingTableOrder(tableNumber) {
    const order = await Order.query().insertAndFetch({
        tenant_id: 1, tables: tableNumber, status: 'pending', version: 1,
    });
    return order.id;
}

async function sendToKitchen(table, orderId, body) {
    const res = await request(ctx.app)
        .post(`/orders/to-kitchen/${table}`)
        .set('asmara-token', token)
        .send({ order_id: orderId, ...body });
    assert.equal(res.status, 200, `to-kitchen setup failed: ${JSON.stringify(res.body)}`);
    return res;
}

async function charge(orderId, body) {
    return request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: orderId, payment_mode: 'cash', ...body });
}

async function ledgerRowsFor(orderId) {
    return ctx.knex('payment_transactions').where({ order_id: String(orderId) });
}

test('a correct total for plain items is accepted and charged', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Cola', price: 3, tenant_id: 1, category_id: 1, seq: 100 });
    const orderId = await seedPendingTableOrder('60');
    await sendToKitchen('60', orderId, { data: { quantity: { [itemId]: 2 } }, total: 6 });

    const res = await charge(orderId, { total: 6, data: { cash: 6 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await ledgerRowsFor(orderId)).length, 1);
});

test('manipulated total: a tampered (inflated) total is rejected with 409 and nothing is charged', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Water', price: 2, tenant_id: 1, category_id: 1, seq: 101 });
    const orderId = await seedPendingTableOrder('61');
    await sendToKitchen('61', orderId, { data: { quantity: { [itemId]: 3 } }, total: 6 });

    // Real price is EUR2 x 3 = EUR6 -- claim EUR1 instead (undercharging the restaurant).
    const res = await charge(orderId, { total: 1, data: { cash: 1 } });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.totalMismatch, true);
    assert.equal(res.body.computed_total, 6);
    assert.equal((await ledgerRowsFor(orderId)).length, 0, 'a rejected charge must never reach the ledger');

    const order = await ctx.knex('orders').where({ id: orderId }).first();
    assert.equal(order.payment_status, 'pending', 'a rejected charge must not flip payment_status');
});

test('manipulated quantity: a total priced for fewer units than the order actually has is rejected', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Beer', price: 5, tenant_id: 1, category_id: 1, seq: 102 });
    const orderId = await seedPendingTableOrder('62');
    // Real order has 4 units (EUR20) -- attacker submits a total priced as if only 1 was ordered.
    await sendToKitchen('62', orderId, { data: { quantity: { [itemId]: 4 } }, total: 20 });

    const res = await charge(orderId, { total: 5, data: { cash: 5 } });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.computed_total, 20);
});

test('manipulated item price: server always uses the DB price, never anything implied by the client\'s total', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Steak', price: 25, tenant_id: 1, category_id: 1, seq: 103 });
    const orderId = await seedPendingTableOrder('63');
    await sendToKitchen('63', orderId, { data: { quantity: { [itemId]: 1 } }, total: 25 });

    // Client tries to charge as if the steak were EUR10.
    const res = await charge(orderId, { total: 10, data: { cash: 10 } });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.computed_total, 25);
});

test('manipulated modifier: an inflated price_delta sent alongside the charge cannot lower the computed total', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Pizza', price: 10, tenant_id: 1, category_id: 1, seq: 104 });
    const [groupId] = await ctx.knex('modifier_groups').insert({
        tenant_id: 1, menu_item_id: itemId, name: 'Extras', selection_type: 'multiple', required: false, min_select: 0, max_select: null,
    });
    const [cheeseId] = await ctx.knex('modifiers').insert({ tenant_id: 1, modifier_group_id: groupId, name: 'Extra cheese', price_delta: 2 });
    const orderId = await seedPendingTableOrder('64');
    // Real total: EUR10 + EUR2 modifier = EUR12 (to-kitchen already re-prices this correctly).
    await sendToKitchen('64', orderId, {
        data: { quantity: { [itemId]: 1 }, lines: [{ itemId, qty: 1, modifiers: [{ id: cheeseId, name: 'Extra cheese', price_delta: 2 }] }] },
        total: 12,
    });

    // Attacker tries to charge EUR10, claiming (via a bogus field the server never reads) that
    // the modifier was free.
    const res = await charge(orderId, { total: 10, data: { cash: 10 } });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.computed_total, 12);

    // The correct, server-computed total is still accepted.
    const okRes = await charge(orderId, { total: 12, data: { cash: 12 } });
    assert.equal(okRes.status, 200, JSON.stringify(okRes.body));
});

test('manipulated/nonexistent discount: there is no discount mechanism in this codebase, so a bogus discount field is simply ignored and the full price is still required', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Salad', price: 8, tenant_id: 1, category_id: 1, seq: 105 });
    const orderId = await seedPendingTableOrder('65');
    await sendToKitchen('65', orderId, { data: { quantity: { [itemId]: 1 } }, total: 8 });

    const res = await charge(orderId, { total: 4, discount: { type: 'percent', value: 50 }, data: { cash: 4 } });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.computed_total, 8, 'a client-supplied discount field must have zero effect on the server-computed total');
});

test('manipulated tax: there is no separate tax add-on (prices are already VAT-inclusive), so a client-implied tax field cannot change what is charged', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Coffee', price: 4, tenant_id: 1, category_id: 1, seq: 106, tax: '9' });
    const orderId = await seedPendingTableOrder('66');
    await sendToKitchen('66', orderId, { data: { quantity: { [itemId]: 1 } }, total: 4 });

    // Client tries to charge as if 9% needed to be added on top (a stale/wrong client-side
    // tax assumption) -- the inclusive price is already EUR4 flat, so this must be rejected.
    const res = await charge(orderId, { total: 4.36, data: { cash: 4.36 } });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.computed_total, 4);
});

test('stale product price: if the menu price changed after the order was rung up, the server recomputes from the CURRENT price and rejects the old total', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Soup', price: 6, tenant_id: 1, category_id: 1, seq: 107 });
    const orderId = await seedPendingTableOrder('67');
    await sendToKitchen('67', orderId, { data: { quantity: { [itemId]: 1 } }, total: 6 });

    // Menu price changes between order and charge (e.g. a price update mid-shift).
    await ctx.knex('menu_items').where({ id: itemId }).update({ price: 9 });

    const staleRes = await charge(orderId, { total: 6, data: { cash: 6 } });
    assert.equal(staleRes.status, 409, JSON.stringify(staleRes.body));
    assert.equal(staleRes.body.computed_total, 9, 'the server must price against the CURRENT product price, not whatever the client last saw');

    const currentRes = await charge(orderId, { total: 9, data: { cash: 9 } });
    assert.equal(currentRes.status, 200, JSON.stringify(currentRes.body));
});

test('stale order version: a version conflict is still caught (and takes precedence over) the total check', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Tea', price: 3, tenant_id: 1, category_id: 1, seq: 108 });
    const orderId = await seedPendingTableOrder('68');
    await sendToKitchen('68', orderId, { data: { quantity: { [itemId]: 1 } }, total: 3 });
    const orderBefore = await ctx.knex('orders').where({ id: orderId }).first();

    const res = await charge(orderId, { total: 3, data: { cash: 3 }, expected_version: Number(orderBefore.version) + 5 });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.conflict, true);
    assert.equal(res.body.totalMismatch, undefined, 'a version conflict must short-circuit before the total check ever runs');
    assert.equal((await ledgerRowsFor(orderId)).length, 0);
});

test('weight-sold items are a documented non-verifiable case: charging is never falsely rejected for them', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({
        name: 'Loose Almonds', price: 12, tenant_id: 1, category_id: 1, seq: 109, sold_by_weight: true, weight_unit: 'kg',
    });
    const orderId = await seedPendingTableOrder('69');
    // The table-order flow never sends a weight reading to the backend at all (a documented,
    // pre-existing gap -- see orderTotals.js's header comment) -- only a flat quantity of 1.
    await sendToKitchen('69', orderId, { data: { quantity: { [itemId]: 1 } }, total: 12 });

    // A weight-priced sale legitimately differs from `price * 1` (e.g. 0.3kg at EUR12/kg =
    // EUR3.60) -- this must NOT be rejected just because it doesn't match the flat unit price.
    const res = await charge(orderId, { total: 3.6, data: { cash: 3.6 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await ledgerRowsFor(orderId)).length, 1);
});

test('a non-charging /create call (no data/payment) is completely unaffected by total verification', async () => {
    const orderId = await seedPendingTableOrder('70');
    const res = await charge(orderId, { total: 999, data: null, payment_mode: '' });
    // No `data` at all -- falls through to the pre-existing `{status:false}` response, exactly
    // as before this feature existed, never a totalMismatch rejection.
    assert.equal(res.body.totalMismatch, undefined);
});

test('rounding tolerance: a total off by a single cent (float noise) is still accepted', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Juice', price: '3.33', tenant_id: 1, category_id: 1, seq: 110 });
    const orderId = await seedPendingTableOrder('71');
    await sendToKitchen('71', orderId, { data: { quantity: { [itemId]: 3 } }, total: 9.99 });

    // 3.33 * 3 = 9.99 exactly, but exercise a 1-cent float wobble a real client could produce.
    const res = await charge(orderId, { total: 10.0, data: { cash: 10.0 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
});
