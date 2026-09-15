const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx, token;
before(async () => {
    ctx = await setupTestApp('table-transfer');
    token = await loginAsAdmin(request, ctx.app);
});
after(async () => { await teardownTestApp(ctx); });

test('rejects a transfer with a merged (1+2) source table', async () => {
    const res = await request(ctx.app).post('/tables/transfer').set('asmara-token', token)
        .send({ from_table: '1+2', to_table: '3' });
    assert.equal(res.status, 400);
    assert.equal(res.body.status, false);
});

test('rejects a transfer from a table with no active order', async () => {
    const res = await request(ctx.app).post('/tables/transfer').set('asmara-token', token)
        .send({ from_table: '2', to_table: '1' }); // table 2 has no seeded order
    assert.equal(res.status, 404);
});

test('moves the active order from an occupied table to a free one, and updates both tables', async () => {
    const res = await request(ctx.app).post('/tables/transfer').set('asmara-token', token)
        .send({ from_table: '3', to_table: '1' });
    assert.equal(res.status, 200);
    assert.equal(res.body.order.tables, '1');

    const tablesRes = await request(ctx.app).get('/tables/').set('asmara-token', token);
    const byNumber = Object.fromEntries(tablesRes.body.tables.map(t => [t.table_number, t.status]));
    assert.equal(byNumber['1'], 'occupied', 'destination table should now be occupied');
    assert.equal(byNumber['3'], 'free', 'source table should now be free');
});

test('a second transfer onto the now-occupied table 1 is rejected (409, destination not free)', async () => {
    const res = await request(ctx.app).post('/tables/transfer').set('asmara-token', token)
        .send({ from_table: '2', to_table: '1' });
    // The route checks source-exists -> destination-exists -> destination-is-free -> active-
    // order-exists, in that order. Table 1 is occupied at this point (from the prior test),
    // so this correctly fails on the destination-not-free check (409) before ever getting to
    // check whether table 2 has an active order at all.
    assert.equal(res.status, 409);
});
