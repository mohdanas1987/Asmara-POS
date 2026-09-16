'use strict';
/**
 * Optimistic locking (execution plan gap: "no version column, no conflict-safe writes on
 * orders/tables"). Adds a plain integer `version` column, default 1, to both tables. This is
 * additive and 100% backward compatible -- every existing read/write of `orders`/`tables`
 * continues to work unchanged whether or not the caller knows this column exists.
 *
 * Real conflict detection is wired up in routes/orders.js POST /to-kitchen/:table?, the one
 * place a genuine lost-update race exists today: two terminals editing the same order's item
 * quantities from a stale read of `data`, where the last write silently discards the other
 * terminal's changes. Table mutations were inspected (routes/tables.js) and are, apart from
 * POST /transfer (already wrapped in a real DB transaction with its own conflict check), blind
 * status flips with no read-then-merge step -- a version check there would protect nothing, so
 * this column exists on `tables` for consistency and future use but isn't enforced yet.
 */
exports.up = async function up(knex) {
  const hasOrdersVersion = await knex.schema.hasColumn('orders', 'version');
  const hasTablesVersion = await knex.schema.hasColumn('tables', 'version');
  if (!hasOrdersVersion) {
    await knex.schema.alterTable('orders', (table) => {
      table.integer('version').notNullable().defaultTo(1);
    });
  }
  if (!hasTablesVersion) {
    await knex.schema.alterTable('tables', (table) => {
      table.integer('version').notNullable().defaultTo(1);
    });
  }
};

exports.down = async function down(knex) {
  const hasOrdersVersion = await knex.schema.hasColumn('orders', 'version');
  const hasTablesVersion = await knex.schema.hasColumn('tables', 'version');
  if (hasOrdersVersion) {
    await knex.schema.alterTable('orders', (table) => {
      table.dropColumn('version');
    });
  }
  if (hasTablesVersion) {
    await knex.schema.alterTable('tables', (table) => {
      table.dropColumn('version');
    });
  }
};
