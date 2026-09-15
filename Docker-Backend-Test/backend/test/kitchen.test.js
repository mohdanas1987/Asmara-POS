/**
 * Kitchen Display support: accepting an order (ongoing/whatever -> in-kitchen) and marking
 * it prepared (-> completed, freeing any table). Deliberately separate, minimal routes from
 * /to-kitchen and /finish -- see the comment above them in routes/orders.js for why reusing
 * those would have been unsafe here (data clobbering / crashing on a null table).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('kitchen');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('accepting an online (tableless) order moves it to in-kitchen without touching its data', async () => {
    const [orderId] = await ctx.knex('orders').insert({
        id: 'test-online-1',
        tenant_id: 1,
        source: 'online',
        tables: null,
        status: 'ongoing',
        payment_status: 'pending',
        total: 12.5,
        data: JSON.stringify({ items: [{ id: 1, qty: 2 }], customer_name: 'Alex' }),
        note: 'Online order from Alex',
    });

    const res = await request(ctx.app).post('/orders/accept/test-online-1').set('asmara-token', token);
    assert.equal(res.body.status, true);
    assert.equal(res.body.order.status, 'in-kitchen');
    // The original items/customer_name payload must survive untouched.
    const stored = JSON.parse(res.body.order.data);
    assert.deepEqual(stored.items, [{ id: 1, qty: 2 }]);
    assert.equal(stored.customer_name, 'Alex');
});

test('marking a tableless order prepared completes it without crashing on a null table', async () => {
    await ctx.knex('orders').insert({
        id: 'test-online-2',
        tenant_id: 1,
        source: 'online',
        tables: null,
        status: 'in-kitchen',
        payment_status: 'paid',
        total: 8,
        data: JSON.stringify({ items: [] }),
    });

    const res = await request(ctx.app).post('/orders/prepared/test-online-2').set('asmara-token', token);
    assert.equal(res.body.status, true);
    assert.equal(res.body.order.status, 'completed');
});

test('marking a real table order prepared frees the table', async () => {
    await ctx.knex('orders').insert({
        id: 'test-pos-1',
        tenant_id: 1,
        source: 'pos',
        tables: '1',
        status: 'in-kitchen',
        payment_status: 'paid',
        total: 20,
        data: JSON.stringify({ quantity: { 1: 2 } }),
    });
    await ctx.knex('tables').where({ table_number: '1', tenant_id: 1 }).update({ status: 'occupied' });

    const res = await request(ctx.app).post('/orders/prepared/test-pos-1').set('asmara-token', token);
    assert.equal(res.body.status, true);

    const table = await ctx.knex('tables').where({ table_number: '1', tenant_id: 1 }).first();
    assert.equal(table.status, 'free');
});

test('accepting/preparing an order from another tenant is refused', async () => {
    await ctx.knex('tenants').insert({ id: 99, name: 'Other', slug: 'other', status: true }).onConflict('id').ignore();
    await ctx.knex('orders').insert({
        id: 'test-foreign-1',
        tenant_id: 99,
        source: 'online',
        tables: null,
        status: 'ongoing',
        payment_status: 'pending',
        total: 5,
        data: JSON.stringify({}),
    });

    const res = await request(ctx.app).post('/orders/accept/test-foreign-1').set('asmara-token', token);
    assert.equal(res.body.status, false);
});
