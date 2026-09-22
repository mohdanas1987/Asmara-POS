'use strict';
/**
 * Order domain normalization, phase 2 (production-completion spec, section 8 "Order domain
 * normalization" -- CTO feedback 2026-09-22, item 8: "orders / order_items /
 * order_item_modifiers / order_item_courses / order_status_history / order_table_history /
 * ... Historical transactional data should not depend on mutable JSON structures.").
 *
 * DELIBERATELY ADDITIVE, same convention as 0019_order_line_snapshots.js: `orders.status`,
 * `orders.tables` and `orders.data` remain the live, authoritative fields the rest of the
 * app reads today -- this migration does not touch them or cut over any existing read site.
 * It adds two append-only, immutable history tables that get a new row every time an
 * order's status changes or an order's table assignment changes, so "what happened to this
 * order, in what order, and when" becomes a real queryable audit trail instead of only ever
 * being inferable from the CURRENT value of two mutable columns (which is exactly what the
 * CTO feedback flags as insufficient for production certification: you can see where an
 * order/table is now, but not the history of how it got there).
 *
 * A later phase (tracked separately, NOT done here) would build the actual query/reporting
 * UI on top of this history and extend the same pattern to order_item_courses -- stated as
 * a known, explicit follow-up rather than silently declared finished.
 */
exports.up = async function (knex) {
  const hasStatusHistory = await knex.schema.hasTable('order_status_history');
  if (!hasStatusHistory) {
    await knex.schema.createTable('order_status_history', (table) => {
      table.increments('id').primary();
      table.bigInteger('tenant_id').notNullable().index();
      table.string('order_id', 32).notNullable().index();
      table.string('from_status', 32).nullable(); // null on the very first row (order creation)
      table.string('to_status', 32).notNullable();
      table.string('reason', 255).nullable(); // e.g. 'to-kitchen', 'payment-update', 'cancel', 'finish'
      table.bigInteger('changed_by_user_id').nullable();
      table.string('terminal_id', 64).nullable(); // matches services/offline/* terminal identity, when known
      table.text('correlation_id').nullable(); // ties together the request that caused this + any related rows
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['tenant_id', 'order_id']);
    });
  }

  const hasTableHistory = await knex.schema.hasTable('order_table_history');
  if (!hasTableHistory) {
    await knex.schema.createTable('order_table_history', (table) => {
      table.increments('id').primary();
      table.bigInteger('tenant_id').notNullable().index();
      table.string('order_id', 32).notNullable().index();
      table.string('from_table', 64).nullable(); // null on the very first row (order opened on a table)
      table.string('to_table', 64).notNullable();
      table.string('event_type', 32).notNullable(); // 'open' | 'transfer' | 'merge' | 'split'
      table.bigInteger('changed_by_user_id').nullable();
      table.string('terminal_id', 64).nullable();
      table.text('correlation_id').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['tenant_id', 'order_id']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('order_table_history');
  await knex.schema.dropTableIfExists('order_status_history');
};
