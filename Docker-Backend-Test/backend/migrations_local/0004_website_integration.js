/**
 * WEBSITE <-> POS INTEGRATION FOUNDATION — Phase 1 (local/offline)
 *
 * 1. `orders.source` ('pos' | 'online') -- additive, defaults every existing and future
 *    POS-created order into 'pos'. Lets the Online Orders screen and kitchen tickets tell an
 *    order placed through the restaurant's website apart from a normal table/counter order.
 *
 * 2. `website_connections` -- one row per tenant holding the connection state (site url,
 *    API key, connected flag). Deliberately NOT stored in the existing generic `settings`
 *    table: that table (models/Setting.js) is scoped per tenant *and* per user, which is
 *    right for a personal preference but wrong for "is the restaurant's website connected" --
 *    that's a restaurant-wide fact, and every staff login needs to see the same answer.
 *    Reusing the per-user table would mean two different logged-in staff members could see
 *    two different connection statuses, which would be a real, confusing bug. A one-row-per-
 *    tenant table is the correct shape here, not a shortcut around the existing mechanism.
 */
exports.up = async function (knex) {
    await knex.schema.alterTable('orders', (table) => {
        table.string('source').notNullable().defaultTo('pos'); // 'pos' | 'online'
    });

    await knex.schema.createTable('website_connections', (table) => {
        table.increments('id').primary();
        table.bigInteger('tenant_id').notNullable().unique();
        table.string('website_url').nullable();
        table.string('api_key').nullable();
        table.boolean('connected').notNullable().defaultTo(false);
        table.timestamps(true, true);
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('website_connections');
    await knex.schema.alterTable('orders', (table) => {
        table.dropColumn('source');
    });
};
