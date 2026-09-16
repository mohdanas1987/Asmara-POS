'use strict';
/**
 * Kitchen stations + KDS-ready tickets (project audit 2026-09-15, task "Kitchen ticket
 * routing as its own domain"). Complements, does not replace, the existing order-status
 * kitchen flow in routes/orders.js.
 */
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const fetchuser = require('../middlewares/loggedIn');
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const KitchenStation = require('../models/KitchenStation');
const KitchenTicket = require('../models/KitchenTicket');

const TICKET_STATUSES = ['pending', 'preparing', 'ready', 'served'];

// --- Stations -------------------------------------------------------------

router.get('/stations', fetchuser, requirePermission(PERMISSIONS.KITCHEN_VIEW), async (req, res) => {
    try {
        const stations = await KitchenStation.forTenant(req.body.tenant_id).orderBy('id');
        return res.json({ status: true, stations });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

router.post('/stations', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), [
    body('name').isLength({ min: 1 }),
    body('printer_id').optional({ nullable: true }).isString(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ status: false, message: errors.array()[0].msg });
        }
        const station = await KitchenStation.query().insert({
            tenant_id: req.body.tenant_id,
            name: req.body.name,
            printer_id: req.body.printer_id ?? null,
            is_default: false,
        });
        return res.json({ status: true, station });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

router.patch('/stations/:id', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), [
    body('name').optional().isLength({ min: 1 }),
    body('printer_id').optional({ nullable: true }).isString(),
], async (req, res) => {
    try {
        const station = await KitchenStation.forTenant(req.body.tenant_id).where('id', req.params.id).first();
        if (!station) return res.status(404).json({ status: false, message: 'Station not found.' });

        const updates = {};
        if (req.body.name !== undefined) updates.name = req.body.name;
        if (req.body.printer_id !== undefined) updates.printer_id = req.body.printer_id;
        await KitchenStation.query().where('id', station.id).update(updates);
        return res.json({ status: true, message: 'Station updated.' });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// --- Tickets (KDS) ----------------------------------------------------------

// Polled by the Kitchen Display screen. Optionally filter by station and/or status.
router.get('/tickets', fetchuser, requirePermission(PERMISSIONS.KITCHEN_VIEW), async (req, res) => {
    try {
        let q = KitchenTicket.forTenant(req.body.tenant_id).orderBy('created_at', 'asc');
        if (req.query.station_id) q = q.where('station_id', req.query.station_id);
        if (req.query.status) q = q.where('status', req.query.status);
        const tickets = await q;
        return res.json({
            status: true,
            tickets: tickets.map((t) => ({ ...t, items: JSON.parse(t.items || '[]') })),
        });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

router.patch('/tickets/:id', fetchuser, requirePermission(PERMISSIONS.KITCHEN_VIEW), [
    body('status').isIn(TICKET_STATUSES),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ status: false, message: `status must be one of: ${TICKET_STATUSES.join(', ')}` });
        }
        const ticket = await KitchenTicket.forTenant(req.body.tenant_id).where('id', req.params.id).first();
        if (!ticket) return res.status(404).json({ status: false, message: 'Ticket not found.' });

        await KitchenTicket.query().where('id', ticket.id).update({ status: req.body.status });
        return res.json({ status: true, message: `Ticket marked ${req.body.status}.` });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Called by the Electron main process after it attempts a physical print (see hardware.js's
// print()), so a jammed/offline printer shows up on the KDS instead of silently vanishing.
router.post('/tickets/:id/print-result', fetchuser, [
    body('success').isBoolean(),
    body('error').optional({ nullable: true }).isString(),
], async (req, res) => {
    try {
        const ticket = await KitchenTicket.forTenant(req.body.tenant_id).where('id', req.params.id).first();
        if (!ticket) return res.status(404).json({ status: false, message: 'Ticket not found.' });

        const updates = req.body.success
            ? { printed_at: new Date().toISOString(), print_error: null }
            : { print_error: req.body.error || 'Unknown print failure' };
        await KitchenTicket.query().where('id', ticket.id).update(updates);
        return res.json({ status: true });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

router.post('/tickets/:id/reprint', fetchuser, requirePermission(PERMISSIONS.KITCHEN_VIEW), async (req, res) => {
    try {
        const ticket = await KitchenTicket.forTenant(req.body.tenant_id).where('id', req.params.id).first();
        if (!ticket) return res.status(404).json({ status: false, message: 'Ticket not found.' });

        await KitchenTicket.query().where('id', ticket.id).update({
            reprint_count: (ticket.reprint_count || 0) + 1,
            print_error: null,
            printed_at: null, // Electron side sees printed_at cleared and knows to print again
        });
        return res.json({ status: true, message: 'Ticket queued for reprint.' });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

module.exports = router;
