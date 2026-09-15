/**
 * Weight-based menu items: a product can be marked `sold_by_weight` with a `weight_unit`
 * ('kg' | 'g' | 'lb'). When true, `price` is interpreted by the POS as price-per-unit rather
 * than price-per-item -- the actual weight × price calculation happens client-side (in the
 * POS cart), exactly like every other line-item calculation in this codebase (order.data is
 * client-composed JSON, per routes/orders.js). This suite only covers what the backend is
 * actually responsible for: storing and returning the two new columns correctly through the
 * item create/update/list routes used by the Menu admin screen and the POS item feed.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('weight-items');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('creating a normal (non-weight) item defaults sold_by_weight to false', async () => {
    const res = await request(ctx.app)
        .post('/items/create')
        .set('asmara-token', token)
        .field('name', 'Cola Can')
        .field('price', '2.50')
        .field('barcode', 'COLA-001');
    assert.equal(res.body.status, true);
    assert.equal(Boolean(res.body.product.sold_by_weight), false);
});

test('creating a weight-based item stores sold_by_weight + weight_unit', async () => {
    const res = await request(ctx.app)
        .post('/items/create')
        .set('asmara-token', token)
        .field('name', 'Loose Tomatoes')
        .field('price', '3.20') // price PER KG, not per item
        .field('barcode', 'VEG-TOM-01')
        .field('sold_by_weight', 'true')
        .field('weight_unit', 'kg');
    assert.equal(res.body.status, true);
    assert.equal(Boolean(res.body.product.sold_by_weight), true);
    assert.equal(res.body.product.weight_unit, 'kg');
    assert.equal(res.body.product.price, '3.20');
});

test('the admin item list (GET /items) returns the weight fields', async () => {
    const res = await request(ctx.app).get('/items').set('asmara-token', token);
    assert.equal(res.body.status, true);
    const tomatoes = res.body.products.find((p) => p.name === 'Loose Tomatoes');
    assert.ok(tomatoes, 'expected the seeded weight item to be in the list');
    assert.equal(Boolean(tomatoes.sold_by_weight), true);
    assert.equal(tomatoes.weight_unit, 'kg');
    const cola = res.body.products.find((p) => p.name === 'Cola Can');
    assert.equal(Boolean(cola.sold_by_weight), false);
});

test('the POS item feed (GET /pos/items) also returns the weight fields', async () => {
    const res = await request(ctx.app).get('/pos/items').set('asmara-token', token);
    assert.equal(res.body.status, true);
    const tomatoes = res.body.products.find((p) => p.name === 'Loose Tomatoes');
    assert.ok(tomatoes, 'expected the weight item on the POS feed (it defaults pos=true)');
    assert.equal(Boolean(tomatoes.sold_by_weight), true);
    assert.equal(tomatoes.weight_unit, 'kg');
});

test('updating an item can turn weight-mode on for an existing item', async () => {
    const createRes = await request(ctx.app)
        .post('/items/create')
        .set('asmara-token', token)
        .field('name', 'Mystery Cheese')
        .field('price', '1.00')
        .field('barcode', 'CHEESE-99');
    const id = createRes.body.product.id;

    const updateRes = await request(ctx.app)
        .post('/items/update')
        .set('asmara-token', token)
        .field('id', String(id))
        .field('name', 'Mystery Cheese')
        .field('price', '18.50')
        .field('code', 'CHEESE-99')
        .field('image', 'null')
        .field('sold_by_weight', 'true')
        .field('weight_unit', 'g');
    assert.equal(updateRes.body.status, true);
    assert.equal(Boolean(updateRes.body.updated.sold_by_weight), true);
    assert.equal(updateRes.body.updated.weight_unit, 'g');
});
