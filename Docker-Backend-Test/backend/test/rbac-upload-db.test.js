'use strict';
/**
 * RBAC certification (CTO feedback 2026-09-22, item 10 "Full RBAC runtime certification").
 * GET /config/upload-db/:client uploads the entire backing database file to an external URL
 * and previously required only `fetchuser` -- ANY logged-in staff member, including a cashier
 * or waiter, could trigger a full data-store upload to a third-party server. Every sibling
 * settings/backup action in routes/config.js (branding upload, customer-display media, the
 * daily-reports toggle) already requires `settings.manage`; this route was simply missed.
 * Fixed to require the same permission.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser } = require('./_helpers');

let ctx;
let adminToken;

before(async () => {
    ctx = await setupTestApp('rbac-upload-db');
    adminToken = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a cashier (no settings.manage) is forbidden from triggering the database upload', async () => {
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'cashier-upload-db@test.local', role: 'cashier' });
    const res = await request(ctx.app).get('/config/upload-db/test-client').set('asmara-token', cashierToken);
    assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('a waiter (no settings.manage) is forbidden from triggering the database upload', async () => {
    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'waiter-upload-db@test.local', role: 'waiter' });
    const res = await request(ctx.app).get('/config/upload-db/test-client').set('asmara-token', waiterToken);
    assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('an admin (has settings.manage) can reach the route -- the permission check itself does not block a legitimate call', async () => {
    // The route then tries a real network upload to an external host, which will fail in this
    // test environment -- that's fine, the point here is only that requirePermission() lets
    // an authorized caller PAST the 403, unlike the cashier/waiter above.
    const res = await request(ctx.app).get('/config/upload-db/test-client').set('asmara-token', adminToken);
    assert.notEqual(res.status, 403, 'an admin must not be blocked by the permission check');
});
