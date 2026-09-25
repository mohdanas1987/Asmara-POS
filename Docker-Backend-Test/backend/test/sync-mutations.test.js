'use strict';
/**
 * Generic bidirectional sync-mutation engine (ChatGPT CTO review, "Asmara POS -- Remaining
 * Work Only", multi-terminal sync: POST /sync/push, the {mutation_id, accepted, server_version,
 * cursor} ACK contract, duplicate-replay protection ("apply once, ACK five times"),
 * restart-safe retry, delete/tombstone propagation, durable cursor persistence, and real
 * multi-terminal convergence). See services/offline/syncMutations.js for the per-entity-type
 * policy this dispatches to.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('sync-mutations');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

function push(terminalId, mutations) {
    return request(ctx.app).post('/sync/push').set('asmara-token', token).send({ terminal_id: terminalId, mutations });
}

test('a table_layout mutation is applied and returns the full {mutation_id, accepted, server_version, cursor} ACK', async () => {
    await ctx.knex('tables').insert({ table_number: 'layout-1', status: 'free', x: 0, y: 0, length: 80, width: 80 });
    const table = await ctx.knex('tables').where({ table_number: 'layout-1' }).first();

    const res = await push('terminal-A', [
        { mutation_id: 'm1', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 150, y: 220 }, base_version: 1 },
    ]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const ack = res.body.results[0];
    assert.equal(ack.mutation_id, 'm1');
    assert.equal(ack.accepted, true);
    assert.equal(ack.server_version, 2);
    assert.ok(typeof ack.cursor === 'number' && ack.cursor > 0);

    const updated = await ctx.knex('tables').where({ id: table.id }).first();
    assert.equal(updated.x, 150);
    assert.equal(updated.y, 220);
    assert.equal(updated.version, 2);
});

test('apply once, ACK five times: pushing the exact same mutation_id five times only applies it once', async () => {
    await ctx.knex('tables').insert({ table_number: 'layout-2', status: 'free', x: 0, y: 0, length: 80, width: 80 });
    const table = await ctx.knex('tables').where({ table_number: 'layout-2' }).first();

    const mutation = { mutation_id: 'replay-me', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 99 }, base_version: 1 };
    const acks = [];
    for (let i = 0; i < 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await push('terminal-A', [mutation]);
        acks.push(res.body.results[0]);
    }

    for (const ack of acks) {
        assert.equal(ack.accepted, true);
        assert.equal(ack.server_version, 2, 'every replay must report the SAME resulting version -- it was never re-applied');
    }

    const updated = await ctx.knex('tables').where({ id: table.id }).first();
    assert.equal(updated.version, 2, 'five pushes of the same mutation_id must only ever increment the version once');

    const rows = await ctx.knex('sync_mutations').where({ tenant_id: 1, terminal_id: 'terminal-A', mutation_id: 'replay-me' });
    assert.equal(rows.length, 1, 'only one sync_mutations row must exist no matter how many times the same mutation is replayed');
});

test('restart-safe retry: a push after the "server restarts" (a fresh request, no in-memory state) still returns the original ACK, not a re-apply', async () => {
    await ctx.knex('tables').insert({ table_number: 'layout-3', status: 'free', x: 0, y: 0, length: 80, width: 80 });
    const table = await ctx.knex('tables').where({ table_number: 'layout-3' }).first();

    const first = await push('terminal-A', [{ mutation_id: 'restart-1', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 10 }, base_version: 1 }]);
    assert.equal(first.body.results[0].server_version, 2);

    // Nothing lives in process memory across requests in this app (every handler reads/writes
    // straight from the database) -- so simply issuing the retry AS A NEW REQUEST already
    // proves this survives a real process restart, since there is no cache to have warmed.
    const retry = await push('terminal-A', [{ mutation_id: 'restart-1', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 10 }, base_version: 1 }]);
    assert.equal(retry.body.results[0].server_version, 2);
    assert.equal(retry.body.results[0].accepted, true);

    const updated = await ctx.knex('tables').where({ id: table.id }).first();
    assert.equal(updated.version, 2);
});

test('two terminals racing on the SAME table_layout entity converge: the stale one is rejected with the real current version so it can rebase and retry successfully', async () => {
    await ctx.knex('tables').insert({ table_number: 'layout-4', status: 'free', x: 0, y: 0, length: 80, width: 80 });
    const table = await ctx.knex('tables').where({ table_number: 'layout-4' }).first();

    const winner = await push('terminal-A', [{ mutation_id: 'race-a', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 5 }, base_version: 1 }]);
    assert.equal(winner.body.results[0].accepted, true);
    assert.equal(winner.body.results[0].server_version, 2);

    // terminal-B queued its own edit offline against the ORIGINAL base_version (1) -- it has
    // no idea terminal-A already moved this table. It must be rejected, not silently clobber
    // terminal-A's change with a blind last-write-wins.
    const loser = await push('terminal-B', [{ mutation_id: 'race-b', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 999 }, base_version: 1 }]);
    assert.equal(loser.body.results[0].accepted, false);
    assert.equal(loser.body.results[0].reason, 'stale_base_version');
    assert.equal(loser.body.results[0].server_version, 2, 'the rejection must hand back the REAL current version so the loser can rebase');

    const conflicts = await ctx.knex('sync_conflicts').where({ tenant_id: 1, entity_type: 'table_layout', entity_id: String(table.id) });
    assert.equal(conflicts.length, 1);

    // terminal-B rebases (re-reads current state, gets version 2) and retries with the
    // correct base_version -- this is what makes the two terminals actually CONVERGE instead
    // of diverging forever.
    const rebasedRetry = await push('terminal-B', [{ mutation_id: 'race-b-retry', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 999 }, base_version: 2 }]);
    assert.equal(rebasedRetry.body.results[0].accepted, true);
    assert.equal(rebasedRetry.body.results[0].server_version, 3);

    const finalRow = await ctx.knex('tables').where({ id: table.id }).first();
    assert.equal(finalRow.x, 999);
    assert.equal(finalRow.version, 3);
});

test('a menu_item delete mutation is a real tombstone -- soft-deleted, propagated, not silently ignored', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Tombstone Special', price: '9.00', pos: true, deleted: false, version: 1 });

    const res = await push('terminal-A', [{ mutation_id: 'del-1', entity_type: 'menu_item', entity_id: itemId, operation: 'delete', base_version: 1 }]);
    assert.equal(res.body.results[0].accepted, true);
    assert.equal(res.body.results[0].server_version, 2);

    const row = await ctx.knex('menu_items').where({ id: itemId }).first();
    assert.equal(!!row.deleted, true);

    const changes = await request(ctx.app).get('/sync/changes?since=0').set('asmara-token', token);
    const tombstoneChange = changes.body.changes.find((c) => c.entity_type === 'menu_item' && String(c.entity_id) === String(itemId));
    assert.ok(tombstoneChange, 'the delete must propagate through sync_log so other terminals see it');
    assert.equal(tombstoneChange.operation, 'delete');
    assert.equal(tombstoneChange.payload.deleted, true);
});

test('entity types with their own dedicated conflict strategy (order, payment, loyalty, table_claim) are explicitly refused by the generic push path, never silently mis-applied', async () => {
    const order = await ctx.knex('orders').insert({ id: 'sync-push-order-1', tenant_id: 1, tables: '95', status: 'ongoing', version: 1 });
    void order;

    for (const entityType of ['order', 'payment', 'loyalty', 'table_claim']) {
        // eslint-disable-next-line no-await-in-loop
        const res = await push('terminal-A', [{ mutation_id: `refuse-${entityType}`, entity_type: entityType, entity_id: 'sync-push-order-1', operation: 'update', payload: { anything: true }, base_version: 1 }]);
        const ack = res.body.results[0];
        assert.equal(ack.accepted, false, `${entityType} must never be silently accepted by the generic engine`);
        assert.equal(ack.reason, 'unsupported_entity_type');
    }

    // And the order itself must be completely untouched -- refusing must never partially apply.
    const untouched = await ctx.knex('orders').where({ id: 'sync-push-order-1' }).first();
    assert.equal(untouched.version, 1);
});

test('durable cursor persistence: GET /sync/changes with no "since" resumes from the server-remembered cursor for that terminal_id', async () => {
    await ctx.knex('tables').insert({ table_number: 'cursor-1', status: 'free', x: 0, y: 0, length: 80, width: 80 });
    const table = await ctx.knex('tables').where({ table_number: 'cursor-1' }).first();

    const firstPull = await request(ctx.app).get('/sync/changes').query({ terminal_id: 'cursor-terminal', since: 0 }).set('asmara-token', token);
    assert.equal(firstPull.status, 200);
    const cursorAfterFirstPull = firstPull.body.cursor;

    await push('some-other-terminal', [{ mutation_id: 'cursor-mut-1', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 42 }, base_version: 1 }]);

    // No `since` at all this time -- simulating a terminal that lost its local cursor state
    // entirely and is relying purely on the server remembering where it left off.
    const resumed = await request(ctx.app).get('/sync/changes').query({ terminal_id: 'cursor-terminal' }).set('asmara-token', token);
    assert.equal(resumed.status, 200);
    assert.ok(resumed.body.cursor > cursorAfterFirstPull, 'resuming from the durable cursor must pick up changes made after the last pull');
    const found = resumed.body.changes.find((c) => c.entity_type === 'table_layout' && String(c.entity_id) === String(table.id));
    assert.ok(found, 'the change made after the first pull must be present when resuming from the durable server-side cursor');

    const cursorRow = await ctx.knex('terminal_cursors').where({ tenant_id: 1, terminal_id: 'cursor-terminal' }).first();
    assert.ok(cursorRow, 'the cursor must actually be persisted, not just computed in-memory');
    assert.equal(cursorRow.cursor, resumed.body.cursor);
});

test('a role without the entity-appropriate permission is forbidden from pushing that mutation (per-entity-type RBAC, not a blanket route gate)', async () => {
    await ctx.knex('tables').insert({ table_number: 'layout-6', status: 'free', x: 0, y: 0, length: 80, width: 80 });
    const table = await ctx.knex('tables').where({ table_number: 'layout-6' }).first();
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Perm Test Item', price: '5.00', pos: true, deleted: false, version: 1 });

    const waiterToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'sync-push-waiter@test.local', role: 'waiter' });
    const waiterPush = (mutations) => request(ctx.app).post('/sync/push').set('asmara-token', waiterToken).send({ terminal_id: 'waiter-terminal', mutations });

    const res = await waiterPush([
        { mutation_id: 'forbidden-layout', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 1 }, base_version: 1 },
        { mutation_id: 'forbidden-menu', entity_type: 'menu_item', entity_id: itemId, operation: 'update', payload: { price: '1.00' }, base_version: 1 },
    ]);
    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].accepted, false);
    assert.equal(res.body.results[0].reason, 'forbidden');
    assert.equal(res.body.results[1].accepted, false);
    assert.equal(res.body.results[1].reason, 'forbidden');

    const untouchedTable = await ctx.knex('tables').where({ id: table.id }).first();
    assert.equal(untouchedTable.version, 1);
    const untouchedItem = await ctx.knex('menu_items').where({ id: itemId }).first();
    assert.equal(untouchedItem.version, 1);
});

test('multi-terminal convergence: two terminals queue mutations offline for DIFFERENT entities, both flush on reconnect, and a third terminal pulling changes converges to the identical final state', async () => {
    await ctx.knex('tables').insert({ table_number: 'converge-1', status: 'free', x: 0, y: 0, length: 80, width: 80 });
    const table = await ctx.knex('tables').where({ table_number: 'converge-1' }).first();
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Converge Item', price: '3.00', pos: true, deleted: false, version: 1 });

    // Terminal A and Terminal B were BOTH offline and each queued its own independent edit --
    // A moved the table, B repriced the menu item. Neither terminal has any idea what the
    // other did. They reconnect and flush their outboxes in whatever order the network gives.
    const [ackA, ackB] = await Promise.all([
        push('terminal-A', [{ mutation_id: 'converge-a-1', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 321, y: 44 }, base_version: 1 }]),
        push('terminal-B', [{ mutation_id: 'converge-b-1', entity_type: 'menu_item', entity_id: itemId, operation: 'update', payload: { price: '4.50' }, base_version: 1 }]),
    ]);
    assert.equal(ackA.body.results[0].accepted, true);
    assert.equal(ackB.body.results[0].accepted, true);

    // A third terminal, C, was also offline throughout and never saw either change directly --
    // it only learns about them by pulling the change feed once it's back online. Real
    // convergence means C ends up seeing BOTH independent changes, in a stable order, and
    // applying them would leave it in the exact same state as the server.
    const pulledByC = await request(ctx.app).get('/sync/changes').query({ terminal_id: 'terminal-C', since: 0 }).set('asmara-token', token);
    assert.equal(pulledByC.status, 200);
    const layoutChange = pulledByC.body.changes.find((c) => c.entity_type === 'table_layout' && String(c.entity_id) === String(table.id));
    const menuChange = pulledByC.body.changes.find((c) => c.entity_type === 'menu_item' && String(c.entity_id) === String(itemId));
    assert.ok(layoutChange, 'terminal C must be able to see terminal A\'s change through the shared change feed');
    assert.ok(menuChange, 'terminal C must be able to see terminal B\'s change through the shared change feed');
    assert.equal(layoutChange.payload.x, 321);
    assert.equal(menuChange.payload.price, '4.50');

    // The server's own row state is the ground truth both terminals must converge to.
    const finalTable = await ctx.knex('tables').where({ id: table.id }).first();
    const finalItem = await ctx.knex('menu_items').where({ id: itemId }).first();
    assert.equal(finalTable.x, 321);
    assert.equal(finalTable.y, 44);
    assert.equal(finalItem.price, '4.50');
});

test('a malformed mutation in a batch is rejected individually without failing the whole batch', async () => {
    await ctx.knex('tables').insert({ table_number: 'layout-5', status: 'free', x: 0, y: 0, length: 80, width: 80 });
    const table = await ctx.knex('tables').where({ table_number: 'layout-5' }).first();

    const res = await push('terminal-A', [
        { mutation_id: 'good-1', entity_type: 'table_layout', entity_id: table.id, operation: 'update', payload: { x: 7 }, base_version: 1 },
        { entity_type: 'table_layout' }, // missing mutation_id/entity_id/operation
    ]);
    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].accepted, true);
    assert.equal(res.body.results[1].accepted, false);
    assert.equal(res.body.results[1].reason, 'malformed_mutation');
});
