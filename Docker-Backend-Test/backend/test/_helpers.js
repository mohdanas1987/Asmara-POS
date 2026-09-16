/**
 * Shared test helpers -- Phase 1 automated test suite.
 *
 * Each test FILE gets its own throwaway SQLite database (a uniquely-named file under
 * backend/test/.tmp/), migrated and seeded fresh, and its own Express app instance from
 * server.local.js's createApp(). Nothing is shared between test files, so there is no
 * cross-file state leakage and no SQLite write-lock contention even if the test runner
 * executes files concurrently.
 */
const path = require('path');
const fs = require('fs');
const Knex = require('knex');
const bcrypt = require('bcrypt');
const { createApp } = require('../server.local.js');

const TMP_DIR = path.join(__dirname, '.tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

async function setupTestApp(testName) {
    const dbFile = path.join(TMP_DIR, `${testName}.sqlite`);
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

    const knex = Knex({
        client: 'sqlite3',
        connection: { filename: dbFile },
        useNullAsDefault: true,
        migrations: { directory: path.join(__dirname, '../migrations_local') }
    });

    await knex.migrate.latest();

    const salt = await bcrypt.genSalt(8);
    const password = await bcrypt.hash('Test1234!', salt);
    const [userId] = await knex('users').insert({
        name: 'Test Admin', email: 'admin@test.local', password, type: 'admin', role: 'admin', status: true
    });

    await knex('tables').insert([
        { table_number: '1', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '2', status: 'free', x: 100, y: 0, length: 80, width: 80 },
        { table_number: '3', status: 'occupied', x: 200, y: 0, length: 80, width: 80 }
    ]);

    await knex('orders').insert({
        id: 'seed_order_001',
        tables: '3',
        status: 'ongoing',
        payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }),
        total: 13.50,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    const app = createApp(knex);
    return { app, knex, userId };
}

async function teardownTestApp(ctx) {
    if (ctx && ctx.knex) await ctx.knex.destroy();
}

async function loginAsAdmin(request, app) {
    const res = await request(app)
        .post('/auth/login')
        .send({ email: 'admin@test.local', password: 'Test1234!' });
    return res.body.authToken;
}

// Phase 1 / Task #10 (multi-tenant test support): creates a SECOND restaurant inside the
// same throwaway database that setupTestApp() already seeded with tenant 1 -- its own
// tenant row, its own admin login, its own table -- so tests can log in as a completely
// different restaurant and confirm it can never see or touch tenant 1's data (and vice
// versa). Returns the second tenant's id, user id, and a ready-to-use login token.
async function seedSecondTenant(request, app, knex) {
    const [tenantId] = await knex('tenants').insert({
        name: 'Second Restaurant', slug: 'second-restaurant', status: true
    });

    const salt = await bcrypt.genSalt(8);
    const password = await bcrypt.hash('Test1234!', salt);
    const [userId] = await knex('users').insert({
        name: 'Other Admin', email: 'admin2@test.local', password, type: 'admin', role: 'admin', status: true,
        tenant_id: tenantId
    });

    await knex('tables').insert([
        { table_number: '1', status: 'free', x: 0, y: 0, length: 80, width: 80, tenant_id: tenantId }
    ]);

    const res = await request(app)
        .post('/auth/login')
        .send({ email: 'admin2@test.local', password: 'Test1234!' });

    return { tenantId, userId, token: res.body.authToken };
}

// RBAC (project audit 2026-09-15): seeds a staff member with a specific non-admin role in
// the SAME tenant setupTestApp() already created, and logs them in, so tests can assert on
// what each role can and cannot do against real routes.
async function seedStaffUser(request, app, knex, { email, role, tenantId } = {}) {
    const salt = await bcrypt.genSalt(8);
    const password = await bcrypt.hash('Test1234!', salt);
    const insert = { name: `Test ${role}`, email, password, type: role, role, status: true };
    if (tenantId !== undefined) insert.tenant_id = tenantId;
    await knex('users').insert(insert);

    const res = await request(app).post('/auth/login').send({ email, password: 'Test1234!' });
    return res.body.authToken;
}

module.exports = { setupTestApp, teardownTestApp, loginAsAdmin, seedSecondTenant, seedStaffUser };
