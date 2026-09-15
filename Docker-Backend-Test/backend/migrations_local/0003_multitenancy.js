/**
 * MULTI-TENANCY FOUNDATION — Phase 1 (local/offline development environment)
 *
 * Task #10 of the Phase 1 plan: "Design + implement multi-tenant schema against local DB."
 * This is additive-only and backward-compatible with the single existing restaurant:
 *
 *   - A new `tenants` table is created, and a default tenant (id 1) is seeded to represent
 *     the current, only-ever-existed restaurant (Asmara Restaurant). Nothing about this
 *     restaurant's existing data changes meaning.
 *   - Every restaurant-scoped table gets a `tenant_id` column, NOT NULL, defaulting to 1.
 *     Because every existing row (and every row inserted by code that hasn't been updated
 *     to set tenant_id explicitly yet) lands in tenant 1, this cannot silently break the
 *     current single-tenant behavior -- there is still, from the data's point of view, only
 *     one restaurant, until a second tenant is deliberately created (as the isolation test
 *     suite does).
 *   - Two uniqueness constraints that were correctly global for a single restaurant are now
 *     wrong for multiple restaurants and are converted to be unique PER TENANT instead:
 *     `tables.table_number` (two different restaurants both have a "Table 1") and
 *     `queues.name` (two restaurants each have their own daily-report job). `customers.phone`
 *     is also converted the same way -- two different restaurants can each have a walk-in
 *     customer who shares a phone number by coincidence.
 *   - `users.email` is deliberately left globally unique. Login in this app is "email +
 *     password" with no separate tenant/subdomain selector, so the email itself is what
 *     resolves which tenant a login belongs to; the JWT issued at login now embeds that
 *     user's tenant_id (see routes/auth.js), and every route uses that to scope its queries.
 *   - `currency` and `applications` are deliberately NOT given a tenant_id in this pass.
 *     `currency` looks unused by any route (found by earlier code-usage reconstruction) and
 *     `applications` is only referenced by an unused model relation with no route reading or
 *     writing it -- there's nothing to prove which of several possible tenant-scoping designs
 *     would even be correct for them yet. Documented as a deferred/discovered item, not
 *     silently guessed at.
 *
 * When Phase 2 has real access to srv1399.hstgr.io, this same migration (translated to
 * MySQL's ALTER TABLE / index syntax, which knex handles automatically per-client) is what
 * would be run against the live database -- as an additive column-add + index change, never
 * a destructive one, and with every existing row explicitly backfilled into a single
 * "default tenant" row exactly like this migration's seed step does here.
 */

const TENANT_SCOPED_TABLES = [
    'users', 'tables', 'menu_categories', 'menu_items', 'taxes', 'customers',
    'cash_register', 'order_details', 'orders', 'reports', 'notifications',
    'settings', 'queues', 'reservations',
];

exports.up = async function (knex) {
    await knex.schema.createTable('tenants', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
        table.string('slug').notNullable().unique();
        table.boolean('status').defaultTo(true);
        table.timestamps(true, true);
    });

    // The one restaurant this app has ever run for, so every pre-existing (and
    // not-yet-tenant-aware) row has somewhere valid to belong.
    await knex('tenants').insert({
        id: 1,
        name: 'Asmara Restaurant',
        slug: 'asmara-eindhoven',
        status: true,
    });

    for (const tableName of TENANT_SCOPED_TABLES) {
        await knex.schema.alterTable(tableName, (table) => {
            table.integer('tenant_id').notNullable().defaultTo(1).index();
        });
    }

    // table_number was globally unique; must become unique per-tenant.
    await knex.schema.alterTable('tables', (table) => {
        table.dropUnique(['table_number']);
        table.unique(['tenant_id', 'table_number']);
    });

    // queues.name (e.g. the daily-report job key) was globally unique; per-tenant now.
    await knex.schema.alterTable('queues', (table) => {
        table.dropUnique(['name']);
        table.unique(['tenant_id', 'name']);
    });

    // customers.phone was globally unique; per-tenant now.
    await knex.schema.alterTable('customers', (table) => {
        table.dropUnique(['phone']);
        table.unique(['tenant_id', 'phone']);
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable('customers', (table) => {
        table.dropUnique(['tenant_id', 'phone']);
        table.unique(['phone']);
    });
    await knex.schema.alterTable('queues', (table) => {
        table.dropUnique(['tenant_id', 'name']);
        table.unique(['name']);
    });
    await knex.schema.alterTable('tables', (table) => {
        table.dropUnique(['tenant_id', 'table_number']);
        table.unique(['table_number']);
    });

    for (const tableName of TENANT_SCOPED_TABLES) {
        await knex.schema.alterTable(tableName, (table) => {
            table.dropColumn('tenant_id');
        });
    }

    await knex.schema.dropTableIfExists('tenants');
};
