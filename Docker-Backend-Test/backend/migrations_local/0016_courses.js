'use strict';
/**
 * Course firing (CTO forensic audit 2026-09-20: flagged as never built -- correctly, this
 * was never even scoped as a task before now). A restaurant course ("starters" / "mains" /
 * "dessert") is a FIRING sequence, not just a menu grouping: starters should reach the
 * kitchen immediately, but mains/dessert should sit held at the POS until a waiter tells the
 * kitchen to fire them (so the kitchen doesn't start the steak before the table has finished
 * its starters). This migration adds the minimum real schema for that:
 *
 *   - menu_items.course: optional label ('starter' | 'main' | 'dessert' | 'other'). Nullable
 *     and defaulted to nothing, so every existing item (and every existing test) behaves
 *     exactly as before -- an item with no course set is treated as immediate-fire, matching
 *     the app's entire current behavior (Preservation Contract).
 *   - held_course_items: items that have been added to an order but deliberately NOT yet
 *     routed to a kitchen_tickets row. One row per (order, course) batch. `fired_at` is set
 *     the moment a waiter fires that course, at which point services/courseRouting.js moves
 *     those items into real kitchen tickets via the existing routeOrderToKitchen().
 */
exports.up = async function up(knex) {
  const hasCourse = await knex.schema.hasColumn('menu_items', 'course');
  if (!hasCourse) {
    await knex.schema.alterTable('menu_items', (table) => {
      table.string('course').nullable();
    });
  }

  const hasHeldTable = await knex.schema.hasTable('held_course_items');
  if (!hasHeldTable) {
    await knex.schema.createTable('held_course_items', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').notNullable();
      table.string('order_id').notNullable();
      table.string('table_number').nullable();
      table.string('course').notNullable();
      table.text('items').notNullable(); // JSON array of {id, quantity} -- same shape routeOrderToKitchen expects
      table.timestamp('fired_at').nullable(); // null = still held
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.index(['tenant_id', 'order_id', 'course']);
    });
  }
};

exports.down = async function down(knex) {
  const hasHeldTable = await knex.schema.hasTable('held_course_items');
  if (hasHeldTable) {
    await knex.schema.dropTable('held_course_items');
  }
  const hasCourse = await knex.schema.hasColumn('menu_items', 'course');
  if (hasCourse) {
    await knex.schema.alterTable('menu_items', (table) => {
      table.dropColumn('course');
    });
  }
};
