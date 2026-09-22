'use strict';
/**
 * Idempotency hardening (CTO feedback 2026-09-22, item 11: "Idempotency hardening -- race
 * conditions, payment-specific idempotency, replay-after-restart testing"). The original
 * implementation (migrations_local/0019_idempotency_keys.js, middlewares/idempotent.js) only
 * ever wrote a row AFTER the handler finished successfully -- there was no reservation step,
 * so two requests carrying the identical idempotency_key could both pass the "does a row
 * already exist?" check before either had written one, and both would run the handler's real
 * side effects (the documented race in the original file's header comment).
 *
 * This migration makes that race closable: `status_code` and `response_json` become nullable
 * (a reservation row is written BEFORE the response exists) and a `status` column tracks
 * whether a key is still in flight ('pending') or actually finished ('completed'). Existing
 * rows from before this migration are exactly the "handler already succeeded and its response
 * is stored" case, so they are backfilled to 'completed' -- their behavior (replay the stored
 * response) is completely unchanged.
 *
 * Deliberately additive to the same table rather than a new one: this is a hardening of the
 * existing mechanism, not a new concept, and every current caller of IdempotencyKey continues
 * to work unless it explicitly starts using the new `status` column (see the middleware
 * rewrite in this same commit).
 */
exports.up = async function up(knex) {
  const hasStatusColumn = await knex.schema.hasColumn('idempotency_keys', 'status');
  if (!hasStatusColumn) {
    await knex.schema.alterTable('idempotency_keys', (table) => {
      table.string('status', 16).notNullable().defaultTo('completed');
    });
    // Backfill is redundant given the column default above (every existing row predates this
    // migration and is therefore already a finished, replay-able record) but stated explicitly
    // for clarity/auditability rather than relying silently on the DEFAULT.
    await knex('idempotency_keys').update({ status: 'completed' });
  }

  // SQLite can't ALTER COLUMN to relax a NOT NULL constraint in place; recreate the table with
  // the relaxed schema (Knex's alterTable batches this as a rename+recreate+copy on sqlite3).
  const columns = await knex('idempotency_keys').columnInfo();
  if (columns.status_code && columns.status_code.nullable === false) {
    await knex.schema.alterTable('idempotency_keys', (table) => {
      table.integer('status_code').nullable().alter();
      table.longText('response_json').nullable().alter();
    });
  }
};

exports.down = async function down(knex) {
  // Deliberately a no-op: reversing this would require re-asserting NOT NULL on columns that
  // may now legitimately hold nulls (pending reservation rows), which would need those rows
  // deleted first. Not attempted here -- consistent with this codebase's other additive
  // migrations that don't provide a lossy `down`.
};
