'use strict';
/**
 * Course firing (CTO forensic audit 2026-09-20, task "Courses" -- flagged as never built,
 * correctly: no test, no route, no schema for it existed before this file). Covers the
 * hold/fire lifecycle directly against services/courseRouting.js, plus the real HTTP
 * surface (POST /orders/to-kitchen holding a later course, GET /kitchen/held-courses,
 * POST /kitchen/fire-course) and the Preservation Contract that an item with no course set
 * behaves exactly as it always has.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');
const { sendItemsRespectingCourses, getHeldCourses, fireCourse } = require('../services/courseRouting');

let ctx;
let token;

before(async () => {
    ctx = await setupTestApp('courses');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
});

test('an item with no course set fires immediately, exactly as before this feature existed', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Plain Fries', price: 4, tenant_id: 1, category_id: 1, seq: 10 });
    const tickets = await sendItemsRespectingCourses({
        tenantId: 1, orderId: 'order-no-course', tableNumber: '1', items: [{ id: itemId, quantity: 1 }],
    });
    assert.equal(tickets.length, 1);
    const held = await ctx.knex('held_course_items').where({ tenant_id: 1, order_id: 'order-no-course' });
    assert.equal(held.length, 0);
});

test("an item explicitly marked 'starter' also fires immediately", async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Soup', price: 6, tenant_id: 1, category_id: 1, seq: 11, course: 'starter' });
    const tickets = await sendItemsRespectingCourses({
        tenantId: 1, orderId: 'order-starter', tableNumber: '1', items: [{ id: itemId, quantity: 2 }],
    });
    assert.equal(tickets.length, 1);
});

test("a 'main' course item is held, not routed, until fired", async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Steak', price: 22, tenant_id: 1, category_id: 1, seq: 12, course: 'main' });
    const tickets = await sendItemsRespectingCourses({
        tenantId: 1, orderId: 'order-held-main', tableNumber: '2', items: [{ id: itemId, quantity: 1 }],
    });
    assert.equal(tickets.length, 0, 'a held course must not create a kitchen ticket yet');

    const held = await getHeldCourses({ tenantId: 1, orderId: 'order-held-main' });
    assert.equal(held.length, 1);
    assert.equal(held[0].course, 'main');
    assert.deepEqual(held[0].items, [{ id: itemId, quantity: 1 }]);
});

test('firing a held course moves it into a real kitchen ticket and clears it from held state', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Dessert Cake', price: 8, tenant_id: 1, category_id: 1, seq: 13, course: 'dessert' });
    await sendItemsRespectingCourses({ tenantId: 1, orderId: 'seed_order_001', tableNumber: '3', items: [{ id: itemId, quantity: 1 }] });

    let held = await getHeldCourses({ tenantId: 1, orderId: 'seed_order_001' });
    assert.equal(held.length, 1);

    const { tickets, firedItemCount } = await fireCourse({ tenantId: 1, orderId: 'seed_order_001', course: 'dessert' });
    assert.equal(firedItemCount, 1);
    assert.equal(tickets.length, 1);
    assert.deepEqual(JSON.parse(tickets[0].items), [{ id: itemId, quantity: 1 }]);

    held = await getHeldCourses({ tenantId: 1, orderId: 'seed_order_001' });
    assert.equal(held.length, 0, 'a fired course must no longer show as held');
});

test('firing a course a second time is a no-op, not a duplicate ticket', async () => {
    const result = await fireCourse({ tenantId: 1, orderId: 'seed_order_001', course: 'dessert' });
    assert.equal(result.firedItemCount, 0);
    assert.equal(result.tickets.length, 0);
});

test('a second tenant never sees or fires the first tenant\'s held courses', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'Tenant2 Main', price: 15, tenant_id: 2, category_id: 1, seq: 1, course: 'main' });
    await sendItemsRespectingCourses({ tenantId: 2, orderId: 'order-tenant2', tableNumber: '1', items: [{ id: itemId, quantity: 1 }] });

    const tenant1View = await getHeldCourses({ tenantId: 1, orderId: 'order-tenant2' });
    assert.equal(tenant1View.length, 0);

    const crossTenantFire = await fireCourse({ tenantId: 1, orderId: 'order-tenant2', course: 'main' });
    assert.equal(crossTenantFire.firedItemCount, 0, 'tenant 1 must not be able to fire tenant 2\'s held course');
});

test('POST /kitchen/fire-course requires tables.manage, and fires via the real HTTP surface', async () => {
    const [itemId] = await ctx.knex('menu_items').insert({ name: 'HTTP Main', price: 18, tenant_id: 1, category_id: 1, seq: 14, course: 'main' });
    await sendItemsRespectingCourses({ tenantId: 1, orderId: 'order-http-fire', tableNumber: '1', items: [{ id: itemId, quantity: 1 }] });

    const heldRes = await request(ctx.app).get('/kitchen/held-courses/order-http-fire').set('asmara-token', token);
    assert.equal(heldRes.status, 200);
    assert.equal(heldRes.body.held.length, 1);

    const fireRes = await request(ctx.app)
        .post('/kitchen/fire-course')
        .set('asmara-token', token)
        .send({ order_id: 'order-http-fire', course: 'main' });
    assert.equal(fireRes.status, 200);
    assert.equal(fireRes.body.status, true);
});
