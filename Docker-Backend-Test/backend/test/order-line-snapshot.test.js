'use strict';
/**
 * Order line normalization, phase 1 (production-completion spec, section 7 "Normalized
 * order data model"). Verifies the REAL relational side: order_items/order_item_modifiers
 * get an immutable snapshot at the moment an order is actually charged (POST
 * /orders/create), carrying line-level identity, VAT breakdown, and modifier price deltas
 * -- and that this is additive: it never blocks or changes the existing charge/ledger flow.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('order-line-snapshot');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('cash_register').insert({
        tenant_id: 1, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
});

after(async () => {
    await teardownTestApp(ctx);
});

test('charging an order with line detail snapshots real order_items + order_item_modifiers rows', async () => {
    const [burgerId] = await ctx.knex('menu_items').insert({ name: 'Burger', price: '10.90', tax: '9', tenant_id: 1, category_id: 1, seq: 1 });
    const [friesId] = await ctx.knex('menu_items').insert({ name: 'Fries', price: '4.00', tax: '9', tenant_id: 1, category_id: 1, seq: 2 });

    await ctx.knex('orders').insert({
        id: 'order-snap-1', tenant_id: 1, tables: '5', status: 'in-kitchen', payment_status: 'pending',
        data: JSON.stringify({
            quantity: { [burgerId]: 1, [friesId]: 1 },
            lines: [
                { itemId: burgerId, qty: 1, modifiers: [{ name: 'Extra cheese', price_delta: 1.5 }] },
                { itemId: friesId, qty: 1 },
            ],
        }),
        total: 16.4, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-snap-1', total: 16.4, payment_mode: 'cash', data: { cash: 16.4 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const items = await ctx.knex('order_items').where({ tenant_id: 1, order_id: 'order-snap-1' }).orderBy('line_index', 'asc');
    assert.equal(items.length, 2, 'expected one order_items row per cart line');

    const burgerLine = items[0];
    assert.equal(burgerLine.product_name, 'Burger');
    assert.equal(Number(burgerLine.quantity), 1);
    // unit price 10.90 + modifier delta 1.50 = 12.40 gross
    assert.equal(Number(burgerLine.unit_price_gross).toFixed(2), '12.40');
    assert.equal(Number(burgerLine.gross_amount).toFixed(2), '12.40');
    // VAT-inclusive: 12.40 * 9 / 109 = 1.0238...
    assert.equal(Number(burgerLine.vat_amount).toFixed(2), '1.02');
    assert.equal(Number(burgerLine.net_amount).toFixed(2), '11.38');

    const friesLine = items[1];
    assert.equal(friesLine.product_name, 'Fries');
    assert.equal(Number(friesLine.unit_price_gross).toFixed(2), '4.00');

    const mods = await ctx.knex('order_item_modifiers').where({ order_item_id: burgerLine.id });
    assert.equal(mods.length, 1);
    assert.equal(mods[0].modifier_name, 'Extra cheese');
    assert.equal(Number(mods[0].price_delta), 1.5);

    const friesMods = await ctx.knex('order_item_modifiers').where({ order_item_id: friesLine.id });
    assert.equal(friesMods.length, 0);
});

test('two lines of the same product with different modifier selections stay as two separate order_items rows', async () => {
    const [burgerId] = await ctx.knex('menu_items').insert({ name: 'Burger', price: '10.00', tax: '9', tenant_id: 1, category_id: 1, seq: 3 });

    await ctx.knex('orders').insert({
        id: 'order-snap-2', tenant_id: 1, tables: '6', status: 'in-kitchen', payment_status: 'pending',
        data: JSON.stringify({
            quantity: { [burgerId]: 2 },
            lines: [
                { itemId: burgerId, qty: 1, modifiers: [{ name: 'Cheese', price_delta: 1 }] },
                { itemId: burgerId, qty: 1, modifiers: [{ name: 'No cheese', price_delta: 0 }] },
            ],
        }),
        total: 21, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-snap-2', total: 21, payment_mode: 'cash', data: { cash: 21 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const items = await ctx.knex('order_items').where({ tenant_id: 1, order_id: 'order-snap-2' }).orderBy('line_index', 'asc');
    assert.equal(items.length, 2, 'Burger+Cheese and Burger+No-cheese must remain two separate rows, not collapse to Burger x2');
    assert.notEqual(Number(items[0].unit_price_gross), Number(items[1].unit_price_gross));
});

test('re-charging the same order (e.g. a second /create call in a split-payment flow) does not duplicate the snapshot', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Soda', price: '3.00', tax: '9', tenant_id: 1, category_id: 1, seq: 4 });

    await ctx.knex('orders').insert({
        id: 'order-snap-3', tenant_id: 1, tables: '7', status: 'in-kitchen', payment_status: 'pending',
        data: JSON.stringify({ quantity: { [itemId]: 1 }, lines: [{ itemId, qty: 1 }] }),
        total: 3, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-snap-3', total: 3, payment_mode: 'cash', data: { cash: 1.5 } });
    // Second call for the same order (partial -> full payment) -- orders.data by now holds
    // the payment-modes object from the first call, not line detail, so this also proves the
    // "read lines before they get overwritten" ordering fix actually works end-to-end.
    await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-snap-3', total: 3, payment_mode: 'cash', data: { cash: 1.5 } });

    const items = await ctx.knex('order_items').where({ tenant_id: 1, order_id: 'order-snap-3' });
    assert.equal(items.length, 1, 'the second charge must not create a duplicate snapshot row');
});

test('an order with no line detail at all (only an aggregate quantity map) still gets a usable snapshot via the fallback path', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Water', price: '2.00', tax: '9', tenant_id: 1, category_id: 1, seq: 5 });

    await ctx.knex('orders').insert({
        id: 'order-snap-4', tenant_id: 1, tables: '8', status: 'in-kitchen', payment_status: 'pending',
        data: JSON.stringify({ quantity: { [itemId]: 3 } }), // no `lines` array at all
        total: 6, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const res = await request(ctx.app)
        .post('/orders/create')
        .set('asmara-token', token)
        .send({ order_id: 'order-snap-4', total: 6, payment_mode: 'cash', data: { cash: 6 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const items = await ctx.knex('order_items').where({ tenant_id: 1, order_id: 'order-snap-4' });
    assert.equal(items.length, 1);
    assert.equal(Number(items[0].quantity), 3);
    assert.equal(items[0].product_name, 'Water');
});
