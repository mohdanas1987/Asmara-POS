/**
 * Regression test for the Reservation model fix: GET /tables/reservations used to return
 * report rows mislabeled as reservations (models/Reservation.js pointed at the wrong table
 * with a broken relation). This confirms it now returns real reservation data instead.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx, token;
before(async () => {
    ctx = await setupTestApp('reservations');
    token = await loginAsAdmin(request, ctx.app);
});
after(async () => { await teardownTestApp(ctx); });

test('GET /tables/reservations returns an empty list on a fresh database, not report data', async () => {
    const res = await request(ctx.app).get('/tables/reservations').set('asmara-token', token);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);
    assert.deepEqual(res.body.reservations, []);
});

test('a real reservation row comes back correctly once one exists', async () => {
    await ctx.knex('reservations').insert({
        customer_name: 'Jane Doe', phone: '0612345678', date: '2026-12-24',
        time: '19:00', party_size: 4, status: 'confirmed'
    });
    const res = await request(ctx.app).get('/tables/reservations').set('asmara-token', token);
    assert.equal(res.body.reservations.length, 1);
    assert.equal(res.body.reservations[0].customer_name, 'Jane Doe');
});
