const express = require("express");
const { transaction } = require('objection');
const Table = require('../models/Table');
const Order = require('../models/Order');
const Reservation = require('../models/Reservation');
const fetchuser = require('../middlewares/loggedIn');
const { logger } = require('../utils/logger');
const { recordChange } = require('../services/offline/syncLog');
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const { body, validationResult } = require('express-validator');
const router = express.Router();

let error = { status: false, message: 'Something went wrong!' }

// STAGE 2 / phase 18 (Auth-middleware gap closure): this entire route file previously had
// ZERO authentication on ANY route, including /free-all, which reset every table in the
// restaurant to "free" on a single unauthenticated GET request. `fetchuser` is now applied
// to every route below. Behavior is otherwise unchanged.
//
// STAGE 2 / phase 19 (HTTP-verb correction): the state-changing routes that were GET
// (/split-table/:table_number, /free-all) keep their original GET handler working, unchanged,
// so the current compiled frontend (which we do not have editable source for) keeps working
// exactly as before. A second, correctly-verbed route is added alongside each one. Once the
// frontend is rebuilt to call the new verb, the GET alias should be removed — tracked as a
// follow-up, not done in this phase, per the Bible's "preserve working behaviour" rule.

router.get('/', fetchuser, async (req, res) => {
    try {
        let cls = {
            free: 'success',
            reserved: 'primary',
            'order ongoing': 'warning'
        }
        const tables = await Table.query().where('tenant_id', req.body.tenant_id).select(['id', 'table_number', 'length', 'width', 'x', 'y', 'status', 'linked_to', 'capacity', 'section']);
        return res.json({
            status: true,
            tables: tables.map(t => ({ ...t, className: cls[t.status] ?? 'danger' }))
        });

    } catch (e) {
        console.log("exception occured: ", e);
        error.message = e.message;
        return res.status(400).json(error);
    }
});


router.get('/reservations', fetchuser, async (req, res) => {
    try {
        const reservations = await Reservation.query().where('tenant_id', req.body.tenant_id).select('*');
        return res.json({
            status: true,
            reservations
        });

    } catch (e) {
        console.log("exception occured: ", e);
        error.message = e.message;
        return res.status(400).json(error);
    }
});



router.post('/update-position/:table', fetchuser, async (req, res) => {
    try {

        let tables = req.params.table.split('+');

        const updated = await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tables).patch({
            x: req.body.x,
            y: req.body.y,
        });

        return res.json({ status: true, message: "Position updated", update: updated });

    } catch (err) {
        console.log(err.message);
        return res.status(500).json({ ...error, message: err.message });
    }
});

async function splitTableHandler(req, res) {
    try {
        const tables = req.params.table_number.split('+');
        const updated = await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tables).patch({
            linked_to: null
        });

        const order = await Order.query().where('tenant_id', req.body.tenant_id).where('tables', req.params.table_number).first();
        if (order && order.status === 'ongoing') {
            await Order.query().deleteById(order.id).where('tenant_id', req.body.tenant_id);
        }

        await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tables).update({
            status: "free"
        });

        return res.json({
            status: true,
            message: "Tables freed",
            updated
        });

    } catch (error) {
        console.log(error.message);
        return res.json({
            status: false,
            message: error.message
        })
    }
}
// Original route, now authenticated. Kept for the current frontend build.
router.get('/split-table/:table_number', fetchuser, splitTableHandler);
// Correctly-verbed replacement (this splits/frees tables — a mutation, not a read).
router.post('/split-table/:table_number', fetchuser, splitTableHandler);

async function freeAllHandler(req, res) {
    try {
        await Table.query().where('tenant_id', req.body.tenant_id).patch({
            status: 'free'
        });
        return res.json({
            status: true,
            message: "Tables are free"
        })
    } catch (error) {
        return res.json({
            status: false,
            message: error.message
        })
    }
}
// Original route, now authenticated (previously this reset every table with a bare GET, no auth at all).
router.get('/free-all', fetchuser, freeAllHandler);
// Correctly-verbed replacement.
router.post('/free-all', fetchuser, freeAllHandler);

// STAGE 2 / phase 24 (Table transfer -- new feature, not a preserved/legacy route, so it is
// built correctly from the start: authenticated, correctly-verbed, wrapped in a real
// database transaction so a mid-way failure can never leave one table "vacated" and the
// other not updated, and logged.
//
// Scope: moves the single active (non-completed) order sitting on `from_table` onto
// `to_table`, which must currently be free. Deliberately does NOT handle merged tables
// (a `tables` value containing "+") in this pass -- transferring a merged group correctly
// means deciding how each individual table in the group should behave, which needs product
// input, not just backend plumbing. A merged-table transfer request is rejected with a
// clear message rather than guessed at. This is a backend-only feature: the current
// compiled frontend has no UI for it yet (its source is not available to add one in this
// stage) -- it is reachable today via a direct API call, and ready for a UI once the
// frontend is rebuilt.
// Table/Floor management redesign (project audit 2026-09-15): seat count and section are
// floor-plan SETUP, not day-to-day POS operation, so this is gated by settings.manage (same
// tier as kitchen station configuration) rather than tables.manage.
router.patch('/:table_number/details', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), [
    body('capacity').optional({ nullable: true }).isInt({ min: 1 }),
    body('section').optional({ nullable: true }).isString(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        const table = await Table.query().where('tenant_id', req.body.tenant_id).where('table_number', req.params.table_number).first();
        if (!table) return res.status(404).json({ status: false, message: `Table ${req.params.table_number} not found.` });

        const updates = {};
        if (req.body.capacity !== undefined) updates.capacity = req.body.capacity;
        if (req.body.section !== undefined) updates.section = req.body.section;
        await Table.query().where('id', table.id).update(updates);
        return res.json({ status: true, message: 'Table details updated.' });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Frees one or more SPECIFIC tables (supports "1+2" for a merged group), as opposed to
// /free-all which resets the entire floor -- the plan's "free selected" requirement.
// Deliberately does not touch or cancel any order sitting on these tables (same caution as
// the existing /free-all: a blunt status reset, not an order-completion flow -- use
// /orders/finish or /orders/cancel for that).
router.post('/free/:table_numbers', fetchuser, requirePermission(PERMISSIONS.TABLES_MANAGE), async (req, res) => {
    try {
        const tableNumbers = req.params.table_numbers.split('+');
        const updated = await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tableNumbers).patch({
            status: 'free',
            linked_to: null,
        });
        return res.json({ status: true, message: `${tableNumbers.length === 1 ? 'Table' : 'Tables'} freed.`, updated });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

router.post('/transfer', fetchuser, async (req, res) => {
    const { from_table, to_table } = req.body;

    if (!from_table || !to_table) {
        return res.status(400).json({ status: false, message: "from_table and to_table are both required." });
    }
    if (from_table === to_table) {
        return res.status(400).json({ status: false, message: "from_table and to_table must be different." });
    }
    if (String(from_table).includes('+') || String(to_table).includes('+')) {
        return res.status(400).json({
            status: false,
            message: "Transferring merged/linked tables isn't supported yet -- split the tables first, then transfer."
        });
    }

    try {
        const tenantId = req.body.tenant_id;
        const result = await transaction(Table, Order, async (TableTx, OrderTx) => {
            const source = await TableTx.query().where('tenant_id', tenantId).where('table_number', from_table).first();
            if (!source) {
                throw Object.assign(new Error(`Table ${from_table} does not exist.`), { statusCode: 404 });
            }

            const destination = await TableTx.query().where('tenant_id', tenantId).where('table_number', to_table).first();
            if (!destination) {
                throw Object.assign(new Error(`Table ${to_table} does not exist.`), { statusCode: 404 });
            }
            if (destination.status !== 'free') {
                throw Object.assign(new Error(`Table ${to_table} is not free (status: ${destination.status}).`), { statusCode: 409 });
            }

            const order = await OrderTx.query()
                .where('tenant_id', tenantId)
                .where('tables', from_table)
                .whereNot('status', 'completed')
                .first();
            if (!order) {
                throw Object.assign(new Error(`No active order found on table ${from_table}.`), { statusCode: 404 });
            }

            const updatedOrder = await OrderTx.query().patchAndFetchById(order.id, {
                tables: to_table
            });

            await TableTx.query().findById(destination.id).patch({
                status: source.status,
                linked_to: null
            });

            await TableTx.query().findById(source.id).patch({
                status: 'free',
                linked_to: null
            });

            return updatedOrder;
        });

        logger.info('table.transfer', { from_table, to_table, order_id: result.id, user_id: req.body.myID });

        // Offline-first foundation (project audit 2026-09-15): record this as a change any
        // other terminal in the restaurant can pull via GET /sync/changes, so a table
        // transfer made on the front counter terminal is visible to the bar terminal too.
        // Best-effort, same pattern as kitchen routing and loyalty earning above -- a
        // logging failure here must never undo an already-committed table transfer.
        try {
            await recordChange({
                tenantId,
                terminalId: req.body.terminal_id || 'unknown-terminal',
                entityType: 'table_transfer',
                entityId: result.id,
                operation: 'update',
                payload: { from_table, to_table, order_id: result.id },
            });
        } catch (syncError) {
            console.log('[offline-sync] non-fatal: could not record table transfer change:', syncError.message);
        }

        return res.json({
            status: true,
            message: `Order transferred from table ${from_table} to table ${to_table}.`,
            order: result
        });

    } catch (e) {
        const statusCode = e.statusCode || 500;
        if (statusCode >= 500) {
            logger.error('table.transfer.failed', { from_table, to_table, message: e.message });
        }
        return res.status(statusCode).json({ status: false, message: e.message });
    }
});

module.exports = router
