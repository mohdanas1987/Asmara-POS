'use strict';
/**
 * Offline-first foundation (project audit 2026-09-15, task "Offline-first foundation
 * (outbox + sync engine)").
 *
 * IMPORTANT CONTEXT this migration is built against (verified in RestaurantOS-Desktop/main.js
 * before writing any of this): the currently-deployed app always spawns server.local.js,
 * which is entirely SQLite-per-terminal -- orders, tables, and kitchen tickets already never
 * leave the machine, so the core POS loop already works with zero internet. The REAL,
 * currently-existing gap this migration addresses is that TWO terminals in the same
 * restaurant have two completely separate, never-synced databases today -- move an order on
 * terminal A and terminal B never finds out. This is also the same primitive a future
 * cloud-connected backend or a payments/website retry queue would need, so it's built as a
 * general append-only change log + generic retry outbox, not something LAN-sync-specific.
 *
 *   - terminals: identity for each physical POS terminal that has ever talked to this
 *     database (a terminal generates its own UUID once and persists it locally -- see
 *     services/offline/terminalIdentity.js -- so restarts don't create a new identity).
 *   - sync_log: an append-only record of every meaningful write, with a per-entity
 *     monotonic `version` so a peer terminal (or a future cloud backend) can ask "what
 *     changed since version N for this entity" and apply changes in the correct order,
 *     with last-write-wins conflict resolution using `version`.
 *   - outbox: a generic retry queue for OUTBOUND deliveries to any target (a peer terminal
 *     on the LAN, a future cloud API, a payment gateway, the public website webhook) --
 *     shared machinery so payments/website integrations can reuse the same retry/backoff
 *     logic instead of each hand-rolling their own.
 */
exports.up = async function up(knex) {
  const hasTerminals = await knex.schema.hasTable('terminals');
  if (!hasTerminals) {
    await knex.schema.createTable('terminals', (table) => {
      table.string('id', 36).primary(); // UUID, generated once per physical terminal
      table.integer('tenant_id').notNullable();
      table.string('name').nullable(); // e.g. "Front Counter", "Bar" -- set by staff, not required
      table.timestamp('last_seen_at').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  const hasSyncLog = await knex.schema.hasTable('sync_log');
  if (!hasSyncLog) {
    await knex.schema.createTable('sync_log', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').notNullable();
      table.string('terminal_id', 36).notNullable(); // which terminal made this change
      table.string('entity_type').notNullable(); // 'table' | 'order' | 'kitchen_ticket' | ...
      table.string('entity_id').notNullable();
      table.string('operation').notNullable(); // 'create' | 'update' | 'delete'
      table.text('payload').notNullable(); // JSON snapshot of the entity after the change
      table.integer('version').notNullable(); // monotonic per (tenant_id, entity_type, entity_id)
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['tenant_id', 'id']); // the cursor peers page through, in insertion order
      table.index(['tenant_id', 'entity_type', 'entity_id']);
    });
  }

  const hasOutbox = await knex.schema.hasTable('outbox');
  if (!hasOutbox) {
    await knex.schema.createTable('outbox', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').notNullable();
      table.string('target_type').notNullable(); // 'peer_terminal' | 'cloud' | 'payment_gateway' | 'website'
      table.string('target_url').nullable();
      table.text('payload').notNullable(); // JSON body to deliver
      table.string('status').notNullable().defaultTo('pending'); // pending | sent | failed
      table.integer('attempts').notNullable().defaultTo(0);
      table.timestamp('next_attempt_at').nullable();
      table.text('last_error').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('sent_at').nullable();
      table.index(['tenant_id', 'status']);
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('outbox')) await knex.schema.dropTable('outbox');
  if (await knex.schema.hasTable('sync_log')) await knex.schema.dropTable('sync_log');
  if (await knex.schema.hasTable('terminals')) await knex.schema.dropTable('terminals');
};
