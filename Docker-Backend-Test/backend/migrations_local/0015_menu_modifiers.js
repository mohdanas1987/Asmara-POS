'use strict';
/**
 * Menu modifiers & spice levels (task #40). Confirmed via grep before writing this that no
 * real modifier/spice/course schema exists anywhere (the only prior "modifiers" hit was
 * Objection.js's own unrelated `.modifiers()` relation-graph method).
 *
 * One generic system covers both cases rather than a separate spice_levels table: a "Spice
 * Level" modifier group with selection_type 'single' (Mild/Medium/Hot, each with price_delta
 * 0) behaves exactly like a proper modifier group ("Add cheese", "Extra sauce", multi-select,
 * non-zero price deltas) -- no reason to build two systems.
 *
 * Deliberately scoped to menu configuration only in this migration/route pass -- this does
 * NOT touch the order/cart data schema (order.data's quantity/note/taste maps), the POS cart,
 * or kitchen tickets. Those are exactly the code paths that produced this session's two real
 * live bugs (tax double-counting, wrong photos), so wiring modifier selection into an actual
 * order is being done as its own separate, carefully-tested follow-up rather than bundled in
 * here. What this migration + its routes deliver is real and immediately usable: a restaurant
 * can define modifier groups and spice levels against a menu item today.
 */
exports.up = async function up(knex) {
  const hasGroups = await knex.schema.hasTable('modifier_groups');
  if (!hasGroups) {
    await knex.schema.createTable('modifier_groups', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').notNullable().defaultTo(1);
      table.integer('menu_item_id').notNullable();
      table.string('name').notNullable();
      table.string('selection_type').notNullable().defaultTo('single'); // 'single' | 'multiple'
      table.boolean('required').notNullable().defaultTo(false);
      table.integer('min_select').notNullable().defaultTo(0);
      table.integer('max_select').nullable();
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.index(['tenant_id', 'menu_item_id']);
      table.foreign('menu_item_id').references('id').inTable('menu_items').onDelete('CASCADE');
    });
  }

  const hasModifiers = await knex.schema.hasTable('modifiers');
  if (!hasModifiers) {
    await knex.schema.createTable('modifiers', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').notNullable().defaultTo(1);
      table.integer('modifier_group_id').notNullable();
      table.string('name').notNullable();
      // Signed so a modifier can also make an item cheaper (e.g. "No rice" on a combo) --
      // not just add cost.
      table.decimal('price_delta', 10, 2).notNullable().defaultTo(0);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.index(['tenant_id', 'modifier_group_id']);
      table.foreign('modifier_group_id').references('id').inTable('modifier_groups').onDelete('CASCADE');
    });
  }
};

exports.down = async function down(knex) {
  const hasModifiers = await knex.schema.hasTable('modifiers');
  if (hasModifiers) await knex.schema.dropTable('modifiers');
  const hasGroups = await knex.schema.hasTable('modifier_groups');
  if (hasGroups) await knex.schema.dropTable('modifier_groups');
};
