'use strict';
/**
 * Loyalty subsystem (project audit 2026-09-15, task "Loyalty subsystem (ledger-based)").
 *
 * Before this migration there was zero loyalty code anywhere in the repository -- no
 * points column, no ledger, no customer-facing identity beyond a name/phone/email. This
 * adds it as a real append-only ledger (never a single mutable `customer.points` integer):
 * every earn, redemption, and manual correction is its own row, and a customer's current
 * balance is always SUM(ledger.points) for that customer -- auditable, and immune to the
 * "someone edited the number directly" class of loyalty fraud/bugs.
 *
 *   - customers.customer_code: a short, unique-per-tenant code a barcode/QR can encode, so
 *     a physical loyalty card or a phone screen can be scanned at the POS to look the
 *     customer up (routes/loyalty.js's /lookup/:code). Nullable + backfilled, so no existing
 *     customer row is left without one after this migration runs.
 *   - loyalty_config: one row per tenant holding the EARN/REDEEM RATES AS CONFIGURATION, not
 *     hardcoded constants -- cents_per_point (how many cents of spend earns 1 point),
 *     redeem_value_cents (how many cents 1 point is worth on redemption), and
 *     min_redeem_points (the smallest redemption a customer can make). Seeded with the
 *     rates given in the product requirement (EUR 1 -> 1 point, 1 point -> EUR 0.01, 200
 *     points minimum to redeem) as the default for every tenant, but changeable per tenant
 *     via PATCH /loyalty/config without touching code.
 *   - loyalty_ledger: the append-only transaction log itself.
 */
exports.up = async function up(knex) {
  const hasCode = await knex.schema.hasColumn('customers', 'customer_code');
  if (!hasCode) {
    await knex.schema.alterTable('customers', (table) => {
      table.string('customer_code').nullable();
    });
  }

  const hasConfig = await knex.schema.hasTable('loyalty_config');
  if (!hasConfig) {
    await knex.schema.createTable('loyalty_config', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').notNullable().unique();
      table.integer('cents_per_point').notNullable().defaultTo(100); // EUR 1.00 -> 1 point
      table.integer('redeem_value_cents').notNullable().defaultTo(1); // 1 point -> EUR 0.01
      table.integer('min_redeem_points').notNullable().defaultTo(200); // 200 points -> EUR 2.00
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  const hasLedger = await knex.schema.hasTable('loyalty_ledger');
  if (!hasLedger) {
    await knex.schema.createTable('loyalty_ledger', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').notNullable();
      table.integer('customer_id').notNullable();
      table.string('order_id').nullable();
      table.string('type').notNullable(); // 'earn' | 'redeem' | 'adjustment'
      table.integer('points').notNullable(); // signed: earn/positive-adjustment > 0, redeem/negative-adjustment < 0
      table.integer('balance_after').notNullable(); // denormalized snapshot for fast reads/receipts
      table.string('reason').nullable();
      table.bigInteger('created_by').nullable(); // users.id
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['tenant_id', 'customer_id']);
    });
  }

  // Backfill: give every existing customer without one a unique code, and every tenant that
  // doesn't have a loyalty_config row yet the default rates above.
  const customers = await knex('customers').whereNull('customer_code').select('id', 'tenant_id');
  for (const customer of customers) {
    const code = `LC-${customer.tenant_id}-${customer.id}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    // eslint-disable-next-line no-await-in-loop
    await knex('customers').where('id', customer.id).update({ customer_code: code });
  }

  const tenantIds = await knex('tenants').pluck('id');
  const existingConfigs = await knex('loyalty_config').pluck('tenant_id');
  const missingConfigs = tenantIds.filter((id) => id != null && !existingConfigs.includes(id));
  for (const tenantId of missingConfigs) {
    // eslint-disable-next-line no-await-in-loop
    await knex('loyalty_config').insert({ tenant_id: tenantId });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('loyalty_ledger')) await knex.schema.dropTable('loyalty_ledger');
  if (await knex.schema.hasTable('loyalty_config')) await knex.schema.dropTable('loyalty_config');
  if (await knex.schema.hasColumn('customers', 'customer_code')) {
    await knex.schema.alterTable('customers', (table) => table.dropColumn('customer_code'));
  }
};
