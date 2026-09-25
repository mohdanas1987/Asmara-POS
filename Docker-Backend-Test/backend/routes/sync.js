'use strict';
/**
 * LAN multi-terminal sync + generic outbox status (project audit 2026-09-15, task
 * "Offline-first foundation (outbox + sync engine)").
 */
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const fetchuser = require('../middlewares/loggedIn');
const { getChangesSince } = require('../services/offline/syncLog');
const { getStatus } = require('../services/offline/outbox');
const { listConflicts } = require('../services/conflictLog');
const { pushMutation, getCursor, setCursor } = require('../services/offline/syncMutations');
const { roleHasPermissionForTenant, PERMISSIONS } = require('../config/permissions');
const Model = require('objection').Model;

// Which permission a mutation of a given entity_type requires -- mirrors the permission the
// dedicated route for that entity already enforces (routes/tables.js's /update-position uses
// SETTINGS_MANAGE for table_layout edits; routes/items.js's /update uses MENU_MANAGE for menu
// edits), kept in sync here rather than gating the whole route behind one static permission,
// since a single POST /sync/push batch can carry mutations for either entity type.
const ENTITY_PERMISSION = {
    table_layout: PERMISSIONS.SETTINGS_MANAGE,
    menu_item: PERMISSIONS.MENU_MANAGE,
};

function knex() {
  return Model.knex();
}

// A terminal announces itself (on boot, and periodically as a heartbeat) so the restaurant
// has a real picture of which physical terminals exist and when each was last seen.
router.post('/terminals/register', fetchuser, [
    body('terminal_id').isString().isLength({ min: 1 }),
    body('name').optional({ nullable: true }).isString(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        const existing = await knex()('terminals').where('id', req.body.terminal_id).first();
        if (existing) {
            const updates = { last_seen_at: new Date().toISOString() };
            if (req.body.name !== undefined) updates.name = req.body.name;
            await knex()('terminals').where('id', req.body.terminal_id).update(updates);
        } else {
            await knex()('terminals').insert({
                id: req.body.terminal_id,
                tenant_id: req.body.tenant_id,
                name: req.body.name ?? null,
                last_seen_at: new Date().toISOString(),
            });
        }
        return res.json({ status: true });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

router.get('/terminals', fetchuser, async (req, res) => {
    try {
        const terminals = await knex()('terminals').where('tenant_id', req.body.tenant_id).orderBy('last_seen_at', 'desc');
        return res.json({ status: true, terminals });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// The core sync pull: "what changed since the last time I checked." A peer terminal (or a
// future cloud backend) stores the highest `id` it has already applied and passes it back
// as `since` on the next call -- this is the sync cursor, and it's just a sync_log row id,
// nothing more exotic than that.
router.get('/changes', fetchuser, async (req, res) => {
    try {
        const terminalId = req.query.terminal_id || req.body.terminal_id || null;
        // Durable cursor persistence (CTO doc, multi-terminal sync): a terminal normally
        // remembers its own `since` cursor locally and keeps passing it -- that's unchanged
        // and still the fast path below. But if a terminal calls this with NO `since` at all
        // (it lost its local state -- reinstalled, or a replacement device standing in under
        // the same terminal_id after a crash) and it identifies itself with `terminal_id`, we
        // fall back to what the SERVER last remembers handing that terminal, instead of either
        // silently restarting it from zero (re-processing everything) or leaving it stuck.
        let sinceId;
        if (req.query.since !== undefined) {
            sinceId = Number(req.query.since || 0);
        } else if (terminalId) {
            sinceId = await getCursor({ tenantId: req.body.tenant_id, terminalId });
        } else {
            sinceId = 0;
        }

        const changes = await getChangesSince({ tenantId: req.body.tenant_id, sinceId });
        const cursor = changes.length > 0 ? changes[changes.length - 1].id : sinceId;

        if (terminalId) {
            await setCursor({ tenantId: req.body.tenant_id, terminalId, cursor });
        }

        return res.json({
            status: true,
            changes: changes.map((c) => ({ ...c, payload: JSON.parse(c.payload) })),
            cursor,
        });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// The push half of the sync engine (ChatGPT CTO review, multi-terminal sync: "Missing: POST
// /sync/push, ACK contract, duplicate-replay protection, restart-safe retry"). A terminal
// that queued mutations while offline flushes them here once it's back online, one call, and
// gets back one ACK per mutation. See services/offline/syncMutations.js for the full
// per-entity-type policy this dispatches to, and for exactly which entity types this generic
// path will (table_layout, menu_item) and will not (order, payment, loyalty, table_claim --
// each of which already has its own correct, non-generic conflict strategy) apply.
//
// Mutations are processed IN ORDER, one at a time (not Promise.all) -- correctness here
// depends on each mutation seeing the version left behind by the one before it in the same
// batch, and ordering is exactly what a real outbox flush guarantees for one terminal's own
// queued actions anyway.
router.post('/push', fetchuser, [
    body('terminal_id').isString().isLength({ min: 1 }),
    body('mutations').isArray({ min: 1 }),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        const results = [];
        for (const m of req.body.mutations) {
            if (!m || !m.mutation_id || !m.entity_type || !m.entity_id || !m.operation) {
                results.push({ mutation_id: m?.mutation_id || null, accepted: false, server_version: null, reason: 'malformed_mutation' });
                continue;
            }

            // Per-entity-type permission check (see ENTITY_PERMISSION above) -- done here,
            // in-handler, rather than as one static requirePermission(...) on the whole route,
            // because a single push batch can mix entity types that require different
            // permissions. An entity type this engine doesn't handle at all (order/payment/
            // loyalty/table_claim) has no permission entry and is refused by pushMutation
            // itself with 'unsupported_entity_type', never reaching a mutating code path.
            const requiredPermission = ENTITY_PERMISSION[m.entity_type];
            if (requiredPermission) {
                // eslint-disable-next-line no-await-in-loop
                const allowed = await roleHasPermissionForTenant(req.body.tenant_id, req.authRole, requiredPermission);
                if (!allowed) {
                    results.push({ mutation_id: m.mutation_id, accepted: false, server_version: null, reason: 'forbidden' });
                    continue;
                }
            }

            // eslint-disable-next-line no-await-in-loop
            const ack = await pushMutation({
                tenantId: req.body.tenant_id,
                terminalId: req.body.terminal_id,
                mutationId: m.mutation_id,
                entityType: m.entity_type,
                entityId: m.entity_id,
                operation: m.operation,
                payload: m.payload,
                baseVersion: m.base_version,
            });
            results.push(ack);
        }

        return res.json({ status: true, results });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Conflict records (CTO doc "Asmara POS -- Remaining Work Only", Phase 21/item 2): a durable,
// queryable list of every rejected stale write / mismatched total this tenant has hit -- see
// migrations_local/0027 and services/conflictLog.js. Powers a future reconciliation screen;
// until that UI exists, this is still real, usable data an admin can pull directly.
router.get('/conflicts', fetchuser, async (req, res) => {
    try {
        const conflicts = await listConflicts({ tenantId: req.body.tenant_id, entityType: req.query.entity_type });
        return res.json({ status: true, conflicts });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Powers an "offline / syncing / synced" indicator in the UI: how many outbound
// deliveries are still pending or have permanently failed, broken down by target.
router.get('/status', fetchuser, async (req, res) => {
    try {
        const outboxStatus = await getStatus({ tenantId: req.body.tenant_id });
        return res.json({ status: true, outbox: outboxStatus });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

module.exports = router;
