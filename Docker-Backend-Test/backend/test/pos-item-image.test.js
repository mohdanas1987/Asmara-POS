'use strict';
/**
 * Regression test for a real, live-reported bug (project audit 2026-09-16: "photos of the
 * dish are inaccurate"). GET /pos/items used to prefer the legacy `thumb` column over the
 * real `image` an owner uploads today via the item form -- see routes/pos.js. Confirms the
 * fix: a real `image` always wins, `thumb` is only a fallback for an item that never had a
 * real photo uploaded.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('pos-item-image');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('GET /pos/items prefers the real uploaded image over a stale legacy thumb', async () => {
    const [categoryId] = await ctx.knex('menu_categories').insert({ name: 'Mains', tenant_id: 1 });
    await ctx.knex('menu_items').insert({
        name: 'Doro Wat',
        price: 12.5,
        tax: '9',
        category_id: categoryId,
        pos: true,
        thumb: 'products/wrong-stock-photo.webp',
        image: 'products/doro_wat_real.webp',
        tenant_id: 1,
    });

    const res = await request(ctx.app).get('/pos/items').set('asmara-token', token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const item = res.body.products.find((p) => p.name === 'Doro Wat');
    assert.ok(item, 'expected the seeded item to appear in the POS feed');
    assert.equal(item.image, 'products/doro_wat_real.webp');
});

test('GET /pos/items falls back to the legacy thumb only when no real image was ever uploaded', async () => {
    const [categoryId] = await ctx.knex('menu_categories').insert({ name: 'Sides', tenant_id: 1 });
    await ctx.knex('menu_items').insert({
        name: 'Injera',
        price: 3,
        tax: '9',
        category_id: categoryId,
        pos: true,
        thumb: 'products/legacy-injera.webp',
        image: null,
        tenant_id: 1,
    });

    const res = await request(ctx.app).get('/pos/items').set('asmara-token', token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const item = res.body.products.find((p) => p.name === 'Injera');
    assert.ok(item);
    assert.equal(item.image, 'products/legacy-injera.webp');
});
