'use strict';
/**
 * Order line normalization, phase 1 (production-completion spec, section 7 "Normalized
 * order data model" + section 9 "Kitchen line fidelity"): real, queryable, immutable rows
 * for every order line and its modifiers, instead of only the `orders.data` JSON blob.
 *
 * DELIBERATELY ADDITIVE, NOT A CUTOVER (Rule 1 -- "do not rebuild unnecessarily", "preserve
 * functionality that is already correctly implemented"): `orders.data` remains the live,
 * authoritative read/write path for the in-progress cart/kitchen-ticket flow -- rewriting
 * every read site of that blob (routes/orders.js, kitchen routing, receipts, reports,
 * the frontend cart) in one pass would be a much larger, higher-risk change than this repo's
 * existing "small, reviewable, tested step" convention allows for. This migration adds the
 * relational side: `order_items`/`order_item_modifiers` are populated with an IMMUTABLE
 * snapshot (product name, SKU, unit price, VAT rate/amount, modifier name + price delta) at
 * the moment a line is actually charged (see services/orderLineSnapshot.js, wired into
 * POST /orders/create) -- exactly the data section 7 asks to never let drift when the menu
 * changes later. Line-level identity (`line_index` + its own row) also directly fixes
 * section 6's "Burger+Cheese must stay a separate line from Burger+No-Cheese" requirement
 * for every ROW written from here on, without touching the existing kitchen-routing diff
 * logic that already works off the aggregate quantity map.
 *
 * A second phase (tracked separately, NOT done here) would migrate every remaining read
 * site off the JSON blob onto these tables and backfill history -- marked as a known,
 * stated follow-up rather than silently declared finished.
 */
exports.up = async function (knex) {
  const hasOrderItems = await knex.schema.hasTable('order_items');
  if (!hasOrderItems) {
    await knex.schema.createTable('order_items', (table) => {
      table.increments('id').primary();
      table.bigInteger('tenant_id').notNullable().index();
      table.string('order_id', 32).notNullable().index();
      table.integer('line_index').notNullable(); // position within the order's line array -- this IS the line identity
      table.bigInteger('product_id').nullable(); // nullable: custom/ad-hoc items have no menu_items row
      table.string('product_name').notNullable(); // snapshot -- never re-read from menu_items after insert
      table.string('sku').nullable(); // snapshot of menu_items.code
      table.decimal('quantity', 12, 3).notNullable();
      table.decimal('unit_price_gross', 12, 4).notNullable(); // VAT-inclusive unit price snapshot
      table.decimal('vat_rate', 6, 3).nullable();
      table.decimal('net_amount', 12, 4).notNullable(); // (unit_price_gross - vat portion) * quantity
      table.decimal('vat_amount', 12, 4).notNullable();
      table.decimal('gross_amount', 12, 4).notNullable(); // unit_price_gross * quantity, what the customer actually paid for this line
      table.string('course').nullable();
      table.text('note').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['tenant_id', 'order_id']);
    });
  }

  const hasOrderItemModifiers = await knex.schema.hasTable('order_item_modifiers');
  if (!hasOrderItemModifiers) {
    await knex.schema.createTable('order_item_modifiers', (table) => {
      table.increments('id').primary();
      table.integer('order_item_id').notNullable().index();
      table.string('modifier_name').notNullable(); // snapshot -- never re-read from modifiers table after insert
      table.decimal('price_delta', 12, 4).notNullable().defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('order_item_modifiers');
  await knex.schema.dropTableIfExists('order_items');
};
