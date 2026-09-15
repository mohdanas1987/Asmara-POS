/**
 * Confirms the Stage 2 auth-gap fixes actually reject unauthenticated requests for real,
 * against a running server -- not just "the code has fetchuser in it now".
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
before(async () => { ctx = await setupTestApp('auth-gaps'); });
after(async () => { await teardownTestApp(ctx); });

const previouslyOpenRoutes = [
    ['get', '/tables/'],
    ['get', '/tables/free-all'],
    ['post', '/tables/split-table/1'],
    ['post', '/orders/cancel/x/1'],
    ['post', '/pos/session'],
    ['post', '/items/updateStock/1'],
    ['get', '/menu/toggle/1/0'],
];

for (const [method, url] of previouslyOpenRoutes) {
    test(`${method.toUpperCase()} ${url} rejects an unauthenticated request (401)`, async () => {
        const res = await request(ctx.app)[method](url);
        assert.equal(res.status, 401, `expected 401, got ${res.status}: ${JSON.stringify(res.body)}`);
    });
}

test('the SAME route succeeds once authenticated', async () => {
    const token = await loginAsAdmin(request, ctx.app);
    const res = await request(ctx.app).get('/tables/').set('asmara-token', token);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);
});
