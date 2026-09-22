'use strict';
/**
 * Website <-> POS synchronization (CTO feedback 2026-09-22, item 15). POST /website/orders
 * (the webhook a restaurant's website plugin calls to push a new online order) had no
 * duplicate protection at all -- a webhook retry after a timeout or dropped response (an
 * extremely common failure mode: the order WAS created here, the website just never saw the
 * confirmation) would create a completely separate, duplicate online order every retry.
 * Fixed by wrapping the route in the same hardened `idempotent()` middleware already used for
 * /orders/create, /orders/to-kitchen, /orders/init, etc.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;
let apiKey;

before(async () => {
    ctx = await setupTestApp('website-order-idempotency');
    token = await loginAsAdmin(request, ctx.app);
    const connectRes = await request(ctx.app)
        .post('/website/connect')
        .set('asmara-token', token)
        .send({ website_url: 'https://idempotency-test.example' });
    apiKey = connectRes.body.api_key;
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a webhook retry with the SAME idempotency_key (the website\'s own order id) returns the same order, never a duplicate', async () => {
    const key = 'website-order-abc123';
    const payload = { items: [{ id: 1, name: 'Pizza', qty: 1 }], total: 15, customer_name: 'Retry Test', idempotency_key: key };

    const first = await request(ctx.app).post('/website/orders').set('x-api-key', apiKey).send(payload);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const orderId = first.body.order.id;

    // Simulates the website's plugin timing out waiting for the first response and retrying
    // the exact same webhook call -- the real scenario this closes.
    const retry = await request(ctx.app).post('/website/orders').set('x-api-key', apiKey).send(payload);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.order.id, orderId, 'a retried webhook must return the SAME order, not create a second one');

    const onlineOrders = await ctx.knex('orders').where({ tenant_id: 1, source: 'online' }).where('note', 'like', '%Retry Test%');
    assert.equal(onlineOrders.length, 1, 'exactly one order must exist no matter how many times the webhook was retried');
});

test('two different orders (different idempotency_key or none at all) are never confused with each other', async () => {
    const a = await request(ctx.app).post('/website/orders').set('x-api-key', apiKey)
        .send({ items: [{ id: 2, name: 'Salad', qty: 1 }], total: 8, customer_name: 'Customer A', idempotency_key: 'order-a' });
    const b = await request(ctx.app).post('/website/orders').set('x-api-key', apiKey)
        .send({ items: [{ id: 3, name: 'Soup', qty: 1 }], total: 6, customer_name: 'Customer B', idempotency_key: 'order-b' });

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.notEqual(a.body.order.id, b.body.order.id);
});

test('a website integration that sends NO idempotency_key at all is completely unaffected (backward compatible)', async () => {
    const res = await request(ctx.app).post('/website/orders').set('x-api-key', apiKey)
        .send({ items: [{ id: 4, name: 'Fries', qty: 1 }], total: 4, customer_name: 'No Key Customer' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.order.source, 'online');
});
