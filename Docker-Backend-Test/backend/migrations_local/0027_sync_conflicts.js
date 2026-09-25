'use strict';
/**
 * Conflict records (CTO doc "Asmara POS -- Remaining Work Only", Phase 21/item 2: "conflict
 * records", "conflict states", "reconciliation UI/status" -- explicitly: today a conflict is
 * just a 409 HTTP response, nothing is durably recorded for later review).
 *
 * GROUND TRUTH before writing this: `orders.version`/`tables.version` optimistic-locking
 * checks (migration 0014) already exist and are enforced on /orders/to-kitchen, /orders/create
 * and /orders/payment-update -- when they fire, the request is correctly rejected with a 409,
 * but nothing about that event survives past the HTTP response. This table is the durable
 * side of that: every time a version check (or the new server-authoritative-total check, a
 * different but related kind of "the client's view of this order was wrong" event) rejects a
 * write, a row is recorded here, so an operator/manager screen (not yet built -- see the
 * roadmap doc's own honest note on this) has something real to review, and so this becomes a
 * genuine, queryable audit trail rather than a transient error message no one can ever see
 * again after the terminal's screen moves on.
 *
 * `resolution` is deliberately NOT left null/pending here: for every conflict type this
 * codebase currently detects, the resolution IS immediate and deterministic -- the stale
 * write is rejected outright and the terminal is told to refresh and retry (a "reject-stale"
 * strategy). There is no queued, ambiguous, human-adjudicated case yet (that would need a real
 * three-way merge or business-rule-driven auto-merge, which doesn't exist for any entity in
 * this app today) -- so recording every row as already-resolved is accurate, not a shortcut.
 * A future entity/strategy that DOES need human adjudication should insert with
 * `resolution: 'pending'` and `resolved_at: null`, which this schema already supports.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('sync_conflicts');
  if (hasTable) return;
  await knex.schema.createTable('sync_conflicts', (table) => {
    table.increments('id').primary();
    table.bigInteger('tenant_id').notNullable().index();
    table.string('entity_type').notNullable(); // 'order' | 'table' | 'order_total' | ...
    table.string('entity_id').notNullable();
    table.string('terminal_id').nullable();
    table.string('route').notNullable(); // which endpoint detected this, e.g. 'orders.to-kitchen'
    table.integer('local_version').nullable(); // the version the CLIENT thought it was editing
    table.integer('server_version').nullable(); // the version actually on the server
    table.text('detail').nullable(); // free-form JSON -- e.g. submitted vs. computed total
    table.string('resolution').notNullable().defaultTo('rejected_stale_write');
    table.timestamp('resolved_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.index(['tenant_id', 'entity_type', 'entity_id']);
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('sync_conflicts');
  if (hasTable) await knex.schema.dropTable('sync_conflicts');
};
