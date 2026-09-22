'use strict';
/**
 * Audit event log (CTO forensic audit 2026-09-21, P1 "Complete audit-event coverage"). See
 * migrations_local/0020_audit_events.js for why this exists and what it's for.
 *
 * `record()` is deliberately best-effort, same pattern as every other non-critical side
 * effect in this codebase (loyalty earning, offline sync's recordChange, kitchen routing): a
 * logging failure must never roll back or block the real business operation it's describing.
 * Callers should call this AFTER the real operation has already succeeded.
 */
const AuditEvent = require('../models/AuditEvent');

async function record({ tenantId, actorUserId, actorRole, eventType, entityType, entityId, payload }) {
    try {
        await AuditEvent.query().insert({
            tenant_id: tenantId,
            actor_user_id: actorUserId ?? null,
            actor_role: actorRole ?? null,
            event_type: eventType,
            entity_type: entityType,
            entity_id: entityId !== undefined && entityId !== null ? String(entityId) : null,
            payload: payload !== undefined ? JSON.stringify(payload) : null,
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.log('[audit-log] non-fatal: could not record audit event', eventType, err.message);
    }
}

async function list({ tenantId, eventType, limit = 200 }) {
    let query = AuditEvent.forTenant(tenantId).orderBy('created_at', 'desc').limit(Math.min(Number(limit) || 200, 500));
    if (eventType) query = query.where('event_type', eventType);
    const rows = await query;
    return rows.map((row) => ({ ...row, payload: row.payload ? JSON.parse(row.payload) : null }));
}

module.exports = { record, list };
