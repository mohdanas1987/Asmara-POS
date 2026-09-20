'use strict';
/**
 * Staff quick-login: PIN + QR badge (CTO forensic audit 2026-09-20, task "QR staff login" --
 * flagged as never built, correctly). Covers setting a PIN (self and by a manager), the
 * PIN-login swap, issuing/revoking a QR badge, the QR-login swap, and tenant isolation.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser, seedSecondTenant } = require('./_helpers');

let ctx;
let adminToken;

before(async () => {
    ctx = await setupTestApp('staff-quick-login');
    adminToken = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a staff member can set their own PIN', async () => {
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'cashier@test.local', role: 'cashier' });
    const me = await ctx.knex('users').where('email', 'cashier@test.local').first();

    const res = await request(ctx.app)
        .post(`/users/${me.id}/pin`)
        .set('asmara-token', cashierToken)
        .send({ pin: '1234' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);

    const row = await ctx.knex('users').where('id', me.id).first();
    assert.ok(row.pin_hash, 'pin_hash should now be set');
});

test('a cashier cannot set ANOTHER staff member\'s PIN (requires staff.manage)', async () => {
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'cashier2@test.local', role: 'cashier' });
    const waiter = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter1@test.local', role: 'waiter' });
    const waiterRow = await ctx.knex('users').where('email', 'waiter1@test.local').first();

    const res = await request(ctx.app)
        .post(`/users/${waiterRow.id}/pin`)
        .set('asmara-token', cashierToken)
        .send({ pin: '9999' });
    assert.equal(res.status, 403);
});

test('an admin/manager CAN set another staff member\'s PIN', async () => {
    const waiterRow = await ctx.knex('users').where('email', 'waiter1@test.local').first();
    const res = await request(ctx.app)
        .post(`/users/${waiterRow.id}/pin`)
        .set('asmara-token', adminToken)
        .send({ pin: '4321' });
    assert.equal(res.status, 200);
});

test('POST /auth/pin-login with the right PIN returns a real JWT for that staff member, not the caller', async () => {
    const waiterRow = await ctx.knex('users').where('email', 'waiter1@test.local').first();
    const res = await request(ctx.app)
        .post('/auth/pin-login')
        .set('asmara-token', adminToken) // terminal is currently logged in as admin
        .send({ pin: '4321' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);
    assert.equal(res.body.user.id, waiterRow.id);
    assert.ok(res.body.authToken);
});

test('POST /auth/pin-login with a wrong PIN is rejected, not silently matched', async () => {
    const res = await request(ctx.app)
        .post('/auth/pin-login')
        .set('asmara-token', adminToken)
        .send({ pin: '0000' });
    assert.equal(res.status, 400);
});

test('a manager can issue a QR badge, and the raw token is returned only at issue time', async () => {
    const waiterRow = await ctx.knex('users').where('email', 'waiter1@test.local').first();
    const res = await request(ctx.app)
        .post(`/users/${waiterRow.id}/qr-badge`)
        .set('asmara-token', adminToken);
    assert.equal(res.status, 200);
    assert.ok(res.body.qr_token);

    const list = await request(ctx.app).get('/users').set('asmara-token', adminToken);
    const found = list.body.staff.find((s) => s.id === waiterRow.id);
    assert.equal(found.has_qr_badge, true);
    assert.equal('qr_token' in found, false, 'the raw token must never appear in the staff list');
});

test('POST /auth/qr-login with that badge token logs in as the badge owner', async () => {
    const waiterRow = await ctx.knex('users').where('email', 'waiter1@test.local').first();
    const issued = await request(ctx.app).post(`/users/${waiterRow.id}/qr-badge`).set('asmara-token', adminToken);

    const res = await request(ctx.app)
        .post('/auth/qr-login')
        .set('asmara-token', adminToken)
        .send({ qr_token: issued.body.qr_token });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, waiterRow.id);
});

test('revoking a QR badge immediately blocks that token from logging in', async () => {
    const waiterRow = await ctx.knex('users').where('email', 'waiter1@test.local').first();
    const issued = await request(ctx.app).post(`/users/${waiterRow.id}/qr-badge`).set('asmara-token', adminToken);

    await request(ctx.app).delete(`/users/${waiterRow.id}/qr-badge`).set('asmara-token', adminToken);

    const res = await request(ctx.app)
        .post('/auth/qr-login')
        .set('asmara-token', adminToken)
        .send({ qr_token: issued.body.qr_token });
    assert.equal(res.status, 400);
});

test('a second tenant\'s PIN never matches against the first tenant\'s staff', async () => {
    const second = await seedSecondTenant(request, ctx.app, ctx.knex);
    await ctx.knex('users').where('id', second.userId).update({ pin_hash: await require('bcrypt').hash('4321', 8) });

    // Tenant 1's admin tries the exact same PIN tenant 2's admin now has -- must not match
    // across tenants even though the hash technically could collide in theory.
    const res = await request(ctx.app)
        .post('/auth/pin-login')
        .set('asmara-token', adminToken)
        .send({ pin: '4321' });
    // Tenant 1's own waiter already has PIN 4321 from an earlier test in this file, so this
    // should match tenant 1's waiter, never tenant 2's admin.
    assert.equal(res.status, 200);
    assert.notEqual(res.body.user.tenant_id, second.tenantId);
});
