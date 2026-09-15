/**
 * Regression test for the real crash bug found and fixed in Stage 2b: pos.js's /session
 * route had no try/catch and threw when a cash register had no prior session -- an
 * unhandled promise rejection that could crash the whole server. This test is the automated
 * guard against that ever regressing.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx, token;
before(async () => {
    ctx = await setupTestApp('pos-session');
    token = await loginAsAdmin(request, ctx.app);
});
after(async () => { await teardownTestApp(ctx); });

test('POST /pos/session on a cash register with zero prior sessions returns session 1, not a crash', async () => {
    const res = await request(ctx.app).post('/pos/session').set('asmara-token', token)
        .send({ cash_register_id: 999 });
    assert.equal(res.status, 200);
    assert.equal(res.body.session, 1);
});

test('POST /pos/session increments correctly when a prior session exists', async () => {
    await ctx.knex('order_details').insert({ cash_register_id: 42, session_id: 5 });
    const res = await request(ctx.app).post('/pos/session').set('asmara-token', token)
        .send({ cash_register_id: 42 });
    assert.equal(res.status, 200);
    assert.equal(res.body.session, 6);
});
