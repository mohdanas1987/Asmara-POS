'use strict';
/**
 * Payment / order idempotency (CTO forensic audit 2026-09-21, P0 "Payment idempotency +
 * recovery"). A POS terminal retrying a slow or dropped request -- a flaky network, or a
 * cashier double-tapping "Charge" -- must never be able to double-charge a customer or
 * double-create an order. This table lets a route remember "I already handled this exact
 * client-generated key" and replay the original response instead of re-running the side
 * effects a second time.
 *
 * Deliberately generic (keyed by tenant + the caller's own key + which route it was for)
 * rather than a column bolted onto `orders` or `payment_transactions`, so the same mechanism
 * can protect any future financially-sensitive endpoint without another migration.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('idempotency_keys', (table) => {
    table.increments('id').primary();
    table.integer('tenant_id').notNullable();
    table.string('idempotency_key', 128).notNullable();
    table.string('route', 64).notNullable();
    table.integer('status_code').notNullable();
    table.longText('response_json').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.unique(['tenant_id', 'idempotency_key', 'route']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('idempotency_keys');
};
