'use strict';
/**
 * Loyalty transactional certification (CTO feedback 2026-09-22, item 14). `redeem()` used to
 * check the customer's balance, then insert the redeem row, as two completely separate,
 * un-synchronized queries -- the same class of lost-update race this codebase has already
 * fixed elsewhere for orders (optimistic locking, test/orders-optimistic-locking.test.js) and
 * idempotency keys (reserve-before-run). Two concurrent redemptions for the same customer
 * (loyalty is tenant-wide, not per-terminal) could both read the same balance, both pass the
 * "sufficient balance" check, and both insert -- overdrawing the customer into a negative
 * balance with no error ever raised. Fixed by running the check + insert inside one real
 * transaction with a post-insert invariant check before commit.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const loyalty = require('../services/loyaltyService');
const { setupTestApp, teardownTestApp } = require('./_helpers');
const request = require('supertest');

let ctx;
let customerId;

before(async () => {
    ctx = await setupTestApp('loyalty-redeem-race');
    [customerId] = await ctx.knex('customers').insert({
        name: 'Race Customer', phone: '+31600000099', tenant_id: 1, customer_code: 'LC-1-RACE0001',
    });
});

after(async () => {
    await teardownTestApp(ctx);
});

test('a normal, non-concurrent redemption still works exactly as before', async () => {
    await loyalty.adjust({ tenantId: 1, customerId, points: 300, reason: 'top-up', createdBy: 1 });
    const { euroValue } = await loyalty.redeem({ tenantId: 1, customerId, points: 250, createdBy: 1 });
    assert.equal(euroValue, 2.5); // 250 points * 1 cent
    const balance = await loyalty.getBalance(1, customerId);
    assert.equal(balance, 50);
});

test('two concurrent redemptions that would together overdraw the balance never both succeed', async () => {
    const [raceCustomerId] = await ctx.knex('customers').insert({
        name: 'Race Customer 2', phone: '+31600000098', tenant_id: 1, customer_code: 'LC-1-RACE0002',
    });
    // Exactly 300 points available. Two concurrent redemptions of 250 each (500 total) must
    // NEVER both succeed -- that would leave the customer at -200, an impossible balance.
    await loyalty.adjust({ tenantId: 1, customerId: raceCustomerId, points: 300, reason: 'top-up', createdBy: 1 });

    const results = await Promise.allSettled([
        loyalty.redeem({ tenantId: 1, customerId: raceCustomerId, points: 250, createdBy: 1 }),
        loyalty.redeem({ tenantId: 1, customerId: raceCustomerId, points: 250, createdBy: 1 }),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    assert.equal(succeeded.length, 1, `expected exactly one redemption to succeed, got ${succeeded.length} (results: ${JSON.stringify(results.map((r) => r.status))})`);
    assert.equal(failed.length, 1);
    assert.match(failed[0].reason.message, /insufficient balance|overdraw/i);

    const finalBalance = await loyalty.getBalance(1, raceCustomerId);
    assert.equal(finalBalance, 50, 'the customer must end up with exactly the correct remaining balance, never negative');
    assert.ok(finalBalance >= 0, 'a customer balance must never go negative, no matter how many concurrent redemptions race');
});

test('POST /loyalty/redeem (the real HTTP route) also rejects a redemption below the minimum, unaffected by the transaction change', async () => {
    const token = await require('./_helpers').loginAsAdmin(request, ctx.app);
    const [smallCustomerId] = await ctx.knex('customers').insert({
        name: 'Small Balance Customer', phone: '+31600000097', tenant_id: 1, customer_code: 'LC-1-RACE0003',
    });
    await loyalty.adjust({ tenantId: 1, customerId: smallCustomerId, points: 500, reason: 'top-up', createdBy: 1 });

    const res = await request(ctx.app).post('/loyalty/redeem').set('asmara-token', token)
        .send({ customer_id: smallCustomerId, points: 50 }); // below min_redeem_points (200)
    assert.equal(res.status, 400);
    assert.match(res.body.message, /minimum redemption/i);
});
