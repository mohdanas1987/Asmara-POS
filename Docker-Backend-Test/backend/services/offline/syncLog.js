'use strict';
/**
 * Append-only change log (project audit 2026-09-15, task "Offline-first foundation").
 *
 * The single source of truth for "what changed and in what order" that both LAN
 * multi-terminal sync (routes/sync.js) and any future cloud sync can consume by pulling
 * rows since a cursor. Deliberately never updated or deleted -- if two terminals disagree
 * about an entity's current state, `version` (monotonic per entity) is what resolves it:
 * whichever change has the highest version for that entity wins (last-write-wins), not
 * whichever arrived first over the network.
 */
const Model = require('objection').Model;

function knex() {
  return Model.knex();
}

/**
 * Records one change and returns the sync_log row (including the new version number).
 * Call this from a route AFTER the actual write succeeds -- never before, and never let a
 * sync-log failure roll back or block the real write it's describing (see routes/tables.js
 * for the wrapped, best-effort call pattern, same as kitchen routing and loyalty earning).
 */
async function recordChange({ tenantId, terminalId, entityType, entityId, operation, payload }) {
  const db = knex();
  const lastVersionRow = await db('sync_log')
    .where({ tenant_id: tenantId, entity_type: entityType, entity_id: String(entityId) })
    .max('version as maxVersion')
    .first();
  const nextVersion = (lastVersionRow?.maxVersion || 0) + 1;

  const [id] = await db('sync_log').insert({
    tenant_id: tenantId,
    terminal_id: terminalId,
    entity_type: entityType,
    entity_id: String(entityId),
    operation,
    payload: JSON.stringify(payload ?? {}),
    version: nextVersion,
  });

  return db('sync_log').where('id', id).first();
}

/**
 * Changes for a tenant since a given sync_log row id (the "cursor" a peer terminal
 * remembers between polls). Ordered by id so a peer that goes down mid-sync can resume
 * exactly where it left off without re-processing or skipping anything.
 */
async function getChangesSince({ tenantId, sinceId = 0, limit = 500 }) {
  return knex()('sync_log')
    .where('tenant_id', tenantId)
    .where('id', '>', sinceId)
    .orderBy('id', 'asc')
    .limit(limit);
}

module.exports = { recordChange, getChangesSince };
