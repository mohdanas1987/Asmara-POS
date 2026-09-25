'use strict';
/**
 * Seat & guest architecture (CTO doc "Asmara POS -- Remaining Work Only", Phase 22/item 3 --
 * "no first-class domain model for Table -> Seats -> Order -> Guest -> Order Item -> Seat").
 *
 * DESIGN DECISION, made deliberately rather than guessed at: a "seat" here is scoped to an
 * ORDER (one party's visit), numbered 1..N, not a fixed physical row on the `tables` table.
 * This matches how real POS seat models actually work (Toast, Square, Lightspeed all number
 * seats per CHECK, not as a static per-table schema) and avoids inventing capacity data this
 * app has never collected (there is no existing seat-count column on `tables`). A table's
 * usual/expected seat count is still worth surfacing in the floor-plan UI, so `tables.
 * seat_count` is added too (nullable -- unconfigured until a restaurant sets it), but the
 * SOURCE OF TRUTH for "how many seats does THIS order actually have" is the highest
 * seat_number that's actually been assigned a guest or an item, exactly like a real physical
 * table where extra chairs get pulled up for a bigger party.
 *
 * `order_guests`: one row per (order, seat) that has been given an identity -- a name (real,
 * e.g. "Alex") or left as a placeholder ("Guest 2"), so the floor/POS UI and a seat-based bill
 * split both have something human-readable to show. A seat with items assigned but no guest
 * row is still perfectly valid (falls back to "Seat N" in any UI/split) -- this table exists
 * purely to let staff OPTIONALLY name a seat, never to gate whether items can be assigned to it.
 *
 * `order_items.seat_number`: which seat an already-charged, snapshotted line belongs to (see
 * services/orderLineSnapshot.js) -- nullable, so an order with no seat assignment at all (the
 * overwhelming majority of today's orders) snapshots exactly as it always did.
 */
exports.up = async function up(knex) {
  const hasGuests = await knex.schema.hasTable('order_guests');
  if (!hasGuests) {
    await knex.schema.createTable('order_guests', (table) => {
      table.increments('id').primary();
      table.bigInteger('tenant_id').notNullable().index();
      table.string('order_id', 32).notNullable().index();
      table.integer('seat_number').notNullable();
      table.string('guest_name').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.unique(['tenant_id', 'order_id', 'seat_number']);
    });
  }

  const hasSeatNumber = await knex.schema.hasColumn('order_items', 'seat_number');
  if (!hasSeatNumber) {
    await knex.schema.alterTable('order_items', (table) => {
      table.integer('seat_number').nullable();
    });
  }

  const hasSeatCount = await knex.schema.hasColumn('tables', 'seat_count');
  if (!hasSeatCount) {
    await knex.schema.alterTable('tables', (table) => {
      table.integer('seat_count').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasSeatCount = await knex.schema.hasColumn('tables', 'seat_count');
  if (hasSeatCount) {
    await knex.schema.alterTable('tables', (table) => {
      table.dropColumn('seat_count');
    });
  }

  const hasSeatNumber = await knex.schema.hasColumn('order_items', 'seat_number');
  if (hasSeatNumber) {
    await knex.schema.alterTable('order_items', (table) => {
      table.dropColumn('seat_number');
    });
  }

  const hasGuests = await knex.schema.hasTable('order_guests');
  if (hasGuests) {
    await knex.schema.dropTable('order_guests');
  }
};
