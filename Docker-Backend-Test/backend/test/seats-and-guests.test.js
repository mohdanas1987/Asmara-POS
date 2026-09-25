'use strict';
/**
 * Seat & guest architecture (CTO doc "Asmara POS -- Remaining Work Only", Phase 22/item 3 --
 * "no first-class domain model for Table -> Seats -> Order -> Guest -> Order Item -> Seat")
 * and Phase 23/item 4 ("seat-based bill splitting"). See migrations_local/0026's header
 * comment for why a seat is scoped per-order (numbered 1..N) rather than a fixed row on
 * `tables`.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedSecondTenant } = require('./_helpers');
const Order = require('../models/Order');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('seats-and-guests');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

async function seedOrder(tableNumber) {
    const order = await Order.query().insertAndFetch({ tenant_id: 1, tables: tableNumber, status: 'pending', version: 1 });
    return order.id;
}

test('naming a guest at a seat creates a real, listable row', async () => {
    const orderId = await seedOrder('80');

    const res = await request(ctx.app)
        .post(`/orders/${orderId}/guests`)
        .set('asmara-token', token)
        .send({ seat_number: 1, guest_name: 'Alex' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.guest.seat_number, 1);
    assert.equal(res.body.guest.guest_name, 'Alex');

    const listRes = await request(ctx.app).get(`/orders/${orderId}/guests`).set('asmara-token', token);
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.guests.length, 1);
    assert.equal(listRes.body.guests[0].guest_name, 'Alex');
});

test('naming the same seat twice updates the guest rather than creating a second row', async () => {
    const orderId = await seedOrder('81');
    await request(ctx.app).post(`/orders/${orderId}/guests`).set('asmara-token', token).send({ seat_number: 2, guest_name: 'Sam' });
    const res = await request(ctx.app).post(`/orders/${orderId}/guests`).set('asmara-token', token).send({ seat_number: 2, guest_name: 'Samantha' });
    assert.equal(res.status, 200);

    const listRes = await request(ctx.app).get(`/orders/${orderId}/guests`).set('asmara-token', token);
    assert.equal(listRes.body.guests.length, 1, 'must update in place, not duplicate');
    assert.equal(listRes.body.guests[0].guest_name, 'Samantha');
});

test('removing a guest clears the name but a seat with no guest is still valid to assign items to', async () => {
    const orderId = await seedOrder('82');
    await request(ctx.app).post(`/orders/${orderId}/guests`).set('asmara-token', token).send({ seat_number: 1, guest_name: 'Jo' });

    const delRes = await request(ctx.app).delete(`/orders/${orderId}/guests/1`).set('asmara-token', token);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.deleted, 1);

    const listRes = await request(ctx.app).get(`/orders/${orderId}/guests`).set('asmara-token', token);
    assert.equal(listRes.body.guests.length, 0);
});

test('a seat_number of 0 or negative is rejected', async () => {
    const orderId = await seedOrder('83');
    const res = await request(ctx.app).post(`/orders/${orderId}/guests`).set('asmara-token', token).send({ seat_number: 0, guest_name: 'X' });
    assert.equal(res.status, 400);
});

test('tenant isolation: a guest named on tenant 1\'s order is invisible to tenant 2', async () => {
    const { token: token2 } = await seedSecondTenant(request, ctx.app, ctx.knex);
    const orderId = await seedOrder('84');
    await request(ctx.app).post(`/orders/${orderId}/guests`).set('asmara-token', token).send({ seat_number: 1, guest_name: 'Tenant1Guest' });

    const listRes = await request(ctx.app).get(`/orders/${orderId}/guests`).set('asmara-token', token2);
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.guests.length, 0, 'a different tenant must never see another tenant\'s guest rows');
});

test('charging an order with seat-tagged lines snapshots seat_number onto order_items', async () => {
    const [burgerId] = await ctx.knex('menu_items').insert({ name: 'Burger', price: 10, tenant_id: 1, category_id: 1, seq: 200 });
    const [friesId] = await ctx.knex('menu_items').insert({ name: 'Fries', price: 4, tenant_id: 1, category_id: 1, seq: 201 });

    await ctx.knex('orders').insert({
        id: 'order-seat-1', tenant_id: 1, tables: '85', status: 'in-kitchen', payment_status: 'pending',
        data: JSON.stringify({
            quantity: { [burgerId]: 1, [friesId]: 1 },
            lines: [
                { itemId: burgerId, qty: 1, seat: 1 },
                { itemId: friesId, qty: 1, seat: 2 },
            ],
        }),
        total: 14, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await ctx.knex('cash_register').insert({ tenant_id: 1, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString() });

    const res = await request(ctx.app).post('/orders/create').set('asmara-token', token)
        .send({ order_id: 'order-seat-1', total: 14, payment_mode: 'cash', data: { cash: 14 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const items = await ctx.knex('order_items').where({ tenant_id: 1, order_id: 'order-seat-1' }).orderBy('line_index', 'asc');
    assert.equal(items.length, 2);
    assert.equal(items[0].seat_number, 1);
    assert.equal(items[1].seat_number, 2);
});

test('seat-based bill split: each seat gets its own real total, computed from persisted seat assignments (no manual re-assignment needed)', async () => {
    const [burgerId] = await ctx.knex('menu_items').insert({ name: 'Steak', price: 20, tenant_id: 1, category_id: 1, seq: 202 });
    const [saladId] = await ctx.knex('menu_items').insert({ name: 'Salad', price: 8, tenant_id: 1, category_id: 1, seq: 203 });
    const [breadId] = await ctx.knex('menu_items').insert({ name: 'Bread (shared)', price: 3, tenant_id: 1, category_id: 1, seq: 204 });

    const orderId = await seedOrder('86');
    await request(ctx.app).post(`/orders/${orderId}/guests`).set('asmara-token', token).send({ seat_number: 1, guest_name: 'Priya' });
    await request(ctx.app).post(`/orders/${orderId}/guests`).set('asmara-token', token).send({ seat_number: 2, guest_name: 'Tom' });

    await ctx.knex('orders').where({ id: orderId }).update({
        status: 'in-kitchen',
        total: 31,
        data: JSON.stringify({
            quantity: { [burgerId]: 1, [saladId]: 1, [breadId]: 1 },
            lines: [
                { itemId: burgerId, qty: 1, seat: 1 },
                { itemId: saladId, qty: 1, seat: 2 },
                { itemId: breadId, qty: 1 }, // shared starter -- no seat assigned
            ],
        }),
    });

    const res = await request(ctx.app)
        .post(`/orders/${orderId}/bill-split/preview`)
        .set('asmara-token', token)
        .send({ mode: 'seat' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.shares.length, 3);

    const priya = res.body.shares.find((s) => s.seat_number === 1);
    const tom = res.body.shares.find((s) => s.seat_number === 2);
    const unassigned = res.body.shares.find((s) => s.seat_number === null);

    assert.equal(priya.label, 'Priya', 'a named guest must label their own seat\'s total');
    assert.equal(priya.amount, 20);
    assert.equal(tom.label, 'Tom');
    assert.equal(tom.amount, 8);
    assert.equal(unassigned.label, 'Unassigned');
    assert.equal(unassigned.amount, 3, 'a shared/unassigned item must still be counted, never silently dropped');

    const sum = res.body.shares.reduce((s, share) => s + share.amount, 0);
    assert.equal(sum, 31, 'seat totals must always add up to the full order total -- nothing lost, nothing invented');
});

test('seat-based bill split: a seat with no named guest still gets a real total, labeled "Seat N"', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Coffee', price: 3, tenant_id: 1, category_id: 1, seq: 205 });
    const orderId = await seedOrder('87');
    await ctx.knex('orders').where({ id: orderId }).update({
        status: 'in-kitchen', total: 3,
        data: JSON.stringify({ quantity: { [itemId]: 1 }, lines: [{ itemId, qty: 1, seat: 5 }] }),
    });

    const res = await request(ctx.app).post(`/orders/${orderId}/bill-split/preview`).set('asmara-token', token).send({ mode: 'seat' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.shares.length, 1);
    assert.equal(res.body.shares[0].label, 'Seat 5');
    assert.equal(res.body.shares[0].amount, 3);
});

test('seat-based bill split refuses an order with no line detail, same as item-split does', async () => {
    const orderId = await seedOrder('88');
    await ctx.knex('orders').where({ id: orderId }).update({ status: 'in-kitchen', total: 10, data: JSON.stringify({ quantity: {} }) });

    const res = await request(ctx.app).post(`/orders/${orderId}/bill-split/preview`).set('asmara-token', token).send({ mode: 'seat' });
    assert.equal(res.status, 400);
});
