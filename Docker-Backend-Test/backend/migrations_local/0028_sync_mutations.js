'use strict';
/**
 * Generic bidirectional sync-mutation engine (ChatGPT CTO review, "Asmara POS -- Remaining
 * Work Only", multi-terminal sync item: "Missing: POST /sync/push, ACK contract (mutation_id/
 * accepted/server_version/cursor), remote mutation application, duplicate-replay protection,
 * durable cursor persistence, delete/tombstone propagation, restart-safe retry, convergence").
 *
 * GROUND TRUTH before writing this: `sync_log` (migration 0011) already gives this app a real,
 * ordered, pollable change feed (GET /sync/changes) -- that half of sync already existed and
 * is unchanged. What was actually missing was the PUSH side: a terminal that made a change
 * OFFLINE needs a durable, idempotent way to hand that change to the server once it's back
 * online, get back a definitive accept/reject + the resulting version, and never have a
 * retried push (because the terminal never saw the first ACK, e.g. it crashed or the network
 * dropped mid-response) double-apply. That's what `sync_mutations` is for.
 *
 * `sync_mutations` is NOT a replacement for `orders.version`/`tables.version` optimistic
 * locking or the order/payment routes' own `expected_version` checks -- those are unchanged
 * and remain the path for order/payment/table-claim mutations (see
 * services/offline/syncMutations.js's ENTITY_POLICIES for the explicit, enforced list of
 * entity types this generic engine will and will not touch, and why). This table backs the
 * generic push path for simpler entities without complex side effects (today: table floor-plan
 * layout, menu item fields) -- exactly the scope the sync-engine planning called for.
 *
 * `terminal_cursors` is the durable half of "durable cursor persistence": today a terminal
 * remembers its own `since` cursor locally and passes it on every GET /sync/changes call --
 * that continues to work unchanged. This table additionally lets the SERVER remember the last
 * cursor it handed a given terminal, so a terminal that lost its local state (reinstalled, or
 * a fresh device standing in for a crashed one under the same terminal_id) can call GET
 * /sync/changes?terminal_id=X with no `since` at all and resume from where the server last
 * left it, rather than silently re-reading from zero or being stuck unable to resume.
 */
exports.up = async function up(knex) {
  const hasMutations = await knex.schema.hasTable('sync_mutations');
  if (!hasMutations) {
    await knex.schema.createTable('sync_mutations', (table) => {
      table.increments('id').primary();
      table.bigInteger('tenant_id').notNullable();
      table.string('mutation_id').notNullable(); // client-generated, stable across retries
      table.string('terminal_id').notNullable();
      table.string('entity_type').notNullable(); // 'table_layout' | 'menu_item' | ...
      table.string('entity_id').notNullable();
      table.string('operation').notNullable(); // 'update' | 'delete'
      table.text('payload').nullable(); // the mutation's own JSON payload, as submitted
      table.integer('base_version').nullable(); // the version the terminal thought it was editing
      table.integer('server_version').nullable(); // the resulting (or current, if rejected) version
      table.string('status').notNullable(); // 'applied' | 'rejected'
      table.text('detail').nullable(); // free-form JSON, e.g. why a rejection happened
      table.timestamp('created_at').defaultTo(knex.fn.now());
      // The core idempotency guarantee: the SAME mutation_id from the SAME terminal can be
      // pushed any number of times (crash-and-retry, duplicate network delivery, an outbox
      // replaying) and will only ever be applied once -- every subsequent push just re-reads
      // this row and returns the exact same ACK it returned the first time ("apply once, ACK
      // as many times as asked").
      table.unique(['tenant_id', 'terminal_id', 'mutation_id']);
      table.index(['tenant_id', 'entity_type', 'entity_id']);
    });
  }

  const hasCursors = await knex.schema.hasTable('terminal_cursors');
  if (!hasCursors) {
    await knex.schema.createTable('terminal_cursors', (table) => {
      table.increments('id').primary();
      table.bigInteger('tenant_id').notNullable();
      table.string('terminal_id').notNullable();
      table.bigInteger('cursor').notNullable().defaultTo(0);
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.unique(['tenant_id', 'terminal_id']);
    });
  }

  // Menu items don't have a version column yet -- needed for version-based replacement sync
  // (the CTO doc's own suggested, accepted strategy for the menu entity type: "Menu ->
  // version-based replacement is acceptable").
  const hasMenuVersion = await knex.schema.hasColumn('menu_items', 'version');
  if (!hasMenuVersion) {
    await knex.schema.alterTable('menu_items', (table) => {
      table.integer('version').notNullable().defaultTo(1);
    });
  }
};

exports.down = async function down(knex) {
  const hasCursors = await knex.schema.hasTable('terminal_cursors');
  if (hasCursors) await knex.schema.dropTable('terminal_cursors');

  const hasMutations = await knex.schema.hasTable('sync_mutations');
  if (hasMutations) await knex.schema.dropTable('sync_mutations');

  const hasMenuVersion = await knex.schema.hasColumn('menu_items', 'version');
  if (hasMenuVersion) {
    await knex.schema.alterTable('menu_items', (table) => {
      table.dropColumn('version');
    });
  }
};
