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
const auditLog = require('../services/auditLog');
const { recordTableEventSafe } = require('../services/orderHistory');
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
        const tables = await Table.query().where('tenant_id', req.body.tenant_id).select(['id', 'table_number', 'length', 'width', 'x', 'y', 'status', 'linked_to', 'capacity', 'section', 'assigned_server_id']);
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



router.post('/update-position/:table', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
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

// CTO forensic audit (2026-09-20): flagged as the concrete counterpart to table merging --
// merge (POST /orders/link/:tables) genuinely works, but the only thing that existed to undo
// it was this handler, and it was destructive: it unlinked the tables AND deleted whatever
// order was already running on the merged group outright, discarding real, already-ordered
// items with no way back. That's not a "split" a restaurant can actually use mid-service --
// it's a forced cancel. Rewritten so a genuine merged-group split (table_number containing
// "+") keeps the running order alive on ONE chosen table (`keep_on` in the body, defaulting
// to the first table in the group) and simply frees the others, instead of deleting anything.
// A single, non-merged table_number (no "+") is UNCHANGED from before this fix -- some caller
// may already depend on that as a hard "cancel and free this table" operation, and this fix
// is scoped to the actual merged-table-split gap, not a rewrite of unrelated behavior.
async function splitTableHandler(req, res) {
    try {
        const tableNumber = req.params.table_number;
        const tables = tableNumber.split('+');
        const isMergedGroup = tables.length > 1;

        if (isMergedGroup) {
            const requestedKeepOn = req.body && req.body.keep_on;
            const keepOn = requestedKeepOn && tables.includes(requestedKeepOn) ? requestedKeepOn : tables[0];
            const freedTables = tables.filter((t) => t !== keepOn);

            const order = await Order.query()
                .where('tenant_id', req.body.tenant_id)
                .where('tables', tableNumber)
                .whereNot('status', 'completed')
                .first();

            await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tables).patch({
                linked_to: null
            });

            if (order) {
                // The order that used to span the whole merged group now belongs to just the
                // one table the cashier chose to keep it on -- exactly like a single-table
                // order, and fully resumable from the POS the same way (GET /orders/'s
                // tableOrders map already indexes by individual table number, so this needs
                // no other change to be picked up correctly).
                await Order.query().patchAndFetchById(order.id, { tables: keepOn }).where('tenant_id', req.body.tenant_id);
                await Table.query().where('tenant_id', req.body.tenant_id).where('table_number', keepOn).patch({ status: 'occupied' });

                // Order domain normalization phase 2 (CTO feedback 2026-09-22, item 8):
                // record the surviving order's table reassignment from the split.
                recordTableEventSafe({
                    tenantId: req.body.tenant_id,
                    orderId: order.id,
                    fromTable: tableNumber,
                    toTable: keepOn,
                    eventType: 'split',
                    userId: req.body.myID,
                });
            } else {
                await Table.query().where('tenant_id', req.body.tenant_id).where('table_number', keepOn).patch({ status: 'free' });
            }

            if (freedTables.length > 0) {
                await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', freedTables).patch({ status: 'free' });
            }

            try {
                await recordChange({
                    tenantId: req.body.tenant_id,
                    terminalId: req.body.terminal_id || 'unknown-terminal',
                    entityType: 'table_split',
                    entityId: tableNumber,
                    operation: 'update',
                    payload: { tables, keep_on: keepOn, freed: freedTables, order_id: order ? order.id : null },
                });
            } catch (syncError) {
                console.log('[offline-sync] non-fatal: could not record table split change:', syncError.message);
            }

            // Complete audit coverage (CTO doc "Asmara POS -- Remaining Work Only", item 6:
            // "table merge/split" named as a remaining gap). recordChange above is for offline
            // sync propagation between terminals; this is the actual reviewable audit trail.
            auditLog.record({
                tenantId: req.body.tenant_id,
                actorUserId: req.body.myID,
                actorRole: req.authRole,
                eventType: 'table.split',
                entityType: 'table',
                entityId: tableNumber,
                payload: { tables, keep_on: keepOn, freed: freedTables, order_id: order ? order.id : null },
            });

            return res.json({
                status: true,
                message: order
                    ? `Tables split -- the running order stays on table ${keepOn}, the rest are now free.`
                    : "Tables split and freed.",
                keptOn: keepOn,
                freed: freedTables,
            });
        }

        // Single, non-merged table -- unchanged legacy behavior.
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
router.get('/split-table/:table_number', fetchuser, requirePermission(PERMISSIONS.TABLES_MANAGE), splitTableHandler);
// Correctly-verbed replacement (this splits/frees tables — a mutation, not a read).
router.post('/split-table/:table_number', fetchuser, requirePermission(PERMISSIONS.TABLES_MANAGE), splitTableHandler);

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
router.get('/free-all', fetchuser, requirePermission(PERMISSIONS.TABLES_MANAGE), freeAllHandler);
// Correctly-verbed replacement.
router.post('/free-all', fetchuser, requirePermission(PERMISSIONS.TABLES_MANAGE), freeAllHandler);

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

router.post('/transfer', fetchuser, requirePermission(PERMISSIONS.TABLES_TRANSFER), async (req, res) => {
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

        // Order domain normalization phase 2 (CTO feedback 2026-09-22, item 8): record the
        // whole-order table transfer.
        recordTableEventSafe({
            tenantId,
            orderId: result.id,
            fromTable: from_table,
            toTable: to_table,
            eventType: 'transfer',
            userId: req.body.myID,
        });

        auditLog.record({
            tenantId,
            actorUserId: req.body.myID,
            actorRole: req.authRole,
            eventType: 'table.transfer',
            entityType: 'order',
            entityId: result.id,
            payload: { from_table, to_table },
        });

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


// Item-level table transfer (CTO forensic audit 2026-09-21, P1 "Item/seat-level table
// transfer" -- flagged as missing; POST /transfer above only ever moves a table's WHOLE
// order). This moves a SUBSET of the source order's lines to a brand-new order on the
// destination table, splitting the bill the same way "split by item" in PaymentModal.tsx
// already does -- by whole line, not by sub-quantity or an explicit seat number (there is
// no seat model in this schema yet; see the P1 tracker for that as its own, separate item).
//
// Pricing note: like every other order-total field in this app (order.total, /to-kitchen's
// `total`), the two post-split totals are supplied by the client, not recomputed here. This
// is a deliberate, existing trust boundary (the same one /to-kitchen and /orders/create both
// already rely on for their `total` field), not a new one introduced by this route --
// recomputing tax/pricing server-side from scratch is a larger, separate change this pass
// does not attempt. What IS re-validated here, same as everywhere else this session touched
// order lines, is that the split itself is structurally sound (real line indexes, at least
// one line on each side, a real active order, a real free destination table).
//
// Kitchen tickets already fired for the moved lines are deliberately left alone -- the food
// is physically being cooked/served at whichever table the ticket named, and it would be
// actively wrong for a bill-only move to also silently relabel where the kitchen thinks it's
// going. Only the bill (the order's `data`/`total`, and which table it belongs to) moves.
router.post('/transfer-items', fetchuser, requirePermission(PERMISSIONS.TABLES_TRANSFER), async (req, res) => {
    const { from_table, to_table, line_indexes, from_table_total, to_table_total } = req.body;

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
    if (!Array.isArray(line_indexes) || line_indexes.length === 0) {
        return res.status(400).json({ status: false, message: "line_indexes must be a non-empty array of line positions to move." });
    }
    if (typeof from_table_total !== 'number' || typeof to_table_total !== 'number' || from_table_total < 0 || to_table_total < 0) {
        return res.status(400).json({ status: false, message: "from_table_total and to_table_total are both required, non-negative numbers." });
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

            let data;
            try {
                data = typeof order.data === 'string' ? JSON.parse(order.data || '{}') : (order.data || {});
            } catch {
                throw Object.assign(new Error('This order\'s stored data could not be parsed -- cannot split it safely.'), { statusCode: 500 });
            }
            if (!Array.isArray(data.lines) || data.lines.length < 2) {
                throw Object.assign(new Error(
                    "This order has no per-line detail to split by (or only one line) -- item-level transfer needs at least 2 distinct lines. Use the whole-table transfer instead."
                ), { statusCode: 400 });
            }

            const uniqueIndexes = [...new Set(line_indexes.map(Number))];
            const inRange = uniqueIndexes.every((i) => Number.isInteger(i) && i >= 0 && i < data.lines.length);
            if (!inRange) {
                throw Object.assign(new Error(`line_indexes must all be valid positions between 0 and ${data.lines.length - 1}.`), { statusCode: 400 });
            }
            if (uniqueIndexes.length >= data.lines.length) {
                throw Object.assign(new Error("Every line was selected -- use the whole-table transfer instead of item-level transfer."), { statusCode: 400 });
            }

            const movingSet = new Set(uniqueIndexes);
            const movingLines = data.lines.filter((_, i) => movingSet.has(i));
            const remainingLines = data.lines.filter((_, i) => !movingSet.has(i));

            function quantityMapFor(lines) {
                const map = {};
                for (const line of lines) {
                    if (!line || line.itemId === undefined || line.itemId === null) continue;
                    const qty = Number(line.qty) || 1;
                    map[line.itemId] = (map[line.itemId] || 0) + qty;
                }
                return map;
            }

            const remainingData = { ...data, lines: remainingLines, quantity: quantityMapFor(remainingLines) };
            const movingData = { ...data, lines: movingLines, quantity: quantityMapFor(movingLines) };

            const updatedSourceOrder = await OrderTx.query().patchAndFetchById(order.id, {
                data: JSON.stringify(remainingData),
                total: from_table_total,
            });

            const createdOrder = await OrderTx.query().insert({
                customer_id: order.customer_id,
                cash_register_id: order.cash_register_id,
                user_id: req.body.myID,
                tables: to_table,
                tenant_id: tenantId,
                data: JSON.stringify(movingData),
                total: to_table_total,
                payment_mode: order.payment_mode,
            });
            const newOrder = await OrderTx.query().findById(createdOrder.id).where('tenant_id', tenantId);

            await TableTx.query().findById(destination.id).patch({ status: source.status, linked_to: null });
            // The source table keeps whatever status it already had (still occupied, since
            // remainingLines is guaranteed non-empty by the "every line selected" check above).

            return { sourceOrder: updatedSourceOrder, newOrder };
        });

        logger.info('table.transfer_items', {
            from_table, to_table,
            source_order_id: result.sourceOrder.id, new_order_id: result.newOrder.id,
            moved_line_count: line_indexes.length, user_id: req.body.myID,
        });

        // Order domain normalization phase 2 (CTO feedback 2026-09-22, item 8): the moved
        // lines land on a brand-new order record on the destination table -- record that as
        // the new order's table-opening event (analogous to /orders/init's 'open', but
        // originating from an item-level transfer rather than a fresh seating).
        recordTableEventSafe({
            tenantId: req.body.tenant_id,
            orderId: result.newOrder.id,
            fromTable: from_table,
            toTable: to_table,
            eventType: 'transfer',
            userId: req.body.myID,
        });

        auditLog.record({
            tenantId: req.body.tenant_id,
            actorUserId: req.body.myID,
            actorRole: req.authRole,
            eventType: 'table.transfer_items',
            entityType: 'order',
            entityId: result.newOrder.id,
            payload: { from_table, to_table, source_order_id: result.sourceOrder.id, moved_line_count: line_indexes.length },
        });

        try {
            await recordChange({
                tenantId: req.body.tenant_id,
                terminalId: req.body.terminal_id || 'unknown-terminal',
                entityType: 'table_transfer_items',
                entityId: result.newOrder.id,
                operation: 'create',
                payload: { from_table, to_table, source_order_id: result.sourceOrder.id, new_order_id: result.newOrder.id },
            });
        } catch (syncError) {
            console.log('[offline-sync] non-fatal: could not record item-level table transfer change:', syncError.message);
        }

        return res.json({
            status: true,
            message: `Moved ${line_indexes.length} line(s) from table ${from_table} to a new order on table ${to_table}.`,
            sourceOrder: result.sourceOrder,
            newOrder: result.newOrder,
        });
    } catch (e) {
        const statusCode = e.statusCode || 500;
        if (statusCode >= 500) {
            logger.error('table.transfer_items.failed', { from_table, to_table, message: e.message });
        }
        return res.status(statusCode).json({ status: false, message: e.message });
    }
});


// Seat / server assignment (CTO forensic audit 2026-09-21, P1 "Seat / server assignment").
// Sets or clears which staff member is responsible for a table right now. Gated by
// TABLES_MANAGE, same tier as the other day-to-day floor-plan actions (split/free) -- a
// waiter assigning themselves (or a manager reassigning a table mid-shift) is normal
// operation, not a settings change.
const User = require('../models/User');
router.patch('/:table_number/assign-server', fetchuser, requirePermission(PERMISSIONS.TABLES_MANAGE), [
    body('server_id').optional({ nullable: true }).isInt(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        const tenantId = req.body.tenant_id;
        const table = await Table.query().where('tenant_id', tenantId).where('table_number', req.params.table_number).first();
        if (!table) return res.status(404).json({ status: false, message: `Table ${req.params.table_number} not found.` });

        const serverId = req.body.server_id ?? null;
        if (serverId !== null) {
            const staffMember = await User.forTenant(tenantId).where('id', serverId).first();
            if (!staffMember) {
                return res.status(400).json({ status: false, message: 'That staff member does not exist in this restaurant.' });
            }
        }

        await Table.query().where('id', table.id).patch({ assigned_server_id: serverId });

        auditLog.record({
            tenantId,
            actorUserId: req.body.myID,
            actorRole: req.authRole,
            eventType: 'table.assign_server',
            entityType: 'table',
            entityId: table.table_number,
            payload: { server_id: serverId, previous_server_id: table.assigned_server_id ?? null },
        });

        return res.json({
            status: true,
            message: serverId ? 'Server assigned.' : 'Server unassigned.',
        });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

module.exports = router
