/**
 * STAGE 2b / phase 26 (Phase 1 local-dev pass) -- fixing a real, previously-documented bug:
 * models/Reservation.js pointed at the 'reports' table with a broken relation (join.to: ""),
 * meaning `GET /tables/reservations` has always returned report rows mislabeled as
 * reservations, and no real reservation data has ever existed anywhere in this app. There is
 * no reservations table in the stale committed migrations, nor (as far as could be
 * determined without live DB access) in the real production database either -- this looks
 * like a feature that was scaffolded (the model, the route) but never actually finished.
 *
 * This migration creates a real, minimal reservations table and is a genuinely NEW table,
 * not a reconstruction of something that already exists in production -- unlike
 * 0001_reconstructed_schema.js. When Phase 2 has real database access, this exact migration
 * (or an equivalent one) needs to actually be run against the live database for this fix to
 * take effect there -- it does nothing on its own until then. Locally, this makes
 * `GET /tables/reservations` return real (initially empty) data instead of mislabeled
 * report rows.
 *
 * Deliberately minimal: enough columns to list/store a reservation, no new create/edit/
 * cancel routes were added -- fixing the broken read path is the bug fix in scope here;
 * building out full reservation management is real feature work for a later phase.
 */
exports.up = async function (knex) {
    await knex.schema.createTable('reservations', (table) => {
        table.increments('id').primary();
        table.string('customer_name').notNullable();
        table.string('phone').nullable();
        table.bigInteger('table_id').nullable(); // FK-ish, informal (matches this codebase's style)
        table.string('table_number').nullable();
        table.date('date').notNullable();
        table.string('time').nullable();
        table.integer('party_size').defaultTo(1);
        table.string('status').defaultTo('pending'); // pending | confirmed | cancelled | seated
        table.longText('note').nullable();
        table.bigInteger('user_id').nullable(); // who took the reservation
        table.timestamps(true, true);
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('reservations');
};
