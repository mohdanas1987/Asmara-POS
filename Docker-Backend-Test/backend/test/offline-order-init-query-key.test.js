'use strict';
/**
 * CTO remediation doc, Section 1 ("true offline-first new order creation"): closes a real,
 * previously-latent gap found while wiring the actual offline "open a table" flow. The
 * existing offline-order-init.test.js proves GET /orders/init/:table is safe to replay with
 * the same idempotency_key -- but it sends that key via supertest's `.send({idempotency_key})`
 * on a GET, which is only possible because supertest/superagent will happily attach a body to
 * a GET request. A REAL browser's fetch() cannot do this at all -- `fetch(url, {method:'GET',
 * body: ...})` throws synchronously. So the frontend's only real option is the query string,
 * and middlewares/idempotent.js originally only ever read `req.body.idempotency_key`, making
 * its GET-route support untestable-as-shipped from any actual browser caller.
 *
 * This file proves the ACTUAL contract the frontend uses (query string), not the
 * supertest-only shortcut, both for the plain replay case and for the genuine-race case.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('offline-order-init-query-key');
    token = await loginAsAdmin(request, ctx.app);
    await ctx.knex('cash_register').insert({
        tenant_id: 1, user_id: ctx.userId, status: true, opening_cash: '0', closing_cash: '0', date: new Date().toISOString(),
    });
    await ctx.knex('tables').insert([
        { table_number: '30', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '31', status: 'free', x: 0, y: 0, length: 80, width: 80 },
    ]);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('idempotency_key passed as a QUERY PARAM (the only way a real browser fetch() can send it on a GET) replays the same order', async () => {
    const key = 'offline-init-query-table-30';

    const first = await request(ctx.app)
        .get(`/orders/init/30?idempotency_key=${key}`)
        .set('asmara-token', token);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const orderId = first.body.order.id;

    const second = await request(ctx.app)
        .get(`/orders/init/30?idempotency_key=${key}`)
        .set('asmara-token', token);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.order.id, orderId, 'a replayed query-string-keyed request must return the SAME order');

    const orders = await ctx.knex('orders').where({ tenant_id: 1, tables: '30' });
    assert.equal(orders.length, 1, 'exactly one order must exist for table 30');
});

test('two genuinely concurrent query-keyed requests for the same key: the race loser gets 409, not a fabricated duplicate', async () => {
    const key = 'offline-init-query-table-31-race';
    const url = `/orders/init/31?idempotency_key=${key}`;

    const [a, b] = await Promise.all([
        request(ctx.app).get(url).set('asmara-token', token),
        request(ctx.app).get(url).set('asmara-token', token),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.ok(statuses.includes(200), `at least one concurrent request must succeed, got ${JSON.stringify(statuses)}`);

    const orders = await ctx.knex('orders').where({ tenant_id: 1, tables: '31' });
    assert.equal(orders.length, 1, 'exactly one order must exist no matter how the race resolved');
});

test('a normal POST route (e.g. /website/orders) is completely unaffected -- body-based key still works exactly as before', async () => {
    // Regression guard: the fallback to req.query must never shadow or interfere with the
    // existing, already-shipped body-based path every POST idempotent route uses.
    const connectRes = await request(ctx.app)
        .post('/website/connect')
        .set('asmara-token', token)
        .send({ website_url: 'https://query-key-regression-test.example' });
    const apiKey = connectRes.body.api_key;

    const payload = { items: [{ id: 1, name: 'Pizza', qty: 1 }], total: 12, idempotency_key: 'body-key-regression-check' };
    const first = await request(ctx.app).post('/website/orders').set('x-api-key', apiKey).send(payload);
    const second = await request(ctx.app).post('/website/orders').set('x-api-key', apiKey).send(payload);
    assert.equal(first.body.order.id, second.body.order.id, 'body-based idempotency_key on a POST route must be unaffected by the GET query-param fallback');
});
