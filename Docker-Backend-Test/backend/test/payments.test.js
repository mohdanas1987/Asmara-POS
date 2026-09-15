/**
 * These tests cover the real, deterministic, local part of payment terminal support: the
 * config lifecycle (connect/status/disconnect) and charge()'s local validation. They
 * deliberately do NOT call out to Stripe/Adyen/SumUp/Mollie's real APIs -- doing so would
 * need real accounts and real network access from an automated suite that's supposed to stay
 * offline-safe and deterministic, and a bogus-credentials call would just 401 anyway, proving
 * nothing except that the network request was attempted. The adapters' actual provider calls
 * are unverified by design -- see payments/README.md.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('payments');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('starts disconnected with no provider', async () => {
    const res = await request(ctx.app).get('/payments/status').set('asmara-token', token);
    assert.equal(res.body.connected, false);
    assert.equal(res.body.provider, null);
});

test('rejects an unknown provider name', async () => {
    const res = await request(ctx.app)
        .post('/payments/connect')
        .set('asmara-token', token)
        .send({ provider: 'not-a-real-provider', api_key: 'x' });
    assert.equal(res.status, 400);
});

for (const provider of ['stripe', 'adyen', 'sumup', 'mollie']) {
    test(`connecting ${provider} stores masked credentials and shows up in status`, async () => {
        const connectRes = await request(ctx.app)
            .post('/payments/connect')
            .set('asmara-token', token)
            .send({ provider, api_key: `${provider}_test_key_1234567890`, terminal_id: 'TERMINAL-1' });
        assert.equal(connectRes.body.status, true);

        const statusRes = await request(ctx.app).get('/payments/status').set('asmara-token', token);
        assert.equal(statusRes.body.connected, true);
        assert.equal(statusRes.body.provider, provider);
        assert.ok(statusRes.body.api_key_masked.includes('*'));
        assert.ok(!statusRes.body.api_key_masked.includes('1234567890'.slice(0, -4)));
    });
}

test('charge is refused with no connected terminal', async () => {
    await request(ctx.app).post('/payments/disconnect').set('asmara-token', token);
    const res = await request(ctx.app)
        .post('/payments/charge')
        .set('asmara-token', token)
        .send({ order_id: 'abc', amount: 10 });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /no payment terminal/i);
});

test('charge requires amount and order_id', async () => {
    await request(ctx.app)
        .post('/payments/connect')
        .set('asmara-token', token)
        .send({ provider: 'stripe', api_key: 'sk_test_fake', terminal_id: 'tmr_fake' });

    const res = await request(ctx.app).post('/payments/charge').set('asmara-token', token).send({ order_id: 'abc' });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /amount and order_id/i);
});

test('disconnecting immediately blocks charging again', async () => {
    await request(ctx.app)
        .post('/payments/connect')
        .set('asmara-token', token)
        .send({ provider: 'mollie', api_key: 'test_fake', terminal_id: 'term_fake' });
    await request(ctx.app).post('/payments/disconnect').set('asmara-token', token);

    const res = await request(ctx.app)
        .post('/payments/charge')
        .set('asmara-token', token)
        .send({ order_id: 'abc', amount: 5 });
    assert.equal(res.status, 400);
});
