'use strict';
/**
 * Table/Floor management redesign (project audit 2026-09-15, task "Table/Floor management
 * redesign"). Adds the two pieces of table metadata the old app's real schema had
 * (confirmed via a live read-only query against the production database during migration
 * discovery: `tables.capacity` and `tables.section`) that the reconstructed schema never
 * carried forward -- without them there's no way to show seat count or group tables by
 * section ("Patio", "Main Floor", "Bar") the way the old app's floor plan did.
 */
exports.up = async function up(knex) {
  const hasCapacity = await knex.schema.hasColumn('tables', 'capacity');
  const hasSection = await knex.schema.hasColumn('tables', 'section');
  if (!hasCapacity || !hasSection) {
    await knex.schema.alterTable('tables', (table) => {
      if (!hasCapacity) table.integer('capacity').nullable();
      if (!hasSection) table.string('section').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasCapacity = await knex.schema.hasColumn('tables', 'capacity');
  const hasSection = await knex.schema.hasColumn('tables', 'section');
  if (hasCapacity || hasSection) {
    await knex.schema.alterTable('tables', (table) => {
      if (hasCapacity) table.dropColumn('capacity');
      if (hasSection) table.dropColumn('section');
    });
  }
};
