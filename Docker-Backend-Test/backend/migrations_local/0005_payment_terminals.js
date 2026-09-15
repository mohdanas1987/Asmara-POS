/**
 * PAYMENT TERMINAL SUPPORT — Phase 1 (local/offline)
 *
 * One row per tenant (same reasoning as migrations_local/0004's website_connections: this is
 * a restaurant-wide fact, not a per-user preference, so it does not belong in the generic
 * per-user `settings` table). Holds which provider is active and its credentials/terminal id.
 * Credentials are stored as given -- encrypting secrets at rest is a real, separate concern
 * or this project (it doesn't exist anywhere else in this schema either, e.g. the JWT secret
 * lives in an env var, not the DB) and shouldn't be silently half-solved here.
 */
exports.up = async function (knex) {
    await knex.schema.createTable('payment_terminal_settings', (table) => {
        table.increments('id').primary();
        table.bigInteger('tenant_id').notNullable().unique();
        table.string('provider').nullable(); // 'stripe' | 'adyen' | 'sumup' | 'mollie'
        table.string('api_key').nullable();
        table.string('api_secret').nullable(); // Adyen: HMAC key; others may not need this
        table.string('terminal_id').nullable(); // Adyen POI id / SumUp reader id / etc.
        table.boolean('connected').notNullable().defaultTo(false);
        table.timestamps(true, true);
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('payment_terminal_settings');
};
