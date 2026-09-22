'use strict';
/**
 * Complete audit-event coverage (CTO feedback 2026-09-22, item 9). Two real, previously-
 * unaudited actions closed this session, both classic POS fraud/error vectors with real
 * money consequences:
 *
 *  - POST /items/update changing an item's price -- a manager (or a compromised manager
 *    account) quietly lowering a price to under-ring a sale and pocket the difference in cash
 *    leaves no trace at all without this.
 *  - POST /pos/opening-day-cash-amount -- the opening cash figure every later shortage/
 *    overage calculation is measured against; a manipulated opening amount is a
 *    straightforward way to hide a shortage.
 *
 * This is not "complete audit-event coverage" for the whole app (see the tracker doc) -- it
 * closes these two specific, high-value gaps, verified with real tests, same as every other
 * item in this session.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('audit-coverage-gaps');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

async function lastAuditEvent(eventType) {
    return ctx.knex('audit_events').where({ tenant_id: 1, event_type: eventType }).orderBy('id', 'desc').first();
}

test('changing an item\'s price records a menu_item.price_change audit event with old and new price', async () => {
    const createRes = await request(ctx.app)
        .post('/items/create')
        .set('asmara-token', token)
        .field('name', 'Audit Test Burger')
        .field('price', '10.00')
        .field('barcode', 'AUDIT-BURGER-01');
    assert.equal(createRes.body.status, true, JSON.stringify(createRes.body));
    const id = createRes.body.product.id;

    const updateRes = await request(ctx.app)
        .post('/items/update')
        .set('asmara-token', token)
        .field('id', String(id))
        .field('name', 'Audit Test Burger')
        .field('price', '4.00') // suspicious drop
        .field('code', 'AUDIT-BURGER-01')
        .field('image', 'null');
    assert.equal(updateRes.body.status, true, JSON.stringify(updateRes.body));

    const event = await lastAuditEvent('menu_item.price_change');
    assert.ok(event, 'expected a menu_item.price_change audit event to be recorded');
    assert.equal(event.entity_type, 'item');
    assert.equal(event.entity_id, String(id));
    const payload = JSON.parse(event.payload);
    assert.equal(payload.old_price, '10.00');
    assert.equal(payload.new_price, '4.00');
});

test('updating an item WITHOUT changing the price records no price_change event (no noise)', async () => {
    const createRes = await request(ctx.app)
        .post('/items/create')
        .set('asmara-token', token)
        .field('name', 'Audit Test Fries')
        .field('price', '3.00')
        .field('barcode', 'AUDIT-FRIES-01');
    const id = createRes.body.product.id;

    const before_ = await ctx.knex('audit_events').where({ tenant_id: 1, event_type: 'menu_item.price_change' }).count('* as c').first();

    const updateRes = await request(ctx.app)
        .post('/items/update')
        .set('asmara-token', token)
        .field('id', String(id))
        .field('name', 'Audit Test Fries (Renamed)')
        .field('price', '3.00') // unchanged
        .field('code', 'AUDIT-FRIES-01')
        .field('image', 'null');
    assert.equal(updateRes.body.status, true, JSON.stringify(updateRes.body));

    const after_ = await ctx.knex('audit_events').where({ tenant_id: 1, event_type: 'menu_item.price_change' }).count('* as c').first();
    assert.equal(Number(after_.c), Number(before_.c), 'a name-only update must not create a spurious price-change event');
});

test('opening the cash register records a cash_register.open audit event with the opening amount', async () => {
    const res = await request(ctx.app)
        .post('/pos/opening-day-cash-amount')
        .set('asmara-token', token)
        .send({ cash: '150.00' });
    assert.equal(res.body.status, true, JSON.stringify(res.body));

    const event = await lastAuditEvent('cash_register.open');
    assert.ok(event, 'expected a cash_register.open audit event to be recorded');
    assert.equal(event.entity_type, 'cash_register');
    assert.equal(event.entity_id, String(res.body.created.id));
    const payload = JSON.parse(event.payload);
    assert.equal(payload.opening_cash, '150.00');
});
