'use strict';
/**
 * Payment state machine + crash/recovery/reconciliation (CTO feedback 2026-09-22, items 5-6).
 * Exercises the real gap this closed: POST /payments/charge used to fire a real terminal
 * charge and relay the provider's raw response, without ever writing to the payment_attempts
 * or payment_transactions tables -- a successful terminal charge could vanish with no ledger
 * trace at all if anything went wrong after the provider confirmed it.
 *
 * Uses the always-available mock provider (payments/mock.js) rather than a real Stripe/Adyen/
 * SumUp/Mollie account (none available, see payments/README.md) -- its behavior is fully
 * controllable via `mock_behavior`, which is exactly what's needed to exercise every state
 * this machine can end up in: immediate success, an explicit decline, a payment that resolves
 * asynchronously (pending -> reconciled), and a request that fails outright before any
 * provider payment id is ever returned (the one gap this pass cannot close -- see
 * services/payments/paymentAttempts.js's reconcile() header comment).
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('payment-state-machine');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

async function connectMock(behavior) {
    await request(ctx.app).post('/payments/connect').set('asmara-token', token)
        .send({ provider: 'mock', terminal_id: 'mock-term-1', mock_behavior: behavior });
}

async function insertOrder(id, total) {
    await ctx.knex('orders').insert({
        id, tenant_id: 1, tables: '1', status: 'ongoing', payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }), total, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
}

test('a successful charge creates a succeeded attempt AND records exactly one real ledger charge', async () => {
    await connectMock('succeed');
    await insertOrder('order-pay-1', 25);

    const res = await request(ctx.app).post('/payments/charge').set('asmara-token', token)
        .send({ order_id: 'order-pay-1', amount: 25 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, true);
    assert.equal(res.body.attempt.status, 'succeeded');
    assert.ok(res.body.attempt.ledger_transaction_id, 'a succeeded attempt must be linked to the ledger row it created');

    const attemptRow = await ctx.knex('payment_attempts').where({ id: res.body.attempt.id }).first();
    assert.equal(attemptRow.status, 'succeeded');
    assert.ok(attemptRow.provider_payment_id);

    const ledgerRows = await ctx.knex('payment_transactions').where({ tenant_id: 1, order_id: 'order-pay-1' });
    assert.equal(ledgerRows.length, 1, 'the terminal charge must actually reach the real ledger, not just be relayed to the caller');
    assert.equal(Number(ledgerRows[0].amount), 25);
    assert.equal(ledgerRows[0].provider_reference, attemptRow.provider_payment_id);
});

test('a declined charge is recorded as failed and never touches the ledger', async () => {
    await connectMock('decline');
    await insertOrder('order-pay-2', 10);

    const res = await request(ctx.app).post('/payments/charge').set('asmara-token', token)
        .send({ order_id: 'order-pay-2', amount: 10 });
    assert.equal(res.status, 502);
    assert.equal(res.body.status, false);
    assert.equal(res.body.attempt.status, 'failed');
    assert.match(res.body.attempt.error_message, /declined/i);

    const ledgerRows = await ctx.knex('payment_transactions').where({ tenant_id: 1, order_id: 'order-pay-2' });
    assert.equal(ledgerRows.length, 0, 'a declined charge must never create a ledger row');
});

test('a payment that resolves asynchronously is left "pending" and only recorded once reconciled', async () => {
    await connectMock('pending');
    await insertOrder('order-pay-3', 15);

    const chargeRes = await request(ctx.app).post('/payments/charge').set('asmara-token', token)
        .send({ order_id: 'order-pay-3', amount: 15 });
    assert.equal(chargeRes.status, 200, JSON.stringify(chargeRes.body));
    assert.equal(chargeRes.body.attempt.status, 'pending');

    let ledgerRows = await ctx.knex('payment_transactions').where({ tenant_id: 1, order_id: 'order-pay-3' });
    assert.equal(ledgerRows.length, 0, 'a still-pending payment must not be recorded as a real charge yet');

    const attemptId = chargeRes.body.attempt.id;
    const reconcileRes = await request(ctx.app).post(`/payments/attempts/${attemptId}/reconcile`).set('asmara-token', token).send({});
    assert.equal(reconcileRes.status, 200, JSON.stringify(reconcileRes.body));
    assert.equal(reconcileRes.body.attempt.status, 'succeeded');

    ledgerRows = await ctx.knex('payment_transactions').where({ tenant_id: 1, order_id: 'order-pay-3' });
    assert.equal(ledgerRows.length, 1, 'reconciling a now-captured payment must record exactly one ledger charge');
});

test('reconciling an already-finalized attempt is a safe no-op (never double-charges the ledger)', async () => {
    await connectMock('succeed');
    await insertOrder('order-pay-4', 8);

    const chargeRes = await request(ctx.app).post('/payments/charge').set('asmara-token', token)
        .send({ order_id: 'order-pay-4', amount: 8 });
    const attemptId = chargeRes.body.attempt.id;

    await request(ctx.app).post(`/payments/attempts/${attemptId}/reconcile`).set('asmara-token', token).send({});
    await request(ctx.app).post(`/payments/attempts/${attemptId}/reconcile`).set('asmara-token', token).send({});

    const ledgerRows = await ctx.knex('payment_transactions').where({ tenant_id: 1, order_id: 'order-pay-4' });
    assert.equal(ledgerRows.length, 1, 'reconciling an already-succeeded attempt (even repeatedly) must never create a second ledger row');
});

test('a request that fails before the provider ever returns a payment id cannot be reconciled (the documented limit) but is recorded as failed', async () => {
    await connectMock('timeout');
    await insertOrder('order-pay-5', 12);

    const chargeRes = await request(ctx.app).post('/payments/charge').set('asmara-token', token)
        .send({ order_id: 'order-pay-5', amount: 12 });
    assert.equal(chargeRes.status, 502);
    assert.equal(chargeRes.body.attempt.status, 'failed');
    assert.equal(chargeRes.body.attempt.provider_payment_id, null);

    const reconcileRes = await request(ctx.app)
        .post(`/payments/attempts/${chargeRes.body.attempt.id}/reconcile`)
        .set('asmara-token', token).send({});
    // Already 'failed' -- reconcile()'s early-return path, not the "no provider id" error path.
    assert.equal(reconcileRes.status, 200);
    assert.equal(reconcileRes.body.attempt.status, 'failed');
});

test('GET /payments/attempts lists attempts and can filter by status', async () => {
    await connectMock('succeed');
    await insertOrder('order-pay-6', 5);
    await request(ctx.app).post('/payments/charge').set('asmara-token', token).send({ order_id: 'order-pay-6', amount: 5 });

    await connectMock('decline');
    await insertOrder('order-pay-7', 6);
    await request(ctx.app).post('/payments/charge').set('asmara-token', token).send({ order_id: 'order-pay-7', amount: 6 });

    const failedRes = await request(ctx.app).get('/payments/attempts?status=failed').set('asmara-token', token);
    assert.equal(failedRes.status, 200);
    assert.ok(failedRes.body.attempts.every((a) => a.status === 'failed'));
    assert.ok(failedRes.body.attempts.some((a) => a.order_id === 'order-pay-7'));

    const forOrderRes = await request(ctx.app).get('/payments/attempts?order_id=order-pay-6').set('asmara-token', token);
    assert.equal(forOrderRes.body.attempts.length, 1);
    assert.equal(forOrderRes.body.attempts[0].status, 'succeeded');
});

test('a genuinely concurrent double-tap of "Charge" (same idempotency_key) only ever creates one attempt and one ledger charge', async () => {
    await connectMock('succeed');
    await insertOrder('order-pay-8', 30);
    const key = 'charge-race-key-1';

    const [a, b] = await Promise.all([
        request(ctx.app).post('/payments/charge').set('asmara-token', token).send({ order_id: 'order-pay-8', amount: 30, idempotency_key: key }),
        request(ctx.app).post('/payments/charge').set('asmara-token', token).send({ order_id: 'order-pay-8', amount: 30, idempotency_key: key }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.ok(statuses.includes(200), `expected one request to succeed, got ${JSON.stringify(statuses)}`);

    const attemptRows = await ctx.knex('payment_attempts').where({ tenant_id: 1, order_id: 'order-pay-8' });
    assert.equal(attemptRows.length, 1, 'a double-tapped charge (same idempotency_key) must only ever create ONE terminal-charge attempt');

    const ledgerRows = await ctx.knex('payment_transactions').where({ tenant_id: 1, order_id: 'order-pay-8' });
    assert.equal(ledgerRows.length, 1, 'and therefore only ever one real ledger charge');
});
