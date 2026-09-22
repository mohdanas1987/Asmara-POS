'use strict';
/**
 * Seat / server assignment (CTO forensic audit 2026-09-21, P1 "Seat / server assignment" --
 * flagged as missing; there was no way to record which staff member is responsible for a
 * table). Deliberately the smallest real version of this: WHO is serving a table right now,
 * not a full seat-by-seat model (that needs its own schema -- see the item-level table
 * transfer route's comment on why this pass doesn't attempt seat-level granularity either).
 * A nullable FK, not a required one -- an unassigned table (the default, and the only state
 * that has ever existed until now) must keep behaving exactly as before.
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('tables', 'assigned_server_id');
  if (!hasColumn) {
    await knex.schema.alterTable('tables', (table) => {
      table.integer('assigned_server_id').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('tables', 'assigned_server_id');
  if (hasColumn) {
    await knex.schema.alterTable('tables', (table) => {
      table.dropColumn('assigned_server_id');
    });
  }
};
