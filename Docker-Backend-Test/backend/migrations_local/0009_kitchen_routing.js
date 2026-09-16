'use strict';
/**
 * Kitchen ticket routing as its own domain (project audit 2026-09-15, task "Kitchen ticket
 * routing as its own domain").
 *
 * Before this migration, "kitchen" was purely an order status ('in-kitchen') set on the
 * whole order -- there was no concept of which physical kitchen printer/station a given
 * item should go to, so a restaurant with a separate grill station and bar/drinks station
 * had no way to route tickets differently. This adds:
 *   - kitchen_stations: the physical stations a tenant has configured (each optionally tied
 *     to a printer id from the existing hardware abstraction in RestaurantOS-Desktop/hardware.js).
 *   - menu_items.kitchen_station_id: which station a given product's "preparation rule"
 *     sends it to. Nullable -- an unset item falls back to the tenant's default station, so
 *     existing menu data needs no immediate changes to keep working.
 *   - kitchen_tickets: one row per (order, station) pair once an order is sent to kitchen --
 *     this is the KDS-ready, reprintable, per-station record that plain order status never
 *     gave us.
 *
 * Every existing table, column, and route this touches is additive. The existing
 * order.status = 'in-kitchen' flow (routes/orders.js) is left completely intact and keeps
 * working exactly as before for anything not yet updated to read kitchen_tickets.
 */
exports.up = async function up(knex) {
  const hasStations = await knex.schema.hasTable('kitchen_stations');
  if (!hasStations) {
    await knex.schema.createTable('kitchen_stations', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').notNullable().defaultTo(1);
      table.string('name').notNullable();
      table.string('printer_id').nullable(); // matches an id from hardware.js's listPrinters()
      table.boolean('is_default').notNullable().defaultTo(false);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  const hasStationCol = await knex.schema.hasColumn('menu_items', 'kitchen_station_id');
  if (!hasStationCol) {
    await knex.schema.alterTable('menu_items', (table) => {
      table.integer('kitchen_station_id').nullable();
    });
  }

  const hasTickets = await knex.schema.hasTable('kitchen_tickets');
  if (!hasTickets) {
    await knex.schema.createTable('kitchen_tickets', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').notNullable().defaultTo(1);
      table.string('order_id').notNullable();
      table.integer('station_id').notNullable();
      table.string('table_number').nullable();
      table.text('items').notNullable(); // JSON: [{ id, name, quantity, notes }]
      table.string('status').notNullable().defaultTo('pending'); // pending -> preparing -> ready -> served
      table.timestamp('printed_at').nullable();
      table.text('print_error').nullable();
      table.integer('reprint_count').notNullable().defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.index(['tenant_id', 'status']);
      table.index(['tenant_id', 'order_id']);
    });
  }

  // Backfill: every tenant that already exists gets one default "Main Kitchen" station, so
  // routing never has "nowhere to send an unmapped item" as a possible state. Reads from
  // `tenants`, NOT `users` -- migration 0003 always seeds a tenant id=1 row up front, but a
  // brand-new database (a fresh test run, or a fresh local install before the first signup)
  // has no rows in `users` yet at the point migrations run, so backfilling from `users` would
  // silently create zero stations on exactly the databases that need one most. (Found via a
  // real failing test against a fresh sqlite database, not guessed at.)
  const tenantIds = await knex('tenants').pluck('id');
  const existingDefaults = await knex('kitchen_stations').where('is_default', true).pluck('tenant_id');
  const missing = tenantIds.filter((id) => id != null && !existingDefaults.includes(id));
  for (const tenantId of missing) {
    // eslint-disable-next-line no-await-in-loop
    await knex('kitchen_stations').insert({ tenant_id: tenantId, name: 'Main Kitchen', is_default: true });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('kitchen_tickets')) await knex.schema.dropTable('kitchen_tickets');
  if (await knex.schema.hasColumn('menu_items', 'kitchen_station_id')) {
    await knex.schema.alterTable('menu_items', (table) => table.dropColumn('kitchen_station_id'));
  }
  if (await knex.schema.hasTable('kitchen_stations')) await knex.schema.dropTable('kitchen_stations');
};
