'use strict';
/**
 * Conflict records (CTO doc "Asmara POS -- Remaining Work Only", Phase 21/item 2). See
 * migrations_local/0027's header comment for the schema rationale.
 *
 * Best-effort, same pattern as every other non-critical side effect in this codebase
 * (auditLog, loyalty earning, offline sync's recordChange): a logging failure must never
 * change the actual conflict-rejection response the caller already decided on.
 */
const Model = require('objection').Model;
function knex() {
  return Model.knex();
}

async function recordConflict({
  tenantId, entityType, entityId, terminalId, route, localVersion, serverVersion, detail, resolution,
}) {
  try {
    await knex()('sync_conflicts').insert({
      tenant_id: tenantId,
      entity_type: entityType,
      entity_id: String(entityId),
      terminal_id: terminalId ?? null,
      route,
      local_version: localVersion ?? null,
      server_version: serverVersion ?? null,
      detail: detail !== undefined ? JSON.stringify(detail) : null,
      resolution: resolution || 'rejected_stale_write',
      resolved_at: new Date().toISOString(),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log('[conflict-log] non-fatal: could not record conflict', entityType, entityId, err.message);
  }
}

async function listConflicts({ tenantId, entityType, limit = 200 }) {
  let query = knex()('sync_conflicts').where('tenant_id', tenantId).orderBy('created_at', 'desc').limit(Math.min(Number(limit) || 200, 500));
  if (entityType) query = query.where('entity_type', entityType);
  const rows = await query;
  return rows.map((row) => ({ ...row, detail: row.detail ? JSON.parse(row.detail) : null }));
}

module.exports = { recordConflict, listConflicts };
