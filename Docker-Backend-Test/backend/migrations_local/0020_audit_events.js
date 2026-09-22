'use strict';
/**
 * Audit event log (CTO forensic audit 2026-09-21, P1 "Complete audit-event coverage" --
 * flagged as needing verification that every sensitive op emits an event). There was no
 * audit trail of any kind in this codebase before this migration -- `utils/logger.js` logs
 * to the console/log files for operators debugging the app, not a queryable, per-tenant
 * record of WHO did WHAT to WHICH business record, which is what "audit coverage" actually
 * means for a restaurant owner reviewing what happened on a shift.
 *
 * Deliberately generic (one table, a free-form `payload` JSON column) rather than a bespoke
 * table per event type, so wiring in the next sensitive action later is one call to
 * services/auditLog.js, not another migration.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('audit_events', (table) => {
    table.increments('id').primary();
    table.integer('tenant_id').notNullable();
    table.integer('actor_user_id').nullable();
    table.string('actor_role', 32).nullable();
    table.string('event_type', 64).notNullable();
    table.string('entity_type', 64).notNullable();
    table.string('entity_id', 64).nullable();
    table.text('payload').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.index(['tenant_id', 'created_at']);
    table.index(['tenant_id', 'event_type']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('audit_events');
};
