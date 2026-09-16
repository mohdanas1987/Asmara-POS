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
const Model = require('objection').Model;

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
        const sinceId = Number(req.query.since || 0);
        const changes = await getChangesSince({ tenantId: req.body.tenant_id, sinceId });
        return res.json({
            status: true,
            changes: changes.map((c) => ({ ...c, payload: JSON.parse(c.payload) })),
            cursor: changes.length > 0 ? changes[changes.length - 1].id : sinceId,
        });
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
