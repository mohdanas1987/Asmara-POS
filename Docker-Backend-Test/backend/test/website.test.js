const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('website');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('website starts disconnected', async () => {
    const res = await request(ctx.app).get('/website/status').set('asmara-token', token);
    assert.equal(res.body.connected, false);
});

test('menu-feed rejects requests with no api key', async () => {
    const res = await request(ctx.app).get('/website/menu-feed');
    assert.equal(res.status, 401);
});

test('menu-feed rejects an unconnected/unknown api key', async () => {
    const res = await request(ctx.app).get('/website/menu-feed').set('x-api-key', 'not-a-real-key');
    assert.equal(res.status, 401);
});

test('connecting the website issues a working api key', async () => {
    const connectRes = await request(ctx.app)
        .post('/website/connect')
        .set('asmara-token', token)
        .send({ website_url: 'https://asmara-eindhoven.nl' });
    assert.equal(connectRes.body.status, true);
    assert.ok(connectRes.body.api_key);

    const statusRes = await request(ctx.app).get('/website/status').set('asmara-token', token);
    assert.equal(statusRes.body.connected, true);
    assert.equal(statusRes.body.website_url, 'https://asmara-eindhoven.nl');

    const feedRes = await request(ctx.app).get('/website/menu-feed').set('x-api-key', connectRes.body.api_key);
    assert.equal(feedRes.status, 200);
    assert.equal(feedRes.body.status, true);
    assert.ok(Array.isArray(feedRes.body.categories));
    assert.ok(Array.isArray(feedRes.body.products));
});

test('a real online order via the webhook is tagged source=online and shows up in /orders', async () => {
    const connectRes = await request(ctx.app)
        .post('/website/connect')
        .set('asmara-token', token)
        .send({ website_url: 'https://asmara-eindhoven.nl' });
    const apiKey = connectRes.body.api_key;

    const orderRes = await request(ctx.app)
        .post('/website/orders')
        .set('x-api-key', apiKey)
        .send({ items: [{ id: 1, name: 'Pizza', qty: 2 }], total: 24.5, customer_name: 'Jane' });

    assert.equal(orderRes.status, 200);
    assert.equal(orderRes.body.order.source, 'online');

    const listRes = await request(ctx.app).get('/orders/').set('asmara-token', token);
    const found = listRes.body.orders.find((o) => o.id === orderRes.body.order.id);
    assert.ok(found, 'the online order should appear in the normal orders list');
    assert.equal(found.source, 'online');
});

test('disconnecting the website immediately blocks the menu feed and the order webhook', async () => {
    const connectRes = await request(ctx.app)
        .post('/website/connect')
        .set('asmara-token', token)
        .send({ website_url: 'https://asmara-eindhoven.nl' });
    const apiKey = connectRes.body.api_key;

    await request(ctx.app).post('/website/disconnect').set('asmara-token', token);

    const feedRes = await request(ctx.app).get('/website/menu-feed').set('x-api-key', apiKey);
    assert.equal(feedRes.status, 401);

    const orderRes = await request(ctx.app)
        .post('/website/orders')
        .set('x-api-key', apiKey)
        .send({ items: [{ id: 1, name: 'Pizza', qty: 1 }], total: 12 });
    assert.equal(orderRes.status, 401);
});

test('a normal POS direct sale still defaults to source=pos, unaffected by this feature', async () => {
    const kitchenRes = await request(ctx.app)
        .post('/orders/to-kitchen')
        .set('asmara-token', token)
        .send({ data: { quantity: { 1: 1 } }, total: 9.5 });

    assert.equal(kitchenRes.body.status, true);
    assert.equal(kitchenRes.body.order.source, 'pos');
});
