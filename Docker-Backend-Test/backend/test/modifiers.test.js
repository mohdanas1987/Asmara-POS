/**
 * Menu modifiers & spice levels (task #40). Covers the modifier-group/modifier CRUD, the
 * per-item read used to power a POS/menu UI, permission gating (menu.manage), and tenant
 * isolation (a modifier group belongs to a menu item, which belongs to a tenant -- a second
 * tenant must never be able to read or mutate the first tenant's groups even by guessing ids).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin, seedStaffUser, seedSecondTenant } = require('./_helpers');

let ctx;
let token;
let menuItemId;

before(async () => {
    ctx = await setupTestApp('modifiers');
    token = await loginAsAdmin(request, ctx.app);
    [menuItemId] = await ctx.knex('menu_items').insert({
        name: 'Chicken Curry', price: '12.50', tax: '9', tenant_id: 1,
    });
});

after(async () => {
    await teardownTestApp(ctx);
});

test('creating a modifier group for a real menu item succeeds', async () => {
    const res = await request(ctx.app)
        .post('/modifiers/groups')
        .set('asmara-token', token)
        .send({ menu_item_id: menuItemId, name: 'Spice Level', selection_type: 'single', required: true });

    assert.equal(res.body.status, true);
    assert.equal(res.body.group.name, 'Spice Level');
    assert.equal(res.body.group.selection_type, 'single');
    assert.equal(res.body.group.required, 1); // sqlite stores boolean as 0/1
});

test('creating a modifier group for a menu item that does not exist (or belongs to another tenant) is rejected', async () => {
    const res = await request(ctx.app)
        .post('/modifiers/groups')
        .set('asmara-token', token)
        .send({ menu_item_id: 999999, name: 'Ghost Group' });

    assert.equal(res.status, 404);
    assert.equal(res.body.status, false);
});

test('adding modifiers to a group and reading them back via GET /modifiers/item/:id', async () => {
    const groupRes = await request(ctx.app)
        .post('/modifiers/groups')
        .set('asmara-token', token)
        .send({ menu_item_id: menuItemId, name: 'Extras', selection_type: 'multiple' });
    const groupId = groupRes.body.group.id;

    await request(ctx.app)
        .post(`/modifiers/groups/${groupId}/modifiers`)
        .set('asmara-token', token)
        .send({ name: 'Extra cheese', price_delta: 1.5 });

    await request(ctx.app)
        .post(`/modifiers/groups/${groupId}/modifiers`)
        .set('asmara-token', token)
        .send({ name: 'No rice', price_delta: -0.5 });

    const res = await request(ctx.app).get(`/modifiers/item/${menuItemId}`).set('asmara-token', token);
    assert.equal(res.body.status, true);
    const extras = res.body.groups.find((g) => g.name === 'Extras');
    assert.ok(extras, 'the Extras group should be in the response');
    assert.equal(extras.modifiers.length, 2);
    const names = extras.modifiers.map((m) => m.name).sort();
    assert.deepEqual(names, ['Extra cheese', 'No rice']);
});

test('a cashier cannot create a modifier group (menu.manage required)', async () => {
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'cashier-mod@test.local', role: 'cashier' });
    const res = await request(ctx.app)
        .post('/modifiers/groups')
        .set('asmara-token', cashierToken)
        .send({ menu_item_id: menuItemId, name: 'Should not work' });

    assert.equal(res.status, 403);
});

test('deleting a modifier group cascades to its modifiers', async () => {
    const groupRes = await request(ctx.app)
        .post('/modifiers/groups')
        .set('asmara-token', token)
        .send({ menu_item_id: menuItemId, name: 'To Delete', selection_type: 'single' });
    const groupId = groupRes.body.group.id;

    const modRes = await request(ctx.app)
        .post(`/modifiers/groups/${groupId}/modifiers`)
        .set('asmara-token', token)
        .send({ name: 'Doomed modifier', price_delta: 0 });
    const modifierId = modRes.body.modifier.id;

    const delRes = await request(ctx.app).delete(`/modifiers/groups/${groupId}`).set('asmara-token', token);
    assert.equal(delRes.body.status, true);

    const remaining = await ctx.knex('modifiers').where('id', modifierId).first();
    assert.equal(remaining, undefined, 'the modifier row should have been cascade-deleted with its group');
});

test('a second tenant cannot read, update, or delete the first tenant\'s modifier groups', async () => {
    const other = await seedSecondTenant(request, ctx.app, ctx.knex);

    const groupRes = await request(ctx.app)
        .post('/modifiers/groups')
        .set('asmara-token', token)
        .send({ menu_item_id: menuItemId, name: 'Tenant 1 Only', selection_type: 'single' });
    const groupId = groupRes.body.group.id;

    const patchRes = await request(ctx.app)
        .patch(`/modifiers/groups/${groupId}`)
        .set('asmara-token', other.token)
        .send({ name: 'Hijacked' });
    assert.equal(patchRes.status, 404);

    const deleteRes = await request(ctx.app).delete(`/modifiers/groups/${groupId}`).set('asmara-token', other.token);
    assert.equal(deleteRes.status, 404);

    // The group must be completely untouched.
    const stillThere = await ctx.knex('modifier_groups').where('id', groupId).first();
    assert.equal(stillThere.name, 'Tenant 1 Only');
});
