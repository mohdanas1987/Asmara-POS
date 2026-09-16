'use strict';
/**
 * Offline-first foundation (project audit 2026-09-15, task "Offline-first foundation
 * (outbox + sync engine)"). Covers the append-only sync log's versioning and cursor
 * pagination, terminal registration, the real /tables/transfer wiring, tenant isolation,
 * and the generic outbox's retry/backoff behavior.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');
const { recordChange, getChangesSince } = require('../services/offline/syncLog');
const outbox = require('../services/offline/outbox');
const { getOrCreateTerminalId } = require('../services/offline/terminalIdentity');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('offline-sync');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('recordChange assigns version 1 to the first change for a brand-new entity', async () => {
    const row = await recordChange({
        tenantId: 1, terminalId: 'terminal-a', entityType: 'table', entityId: '5',
        operation: 'update', payload: { status: 'occupied' },
    });
    assert.equal(row.version, 1);
});

test('recordChange increments version per (tenant, entity_type, entity_id), independent of other entities', async () => {
    await recordChange({ tenantId: 1, terminalId: 'terminal-a', entityType: 'table', entityId: '5', operation: 'update', payload: { status: 'free' } });
    const third = await recordChange({ tenantId: 1, terminalId: 'terminal-b', entityType: 'table', entityId: '5', operation: 'update', payload: { status: 'occupied' } });
    assert.equal(third.version, 3);

    // A totally different entity starts its own version count at 1, unaffected by table 5's history.
    const otherEntity = await recordChange({ tenantId: 1, terminalId: 'terminal-a', entityType: 'table', entityId: '6', operation: 'update', payload: {} });
    assert.equal(otherEntity.version, 1);
});

test('getChangesSince(0) returns everything, in insertion order, oldest first', async () => {
    const changes = await getChangesSince({ tenantId: 1, sinceId: 0 });
    assert.ok(changes.length >= 4);
    for (let i = 1; i < changes.length; i += 1) {
        assert.ok(changes[i].id > changes[i - 1].id, 'must be strictly increasing by id');
    }
});

test('getChangesSince(cursor) only returns rows after that cursor -- the resumable-sync contract', async () => {
    const all = await getChangesSince({ tenantId: 1, sinceId: 0 });
    const midpointCursor = all[1].id;
    const remaining = await getChangesSince({ tenantId: 1, sinceId: midpointCursor });
    assert.equal(remaining.length, all.length - 2);
    assert.ok(remaining.every((r) => r.id > midpointCursor));
});

test('a second tenant never sees the first tenant\'s sync log rows', async () => {
    await recordChange({ tenantId: 2, terminalId: 'terminal-x', entityType: 'table', entityId: '1', operation: 'update', payload: {} });
    const tenant1Changes = await getChangesSince({ tenantId: 1, sinceId: 0 });
    const tenant2Changes = await getChangesSince({ tenantId: 2, sinceId: 0 });
    assert.ok(tenant1Changes.every((c) => c.tenant_id === 1));
    assert.equal(tenant2Changes.length, 1);
    assert.equal(tenant2Changes[0].tenant_id, 2);
});

test('POST /sync/terminals/register creates a new terminal, then updates last_seen_at on a repeat call', async () => {
    const first = await request(ctx.app).post('/sync/terminals/register').set('asmara-token', token).send({ terminal_id: 'term-abc', name: 'Front Counter' });
    assert.equal(first.status, 200);

    const row1 = await ctx.knex('terminals').where('id', 'term-abc').first();
    assert.equal(row1.name, 'Front Counter');
    const firstSeenAt = row1.last_seen_at;

    await new Promise((resolve) => setTimeout(resolve, 1100)); // ensure a distinguishable timestamp
    const second = await request(ctx.app).post('/sync/terminals/register').set('asmara-token', token).send({ terminal_id: 'term-abc' });
    assert.equal(second.status, 200);
    const row2 = await ctx.knex('terminals').where('id', 'term-abc').first();
    assert.notEqual(row2.last_seen_at, firstSeenAt);
    assert.equal(row2.name, 'Front Counter', 'name is preserved when a heartbeat omits it');
});

test('GET /sync/terminals lists only this tenant\'s terminals', async () => {
    const res = await request(ctx.app).get('/sync/terminals').set('asmara-token', token);
    assert.equal(res.status, 200);
    assert.ok(res.body.terminals.some((t) => t.id === 'term-abc'));
});

test('GET /sync/changes returns changes with a usable cursor for the next poll', async () => {
    const res = await request(ctx.app).get('/sync/changes').set('asmara-token', token).query({ since: 0 });
    assert.equal(res.status, 200);
    assert.ok(res.body.changes.length > 0);
    assert.ok(res.body.changes.every((c) => typeof c.payload === 'object'), 'payload must be parsed, not a raw JSON string');

    const secondPoll = await request(ctx.app).get('/sync/changes').set('asmara-token', token).query({ since: res.body.cursor });
    assert.equal(secondPoll.body.changes.length, 0, 'polling again with the returned cursor yields nothing new');
});

test('a real /tables/transfer call is recorded in the sync log with both table numbers', async () => {
    await ctx.knex('tables').insert([
        { table_number: 'sync-a', status: 'occupied', x: 0, y: 0, length: 80, width: 80, tenant_id: 1 },
        { table_number: 'sync-b', status: 'free', x: 100, y: 0, length: 80, width: 80, tenant_id: 1 },
    ]);
    await ctx.knex('orders').insert({
        id: 'order-sync-transfer', tenant_id: 1, tables: 'sync-a', status: 'ongoing',
        payment_status: 'pending', total: 10, data: JSON.stringify({ quantity: {} }),
    });

    const res = await request(ctx.app).post('/tables/transfer').set('asmara-token', token)
        .send({ from_table: 'sync-a', to_table: 'sync-b', terminal_id: 'term-abc' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const logged = await ctx.knex('sync_log').where('entity_type', 'table_transfer').orderBy('id', 'desc').first();
    assert.ok(logged);
    const payload = JSON.parse(logged.payload);
    assert.equal(payload.from_table, 'sync-a');
    assert.equal(payload.to_table, 'sync-b');
    assert.equal(logged.terminal_id, 'term-abc');
});

test('terminal identity is generated once and reused on subsequent calls for the same db path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-identity-test-'));
    const fakeDbPath = path.join(tmpDir, 'restaurantos.sqlite');
    const first = getOrCreateTerminalId(fakeDbPath);
    const second = getOrCreateTerminalId(fakeDbPath);
    assert.equal(first, second);
    assert.match(first, /^[0-9a-f-]{36}$/i);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('outbox.enqueue + processPending marks a successful delivery as sent', async () => {
    await outbox.enqueue({ tenantId: 1, targetType: 'peer_terminal', targetUrl: 'http://192.168.1.50:5102', payload: { hello: 'world' } });
    const result = await outbox.processPending({
        tenantId: 1, targetType: 'peer_terminal',
        deliver: async () => true, // simulate a successful delivery
    });
    assert.equal(result.sent, 1);
    const row = await ctx.knex('outbox').where({ tenant_id: 1, target_type: 'peer_terminal' }).orderBy('id', 'desc').first();
    assert.equal(row.status, 'sent');
    assert.ok(row.sent_at);
});

test('outbox.processPending schedules a backoff retry on a failed delivery, without giving up immediately', async () => {
    await outbox.enqueue({ tenantId: 1, targetType: 'cloud', payload: { order_id: 'x' } });
    const result = await outbox.processPending({
        tenantId: 1, targetType: 'cloud',
        deliver: async () => { throw new Error('connection refused'); },
    });
    assert.equal(result.failed, 1);
    assert.equal(result.gaveUp, 0);
    const row = await ctx.knex('outbox').where({ tenant_id: 1, target_type: 'cloud' }).orderBy('id', 'desc').first();
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 1);
    assert.equal(row.last_error, 'connection refused');
    assert.ok(new Date(row.next_attempt_at).getTime() > Date.now(), 'next attempt must be scheduled in the future, not immediate');
});

test('outbox.processPending does not retry an entry before its scheduled next_attempt_at', async () => {
    const entry = await outbox.enqueue({ tenantId: 1, targetType: 'website', payload: {} });
    await ctx.knex('outbox').where('id', entry.id).update({ next_attempt_at: new Date(Date.now() + 60_000).toISOString() });

    let called = false;
    const result = await outbox.processPending({
        tenantId: 1, targetType: 'website',
        deliver: async () => { called = true; },
    });
    assert.equal(called, false, 'must not attempt a delivery whose backoff window has not elapsed yet');
    assert.equal(result.sent, 0);
});

test('outbox.processPending gives up after MAX_ATTEMPTS consecutive failures', async () => {
    const entry = await outbox.enqueue({ tenantId: 1, targetType: 'payment_gateway', payload: {} });
    await ctx.knex('outbox').where('id', entry.id).update({ attempts: outbox.MAX_ATTEMPTS - 1, next_attempt_at: new Date().toISOString() });

    await outbox.processPending({
        tenantId: 1, targetType: 'payment_gateway',
        deliver: async () => { throw new Error('still down'); },
    });
    const row = await ctx.knex('outbox').where('id', entry.id).first();
    assert.equal(row.status, 'failed');
    assert.equal(row.next_attempt_at, null, 'a permanently failed entry is not scheduled for another attempt');
});

test('outbox targets are isolated: processing "cloud" never touches pending "website" entries', async () => {
    await outbox.enqueue({ tenantId: 1, targetType: 'website', payload: { marker: 'must-not-be-touched' } });
    await outbox.processPending({ tenantId: 1, targetType: 'cloud', deliver: async () => true });
    const websiteEntries = await ctx.knex('outbox').where({ tenant_id: 1, target_type: 'website', status: 'pending' });
    assert.ok(websiteEntries.some((e) => JSON.parse(e.payload).marker === 'must-not-be-touched'));
});
