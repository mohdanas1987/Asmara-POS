const router = require("express").Router();
const Table = require('../models/Table');
const Order = require('../models/Order');
const Product = require('../models/Item');
const CashRegister = require('../models/CashRegister');
const fetchuser = require('../middlewares/loggedIn');
const Report = require('../models/Report');
const path = require('path');

const fs = require('fs');

const { europeanDate, keys, generateReport } = require('../utils');
const { nonKitchenItems } = require("../utils/constants");
const { routeOrderToKitchen } = require('../services/kitchenRouting');
const { sendItemsRespectingCourses } = require('../services/courseRouting');

// Per-line modifier kitchen routing (CTO forensic audit 2026-09-21, fixing the KNOWN
// LIMITATION this same file used to document here: two cart lines of the same product with
// DIFFERENT modifier selections -- "Burger + Cheese" and "Burger + No Cheese" -- used to
// collapse into one aggregated `updatedQt[productId]` quantity by the time routing saw them,
// so only ONE line's modifier set could ever be shown against the combined quantity. That is
// not production-safe for a kitchen that needs to know exactly which plate gets which
// preparation.
//
// Fix: pull every line that actually carries a modifier selection OUT of the flat
// product-id/quantity map entirely (subtracting its quantity back out of that map) and route
// it as its own separate ticket entry instead, grouped by (item id + exact modifier
// signature) so two lines with the IDENTICAL selection still merge into one entry -- matching
// the cart's own merge behavior (see useCart.ts) -- while two DIFFERENT selections never do.
// Plain items with no modifier line at all are completely unaffected: they stay in the flat
// map and produce the exact same {id, quantity} shape as before this fix, so every existing
// no-modifier order and test is untouched (Preservation Contract).
function buildRoutedItems(updatedQt, dataLines) {
    const qtyMap = { ...updatedQt };
    const modifierLines = Array.isArray(dataLines)
        ? dataLines.filter((l) => l && l.itemId !== undefined && Array.isArray(l.modifiers) && l.modifiers.length > 0)
        : [];

    if (modifierLines.length === 0) {
        return Object.entries(qtyMap).map(([id, quantity]) => ({ id, quantity }));
    }

    const grouped = new Map(); // "itemId::modifierSignature" -> { id, quantity, modifiers }
    for (const line of modifierLines) {
        const id = String(line.itemId);
        const qty = Number(line.qty) || 0;
        if (qty <= 0) continue;

        // Remove this line's quantity from the flat map so it isn't ALSO counted there --
        // the flat map and these per-line entries must never double-count the same items.
        if (qtyMap[id] !== undefined) {
            const remaining = Number(qtyMap[id]) - qty;
            if (remaining > 0) qtyMap[id] = remaining;
            else delete qtyMap[id];
        }

        const signature = line.modifiers.map((m) => m.id).sort((a, b) => a - b).join(',');
        const key = `${id}::${signature}`;
        const names = line.modifiers.map((m) => m && m.name).filter(Boolean);
        if (grouped.has(key)) {
            grouped.get(key).quantity += qty;
        } else {
            grouped.set(key, { id, quantity: qty, modifiers: names });
        }
    }

    const plainItems = Object.entries(qtyMap).map(([id, quantity]) => ({ id, quantity }));
    return [...plainItems, ...grouped.values()];
}
const loyalty = require('../services/loyaltyService');
const { recordChange } = require('../services/offline/syncLog');
const { calculateInclusiveTax } = require('../utils/tax');
const paymentLedger = require('../services/payments/paymentLedger');
const billSplit = require('../services/payments/billSplit');
const requirePermission = require('../middlewares/requirePermission');
const idempotent = require('../middlewares/idempotent');
const { PERMISSIONS } = require('../config/permissions');
const { snapshotOrderLines } = require('../services/orderLineSnapshot');
const { validateAndPriceLines, ModifierValidationError } = require('../services/modifierValidation');
const auditLog = require('../services/auditLog');
const { recordStatusChangeSafe, recordTableEventSafe } = require('../services/orderHistory');

// Billing & payments completeness (task #37): both /create and /payment-update accept a
// `modes` object shaped like { cash: 12.50 } or { card: 12.50 }, or (for the app's existing,
// undocumented split-payment convention) { <method>: amount, ..., modes: <nested> } when
// payment_mode contains a comma. This turns that object into real ledger charge rows without
// requiring the frontend to change how it calls these routes at all.
function chargesFromModes(modes) {
    if (!modes || typeof modes !== 'object') return [];
    return Object.entries(modes)
        .filter(([key, value]) => key !== 'modes' && Number(value) > 0)
        .map(([method, amount]) => ({ method, amount: Number(amount) }));
}

// Bill splitting (task #49): `modes` is a { method: amount } OBJECT, so it can only ever
// represent one charge per distinct payment method -- fine for "half cash, half card", but
// two people who both pay by card can't both be recorded through it (the second key would
// just overwrite the first). This is an optional alternative shape: an array of itemized
// { method, amount, note? } charges. It is NOT summed together with chargesFromModes's output
// -- both describe the same underlying payment, just shaped differently, so whichever call
// site uses this picks one or the other (see the precedence comment at each call site) to
// avoid double-recording a single payment. A caller that never sends `charges` (every
// existing frontend call today) is completely unaffected.
function chargesFromArray(charges) {
    if (!Array.isArray(charges)) return [];
    return charges
        .filter((c) => c && typeof c === 'object' && Number(c.amount) > 0 && typeof c.method === 'string' && c.method.length > 0)
        .map((c) => ({ method: c.method, amount: Number(c.amount), note: typeof c.note === 'string' ? c.note : undefined }));
}

let error = { status: false, message: 'Something went wrong!' }

router.get('/', fetchuser, async (req, res) => {

    const orders = await Order.query().where('tenant_id', req.body.tenant_id)
        .withGraphFetched('[cashier(selectName), register]')
        .modifiers({
            selectName(build) {
                build.select('id', 'name');
            }
        })
        .orderBy('created_at', 'desc');

    let prs = await Product.query().where('tenant_id', req.body.tenant_id).select('id', 'name');
    let products = {};

    prs.forEach(pr => {
        products[pr.id] = pr.name;
    });

    const sessions = await CashRegister.query().where('tenant_id', req.body.tenant_id).select(['id', 'date', 'status', 'user_id']).groupBy('date');

    let options = sessions.map(se => ({ value: se.id, label: se.date, current: se.user_id === Number(req.body.myID) && Boolean(se.status) === true }));

    let tableOrders = {};
    orders.forEach(order => {
        if (order && order.status !== 'completed') {
            const info = {
                id: order.id,
                data: JSON.parse(order.data ?? '{}'),
                status: order.status,
                payment: order.payment_status,
                taste: order.taste,
                total: order.total,
                note: order.note,
                // Table/Floor management redesign (project audit 2026-09-15): elapsed time
                // ("table 5 has been seated for 42 minutes") needs when the order actually
                // started, not just its current state.
                created_at: order.created_at
            };
            // Owner-reported bug ("table merge ... does not work"): a merged order's `tables`
            // is a "+"-joined combo written by POST /orders/init/1+2 (e.g. "1+2"), so this map
            // only ever had an entry under the literal key "1+2" -- but the floor plan looks
            // up `tableOrders[table.table_number]` for EACH individual table ("1", then "2")
            // to decide whether tapping that specific table should resume the shared order.
            // Neither lookup ever matched, so a merged table showed "order ongoing" (amber)
            // with no way to actually open the order that made it so. Indexing under every
            // individual table number too (in addition to the combo key other callers, like
            // the admin order list, already rely on) fixes that without changing the existing
            // single-table behavior at all -- split('+') on a plain "3" just returns ["3"].
            const tableKeys = String(order.tables ?? '').split('+').filter(Boolean);
            for (const key of [order.tables, ...tableKeys]) {
                if (key) tableOrders[key] = info;
            }
        }
    });

    return res.json({
        status: true,
        orders,
        products,
        sessions: options,
        tableOrders,
    });

});

// STAGE 2 / phase 18: was completely unauthenticated. Any request that could reach this
// server could cancel any order on any table with a single GET. Now requires fetchuser.
// STAGE 2 / phase 19: "cancel" is a destructive mutation that was expressed as GET. The
// original GET route is kept working (unchanged response shape) for the current compiled
// frontend; a POST alias is added as the correct-verb replacement for future use.
async function cancelOrderHandler(req, res) {
    try {
        // Order domain normalization phase 2 (CTO feedback 2026-09-22, item 8): capture the
        // pre-delete status so the void is recorded in order_status_history. Best-effort --
        // must never block the actual cancellation below.
        let orderBeforeDelete = null;
        try {
            orderBeforeDelete = await Order.query().findById(req.params.order).where('tenant_id', req.body.tenant_id);
        } catch (lookupError) {
            console.log('[orderHistory] non-fatal: could not read order before cancel', req.params.order, lookupError.message);
        }

        const deleted = await Order.query().deleteById(req.params.order).where('tenant_id', req.body.tenant_id);

        await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', req.params.table.split("+")).patch({
            status: "free"
        });

        recordStatusChangeSafe({
            tenantId: req.body.tenant_id,
            orderId: req.params.order,
            fromStatus: orderBeforeDelete ? orderBeforeDelete.status : null,
            toStatus: 'cancelled',
            reason: 'cancel',
            userId: req.body.myID,
        });

        // Audit event log (CTO forensic audit 2026-09-21, P1 "Complete audit-event
        // coverage"): a voided order is exactly the kind of sensitive, irreversible action a
        // restaurant owner reviewing a shift needs a real record of -- who voided what, and
        // when. Best-effort, after the void has already succeeded.
        auditLog.record({
            tenantId: req.body.tenant_id,
            actorUserId: req.body.myID,
            actorRole: req.authRole,
            eventType: 'order.void',
            entityType: 'order',
            entityId: req.params.order,
            payload: { table: req.params.table, deleted },
        });

        return res.json({
            status: true,
            message: "Order cancelled!",
            deleted
        });

    } catch (error) {
        return res.json({
            status: false,
            message: error.message
        });
    }
}
// RBAC enforcement fix (CTO forensic audit 2026-09-21, "one especially important security
// issue remains" -- ORDERS_VOID exists in the permission matrix but this route only ever
// checked authentication, not authorization, so a role with orders.void explicitly disabled
// could still reach it. Discovered by Claude's own earlier test suite (see the comment in
// test/role-permissions.test.js), now actually closed rather than just documented.
router.get('/cancel/:order/:table', fetchuser, requirePermission(PERMISSIONS.ORDERS_VOID), cancelOrderHandler);
router.post('/cancel/:order/:table', fetchuser, requirePermission(PERMISSIONS.ORDERS_VOID), cancelOrderHandler);

// STAGE 2 / phase 18 + 19: same treatment as cancel above — was unauthenticated, was GET.
async function finishOrderHandler(req, res) {
    try {

        // Order domain normalization phase 2 (CTO feedback 2026-09-22, item 8): capture the
        // pre-patch status before it's overwritten, so the history row shows a real
        // fromStatus -> 'completed' transition rather than just the end state.
        let previousStatus = null;
        try {
            const orderBeforeFinish = await Order.query().findById(req.params.order).where('tenant_id', req.body.tenant_id);
            previousStatus = orderBeforeFinish ? orderBeforeFinish.status : null;
        } catch (lookupError) {
            console.log('[orderHistory] non-fatal: could not read order before finish', req.params.order, lookupError.message);
        }

        const order = await Order.query().patchAndFetchById(req.params.order, {
            status: "completed"
        }).where('tenant_id', req.body.tenant_id);

        recordStatusChangeSafe({
            tenantId: req.body.tenant_id,
            orderId: req.params.order,
            fromStatus: previousStatus,
            toStatus: 'completed',
            reason: 'finish',
            userId: req.body.myID,
        });

        const tables = req.params.table.indexOf('+') === -1 ? [req.params.table] : req.params.table.split('+');

        await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tables).patch({
            status: "free",
            linked_to: null
        });

        // Loyalty subsystem (project audit 2026-09-15): earn points on a completed order,
        // best-effort like kitchen routing above -- a customer not being attached to this
        // order (the common case for walk-ins) or any other loyalty-side issue must never
        // stop the order from completing and the table from freeing up.
        try {
            if (order.customer_id) {
                await loyalty.earnForOrder({
                    tenantId: req.body.tenant_id,
                    customerId: order.customer_id,
                    orderId: order.id,
                    orderTotalEuros: order.total,
                    createdBy: req.body.myID,
                });
            }
        } catch (loyaltyError) {
            console.log('[loyalty] non-fatal: could not earn points for order', order.id, loyaltyError.message);
        }

        return res.json({
            status: true,
            message: "Order completed & table freed!",
            order
        });

    } catch (error) {
        return res.json({
            status: false,
            message: error.message
        });
    }
}
router.get('/finish/:order/:table', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), finishOrderHandler);
router.post('/finish/:order/:table', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), finishOrderHandler);

// --- Kitchen Display support (new) ---
// Both are deliberately separate, minimal routes rather than reusing /to-kitchen or /finish:
// /to-kitchen builds its `data.quantity` from a POS-drafted cart and would silently clobber
// an online order's already-stored {items, customer_name} data if reused here; /finish
// requires a :table param and does `.split('+')` on it, which crashes for orders with no
// table (online orders, and POS "direct sale" orders both have tables: null). These two new
// routes only ever touch `status`, so they're safe for every order source.

async function acceptOrderHandler(req, res) {
    try {
        const order = await Order.query()
            .patchAndFetchById(req.params.order, { status: 'in-kitchen' })
            .where('tenant_id', req.body.tenant_id);
        if (!order) {
            return res.json({ status: false, message: 'Order not found.' });
        }
        const io = req.app.get('io');
        if (io) io.emit('order-to-kitchen', { order });

        // Kitchen ticket routing (project audit 2026-09-15): same best-effort routing as
        // /to-kitchen above, applied to online/tableless orders' {items: [{id, qty}]} shape.
        try {
            const { items: onlineItems } = JSON.parse(order.data || '{}');
            const routedItems = (onlineItems || []).map((it) => ({ id: it.id, quantity: it.qty ?? it.quantity ?? 1 }));
            if (routedItems.length > 0) {
                // Course firing (CTO forensic audit 2026-09-20): items on a held course (e.g.
                // "main"/"dessert") don't get a kitchen ticket here at all yet -- they wait in
                // held_course_items until a waiter fires that course. Items with no course (or
                // 'starter') are routed immediately, exactly as before.
                const tickets = await sendItemsRespectingCourses({
                    tenantId: req.body.tenant_id,
                    orderId: order.id,
                    tableNumber: order.tables,
                    items: routedItems,
                });
                if (io && tickets.length > 0) io.emit('kitchen-ticket-created', { tickets });
            }
        } catch (routingError) {
            console.log('[kitchen-routing] non-fatal: could not create station tickets:', routingError.message);
        }

        return res.json({ status: true, message: 'Order accepted -- sent to kitchen!', order });
    } catch (error) {
        return res.json({ status: false, message: error.message });
    }
}
router.post('/accept/:order', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), acceptOrderHandler);

async function markPreparedHandler(req, res) {
    try {
        const order = await Order.query()
            .patchAndFetchById(req.params.order, { status: 'completed' })
            .where('tenant_id', req.body.tenant_id);
        if (!order) {
            return res.json({ status: false, message: 'Order not found.' });
        }
        if (order.tables) {
            const tables = order.tables.indexOf('+') === -1 ? [order.tables] : order.tables.split('+');
            await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tables).patch({
                status: 'free',
                linked_to: null,
            });
        }
        return res.json({ status: true, message: 'Order marked prepared!', order });
    } catch (error) {
        return res.json({ status: false, message: error.message });
    }
}
router.post('/prepared/:order', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), markPreparedHandler);

router.post('/create', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), idempotent('orders.create'), async (req, res) => {
    try {
        // Order line normalization, phase 1 (production-completion spec, section 7): this
        // route overwrites orders.data with the PAYMENT-MODE breakdown a few lines below
        // (see the comment on that assignment), which discards whatever cart-line detail
        // /orders/to-kitchen had stored there. Read it BEFORE that happens so it can be
        // captured into an immutable order_items snapshot once the charge actually lands --
        // see the snapshotOrderLines call after paymentLedger.recordCharges below.
        let preChargeLines = null;
        let preChargeQuantity = null;
        // Order domain normalization phase 2 (CTO feedback 2026-09-22, item 8): also hoisted
        // out to record the pre-charge payment_status once the charge actually lands below.
        let previousPaymentStatus = null;
        if (req.body.order_id) {
            const orderBeforeCharge = await Order.query().findById(req.body.order_id).where('tenant_id', req.body.tenant_id);
            if (orderBeforeCharge) {
                previousPaymentStatus = orderBeforeCharge.payment_status;
            }
            if (orderBeforeCharge && orderBeforeCharge.data) {
                try {
                    const parsed = JSON.parse(orderBeforeCharge.data);
                    if (Array.isArray(parsed.lines)) preChargeLines = parsed.lines;
                    if (parsed.quantity && typeof parsed.quantity === 'object') preChargeQuantity = parsed.quantity;
                } catch (_parseErr) {
                    // orders.data wasn't valid line-detail JSON (e.g. already payment-modes
                    // shaped from an earlier /create call) -- nothing to snapshot from here.
                }
            }
        }

        let lastSession = await CashRegister.query().where('tenant_id', req.body.tenant_id).where('status', true).select('id').first().orderBy('id', 'DESC');
        if (lastSession) {
            lastSession = lastSession.id;
        }
        const notifications = [];
        let modes = req.body.modes;

        if ((req.body.payment_mode).indexOf(',') !== -1) {
            modes = { ...req.body.data, modes };
        } else {
            modes = req.body.data;
        }

        let payload = {
            // order_number: req.body.order_number,
            total: req.body.total,
            payment_mode: req.body.payment_mode,
            data: JSON.stringify(modes),
            cash_register_id: lastSession ?? req.body.cash_register_id,
            // BUG FIX (task #37): this used to hardcode "paid" unconditionally here, so an
            // underpayment (or a future partial/split payment) was silently marked fully paid
            // with no record of what was actually collected. Now recorded as real ledger
            // transactions below and re-derived from them -- the common case (one charge
            // covering the full total) still resolves to "paid", unchanged.
            payment_status: "pending"
        };

        if(req.body.extra) {
            payload.added_total = null
        }

        let order = await Order.query().patchAndFetchById(req.body.order_id, payload).where('tenant_id', req.body.tenant_id);

        if (!order) {
            throw new Error('Error creating order');
        }

        // Bill splitting (task #49): `data`/`modes` and an itemized `charges` array both
        // describe the SAME payment, just shaped differently (modes is a merged-by-method
        // summary; charges is the itemized per-payer breakdown) -- they must never both be
        // recorded, or a split payment gets double-counted in the ledger. Found and fixed
        // before this ever shipped to a real check-out: an earlier version of this line
        // concatenated both sources, which recorded (and summed) every split charge TWICE.
        // When charges is provided, it's the sole source of truth; order.data above still
        // stores just `modes` either way, for backward-compatible display only.
        const arrayCharges = chargesFromArray(req.body.charges);
        const charges = arrayCharges.length > 0 ? arrayCharges : chargesFromModes(modes);
        if (charges.length > 0) {
            await paymentLedger.recordCharges({
                tenantId: req.body.tenant_id,
                orderId: order.id,
                payments: charges,
                createdBy: req.body.myID,
            });

            // Order line normalization, phase 1: snapshot the order's lines into
            // order_items/order_item_modifiers now that a real charge has been recorded.
            // Best-effort, exactly like loyalty earning and offline-sync recording elsewhere
            // in this file -- a snapshot failure must never stop a payment from completing.
            try {
                await snapshotOrderLines({
                    tenantId: req.body.tenant_id,
                    orderId: order.id,
                    lines: preChargeLines,
                    fallbackQuantities: preChargeQuantity,
                });
            } catch (snapshotError) {
                console.log('[order-line-snapshot] non-fatal: could not snapshot order lines:', snapshotError.message);
            }
        }
        const netPaid = await paymentLedger.getNetPaid({ tenantId: req.body.tenant_id, orderId: order.id });
        const derivedStatus = paymentLedger.deriveStatus(netPaid, order.total);
        order = await Order.query().patchAndFetchById(order.id, { payment_status: derivedStatus }).where('tenant_id', req.body.tenant_id);

        // Order domain normalization phase 2 (CTO feedback 2026-09-22, item 8): record the
        // payment_status transition only when it actually changed.
        if (previousPaymentStatus !== derivedStatus) {
            recordStatusChangeSafe({
                tenantId: req.body.tenant_id,
                orderId: order.id,
                fromStatus: previousPaymentStatus,
                toStatus: derivedStatus,
                reason: 'orders.create:payment_status',
                userId: req.body.myID,
            });
        }

        if (req.body.data) {
            // Cash-register accounting fix (CTO forensic audit 2026-09-21, "serious
            // cash-register accounting issue"): this used to credit the drawer with
            // `order.total` regardless of HOW the order was actually paid -- a split
            // cash/card payment (e.g. total EUR100, EUR40 cash + EUR60 card) was crediting
            // the drawer the FULL EUR100 instead of the EUR40 actually put in it, and a
            // card-only payment was still (wrongly) crediting cash. The drawer must only
            // ever move by real cash actually collected, which is exactly what `charges`
            // (built above from either the itemized `charges` array or `modes`) records --
            // summing just its 'cash' entries is the one number that's ever correct here.
            const cashCollected = charges
                .filter((c) => c.method === 'cash')
                .reduce((sum, c) => sum + c.amount, 0);
            if (cashCollected > 0 && lastSession) {
                await CashRegister.query().findById(lastSession).where('tenant_id', req.body.tenant_id).patch({
                    closing_cash: CashRegister.raw(`closing_cash + ?`, [cashCollected]),
                });
            }

            return res.status(200).json({
                status: true,
                message: 'Transaction completed!',
                html: req.body.receiptData,
                order: {...order, ...modes},
                notifications
            });

        }

        return res.status(200).json({ status: false });

    } catch (error) {
        console.error('Transaction error:', error);
        res.status(500).json({ status: false, message: 'An error occurred', error: error.message });
    }
})

// Table/Floor management redesign (project audit 2026-09-15): kept the original GET route
// working unchanged (STAGE 2/19's established pattern for a legacy GET-as-mutation this
// codebase already uses elsewhere -- see /tables' free-all/split-table for the same
// treatment) and added a correctly-verbed POST alongside it, plus sync-log recording so a
// merge made on one terminal is visible to every other terminal in the restaurant.
async function linkTablesHandler(req, res) {
    try {
        let link = req.params.tables;
        const tableNumbers = link.split("+");
        await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tableNumbers).patch({
            linked_to: link
        });

        try {
            await recordChange({
                tenantId: req.body.tenant_id,
                terminalId: req.body.terminal_id || 'unknown-terminal',
                entityType: 'table_merge',
                entityId: link,
                operation: 'update',
                payload: { tables: tableNumbers, linked_to: link },
            });
        } catch (syncError) {
            console.log('[offline-sync] non-fatal: could not record table merge change:', syncError.message);
        }

        return res.json({
            status: true,
            message: "Tables merged!",
            link
        });

    } catch (error) {
        return res.json({
            status: false,
            message: error.message
        });
    }
}
router.get('/link/:tables', fetchuser, linkTablesHandler);
router.post('/link/:tables', fetchuser, requirePermission(PERMISSIONS.TABLES_MANAGE), linkTablesHandler);

router.get('/init/:table', fetchuser, async (req, res) => {
    try {
        if ((req.params.table).indexOf('+') === -1) {
            const table = await Table.query().where('tenant_id', req.body.tenant_id).where('table_number', req.params.table).first();
            if (table.status !== 'free') {
                return res.status(403).json({
                    status: false,
                    message: "Table is not available!",
                    table
                });
            }
        }

        const register = await CashRegister.query()
            .orderBy('id', "DESC")
            .where('tenant_id', req.body.tenant_id)
            .where('user_id', req.body.myID)
            .where("status", true)
            .select('id')
            .first();

        if (!register) {
            return res.json({ status: false, message: "Start with cash register to continue!" })
        }
        const created = await Order.query().insert({
            customer_id: req.body.customer_id,
            cash_register_id: register.id,
            user_id: req.body.myID,
            tables: req.params.table,
            tenant_id: req.body.tenant_id
        });

        const order = await Order.query().findById(created.id).where('tenant_id', req.body.tenant_id);

        const tables = req.params.table.split('+');

        await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tables).update({
            status: "order ongoing"
        });

        // Order domain normalization phase 2 (CTO feedback 2026-09-22, item 8): this is the
        // real "order opened on a table" event -- record both the initial status and the
        // initial table assignment as the first rows in each history table.
        recordStatusChangeSafe({
            tenantId: req.body.tenant_id,
            orderId: order.id,
            fromStatus: null,
            toStatus: order.status,
            reason: 'init',
            userId: req.body.myID,
        });
        recordTableEventSafe({
            tenantId: req.body.tenant_id,
            orderId: order.id,
            fromTable: null,
            toTable: req.params.table,
            eventType: 'open',
            userId: req.body.myID,
        });

        return res.json({ order, status: true });

    } catch (err) {
        return res.status(500).json({ ...error, exception: err.message });
    }

})

// STAGE 2 / phase 18: was unauthenticated (verb was already correct — POST).
router.post('/to-kitchen/:table?', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), idempotent('orders.to-kitchen'), async (req, res) => {
    try {
        let payload = { status: 'in-kitchen' }

        if (req.body.data) {
            // Server-side modifier validation (CTO forensic audit 2026-09-21, "Modifier
            // authorization/validation is client-heavy"): re-derive every submitted line's
            // modifiers from the database BEFORE anything gets persisted or routed to the
            // kitchen -- see services/modifierValidation.js. Throws ModifierValidationError
            // (caught below) on a tampered/invalid selection; a request with no `lines` at
            // all (or an empty array) is completely untouched, same as before this existed.
            if (Array.isArray(req.body.data.lines) && req.body.data.lines.length > 0) {
                req.body.data.lines = await validateAndPriceLines({
                    tenantId: req.body.tenant_id,
                    lines: req.body.data.lines,
                });
            }
            payload = {
                ...payload,
                data: JSON.stringify(req.body.data),
                total: req.body.total
            }
        }

        let order;
        let updatedQt = {};
        let msg = 'Order sent to kitchen!';
        if (req.body.order_id) {
            let previousOrder = await Order.query().findById(req.body.order_id).where('tenant_id', req.body.tenant_id);
            if (!previousOrder) {
                return res.status(404).json({ status: false, message: 'Order not found.' });
            }

            // Optimistic locking (execution plan gap: "no conflict-safe writes on orders" --
            // this route is the one genuine lost-update race in the app: two terminals can
            // both read the same order's item quantities, each compute their own diff against
            // that stale read, and whichever PATCH lands second silently discards the other
            // terminal's edits. `expected_version` is OPTIONAL so older, not-yet-updated frontend
            // callers keep working exactly as before (Preservation Contract); a caller that
            // does send it gets a real conflict check instead of a silent overwrite.
            if (req.body.expected_version !== undefined && req.body.expected_version !== null) {
                if (Number(req.body.expected_version) !== Number(previousOrder.version ?? 1)) {
                    return res.status(409).json({
                        status: false,
                        conflict: true,
                        message: 'This order was updated by another terminal. Refresh and try again.',
                        order: previousOrder,
                    });
                }
            }

            if (previousOrder.status === 'in-kitchen') { // updating the stock value of in-kitchen order;
                msg = 'Order updated!';
                const { quantity: oldQt } = JSON.parse(previousOrder.data ?? '{}');
                const { quantity: newQt } = req.body.data;
                Object.keys(newQt).forEach(prID => {
                    if (oldQt[prID]) {
                        if (newQt[prID] === oldQt[prID]) { // stock
                            // to skip
                        } else {
                            updatedQt[prID] = newQt[prID] - oldQt[prID];
                        }
                    } else {
                        updatedQt[prID] = newQt[prID];
                    }
                });
                payload.in_kitchen = JSON.stringify(updatedQt);
            } else {
                updatedQt = { ...req.body.data.quantity };
            }
            payload.version = Number(previousOrder.version ?? 1) + 1;
            order = await Order.query().patchAndFetchById(req.body.order_id, payload).where('tenant_id', req.body.tenant_id);
            if (order.tables) {
                const tables = order.tables ? [order.tables] : order.tables.split('+');
                await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tables).patch({ status: "occupied" });
            }

            // Order domain normalization phase 2 (CTO feedback 2026-09-22, item 8): record
            // the status transition only when it actually changed (a quantity-only update to
            // an already in-kitchen order keeps the same status and shouldn't produce a
            // no-op history row).
            if (previousOrder.status !== order.status) {
                recordStatusChangeSafe({
                    tenantId: req.body.tenant_id,
                    orderId: order.id,
                    fromStatus: previousOrder.status,
                    toStatus: order.status,
                    reason: 'to-kitchen',
                    userId: req.body.myID,
                });
            }
        } else {
            order = await Order.query().insertAndFetch({ ...payload, note: "From direct sale.", tenant_id: req.body.tenant_id, version: 1 });
        }
        let prIDs = Object.keys(updatedQt);
        const products = await Product.query().where('tenant_id', req.body.tenant_id).select(['id']).withGraphFetched('category').modifyGraph('category', (builder) => {
            builder.select(
                'menu_categories.name as catName'
            );
        }).whereIn('id', prIDs);


        products.forEach(pr => {
            let catName = (pr.category?.catName ?? '').toLowerCase();
            if (catName && nonKitchenItems.some(ite => catName.includes(ite))) {
                delete updatedQt[pr.id];
            }
        });


        // Real-time Kitchen Display notification (see the /accept and /prepared routes above
        // for why those exist separately) -- fires for both a brand-new direct-sale ticket
        // and an update to an existing one, same as the online-order push in routes/website.js.
        if (order.status === 'in-kitchen') {
            const io = req.app.get('io');
            if (io) io.emit('order-to-kitchen', { order });

            // Kitchen ticket routing (project audit 2026-09-15): split into per-station
            // tickets alongside the existing order-status flow above. Deliberately
            // best-effort -- a routing failure (e.g. no stations configured yet for a very
            // old tenant that predates migration 0009) must never stop the order from
            // reaching the kitchen the way it always has.
            try {
                let routedItems = buildRoutedItems(updatedQt, req.body.data && req.body.data.lines);
                if (routedItems.length > 0) {
                    // Course firing (CTO forensic audit 2026-09-20): see the identical comment
                    // in acceptOrderHandler above -- same hold/fire behavior, same Preservation
                    // Contract for items with no course set.
                    const tickets = await sendItemsRespectingCourses({
                        tenantId: req.body.tenant_id,
                        orderId: order.id,
                        tableNumber: order.tables,
                        items: routedItems,
                    });
                    if (io && tickets.length > 0) io.emit('kitchen-ticket-created', { tickets });
                }
            } catch (routingError) {
                console.log('[kitchen-routing] non-fatal: could not create station tickets:', routingError.message);
            }
        }

        return res.json({
            status: true,
            message: msg,
            order,
            only: updatedQt
        });

    } catch (error) {
        console.log(error.message)
        // Server-side modifier validation (CTO forensic audit 2026-09-21): a validation
        // failure needs to actually reach the caller as a real error the POS can show the
        // cashier -- not swallowed into the same silent `{status:false}` every other
        // exception in this handler falls back to (a pre-existing, deliberately unchanged
        // behavior for anything else that goes wrong here).
        if (error instanceof ModifierValidationError) {
            return res.status(error.statusCode || 400).json({ status: false, message: error.message });
        }
        return res.json({ status: false })
    }
})

router.post('/payment-update', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), idempotent('orders.payment-update'), async (req, res) => {
    try {

        let modes = req.body.modes;
        if ((req.body.payment_mode).indexOf(',') !== -1) {
            modes = { ...req.body.data, modes };
        } else {
            modes = req.body.data;
        }

        const existingOrder = await Order.query().findById(req.body.order_id).where('tenant_id', req.body.tenant_id);
        if (!existingOrder) {
            return res.json({ status: false, message: "Order not found." });
        }

        // Bill splitting (task #49): same precedence rule as /create above -- an itemized
        // `charges` array, when present, is the sole source of truth (never summed together
        // with the modes-derived charge, which would double-count the same payment).
        const arrayCharges = chargesFromArray(req.body.charges);
        const charges = arrayCharges.length > 0 ? arrayCharges : chargesFromModes(modes);
        if (charges.length > 0) {
            await paymentLedger.recordCharges({
                tenantId: req.body.tenant_id,
                orderId: existingOrder.id,
                payments: charges,
                createdBy: req.body.myID,
            });
        }
        const netPaid = await paymentLedger.getNetPaid({ tenantId: req.body.tenant_id, orderId: existingOrder.id });
        // BUG FIX (task #37): same hardcoded-"paid" issue as /create -- derived from the
        // ledger now instead of assumed.
        const derivedStatus = paymentLedger.deriveStatus(netPaid, existingOrder.total);

        const order = await Order.query().patchAndFetchById(req.body.order_id, {
            payment_status: derivedStatus,
            updated_at: europeanDate(),
            data: modes
        }).where('tenant_id', req.body.tenant_id);

        // Order domain normalization phase 2 (CTO feedback 2026-09-22, item 8): record the
        // payment_status transition only when it actually changed.
        if (existingOrder.payment_status !== derivedStatus) {
            recordStatusChangeSafe({
                tenantId: req.body.tenant_id,
                orderId: order.id,
                fromStatus: existingOrder.payment_status,
                toStatus: derivedStatus,
                reason: 'payment-update',
                userId: req.body.myID,
            });
        }

        // Cash-register accounting fix (CTO forensic audit 2026-09-21, "serious cash-register
        // accounting issue"): this route records charges into the same payment ledger /create
        // does but, before this fix, never touched the drawer at all -- a payment recorded
        // here (e.g. finishing a partially-paid order) was invisible to the cash-register
        // report. Same rule as /create: only the actual 'cash' portion of `charges` moves the
        // drawer, and only if a register session is currently open.
        const cashCollected = charges
            .filter((c) => c.method === 'cash')
            .reduce((sum, c) => sum + c.amount, 0);
        if (cashCollected > 0) {
            let lastSession = await CashRegister.query().where('tenant_id', req.body.tenant_id).where('status', true).select('id').first().orderBy('id', 'DESC');
            if (lastSession) {
                await CashRegister.query().findById(lastSession.id).where('tenant_id', req.body.tenant_id).patch({
                    closing_cash: CashRegister.raw(`closing_cash + ?`, [cashCollected]),
                });
            }
        }

        return res.json({
            status: true,
            message: "Payment completed!",
            order
        });

    } catch (error) {
        return res.json({ status: false, exception: error.message, message: "An error occurred!" });
    }
})

// Billing & payments completeness (task #37): real refund and void support, and a way to see
// an order's actual payment history -- none of this existed before (routes/payments.js only
// ever fired a one-shot terminal charge with nothing persisted; see its own comments).

router.get('/:order/payments', fetchuser, async (req, res) => {
    try {
        const ledger = await paymentLedger.getLedger({ tenantId: req.body.tenant_id, orderId: req.params.order });
        const netPaid = await paymentLedger.getNetPaid({ tenantId: req.body.tenant_id, orderId: req.params.order });
        return res.json({ status: true, transactions: ledger, netPaid });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message });
    }
});

// Bill splitting, item/seat/percentage modes (CTO feedback 2026-09-22, item 7). Pure
// computation -- this never charges or records anything. It exists so the client doesn't
// have to (mis)compute item-assignment or percentage splits itself; the caller takes the
// returned `shares` and passes them as the `charges` array to the EXISTING, already-tested
// POST /orders/create or /orders/payment-update (task #49) to actually charge them. See
// services/payments/billSplit.js's header comment for why item/percentage splitting needed
// real backend support rather than being left entirely to the frontend.
router.post('/:order/bill-split/preview', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), async (req, res) => {
    try {
        const order = await Order.query().where('tenant_id', req.body.tenant_id).findById(req.params.order);
        if (!order) {
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }

        const { mode } = req.body;
        let shares;
        let linesTotalMismatch = null;
        if (mode === 'even') {
            shares = billSplit.computeEvenSplit(order.total, Number(req.body.count));
        } else if (mode === 'percentage') {
            shares = billSplit.computePercentageSplit(order.total, req.body.shares);
        } else if (mode === 'items') {
            let lines = [];
            try {
                const data = JSON.parse(order.data || '{}');
                lines = Array.isArray(data.lines) ? data.lines : [];
            } catch (_parseErr) {
                lines = [];
            }
            if (lines.length === 0) {
                return res.status(400).json({ status: false, message: 'This order has no per-line detail to split by item -- use "even" or "percentage" instead.' });
            }
            const productIds = [...new Set(lines.map((l) => l.itemId).filter((id) => id !== undefined && id !== null))];
            const products = productIds.length > 0
                ? await Product.query().where('tenant_id', req.body.tenant_id).whereIn('id', productIds)
                : [];
            const productsById = new Map(products.map((p) => [String(p.id), p]));
            shares = billSplit.computeItemSplit({ lines, products: productsById, assignments: req.body.assignments });

            // Unlike even/percentage (which are computed FROM order.total and therefore
            // always match it by construction), an item split is computed from the order's
            // LINE data, which can legitimately differ from order.total (a service charge, a
            // tip, or a manually-adjusted total that isn't reflected in any line). Surfacing
            // that as a warning rather than a hard failure -- see billSplit.js's
            // assertSharesSumToTotal for the strict check used by even/percentage.
            const linesTotal = shares.reduce((sum, s) => sum + billSplit.toCents(s.amount), 0);
            if (Math.abs(linesTotal - billSplit.toCents(order.total)) > 1) {
                linesTotalMismatch = { linesTotal: billSplit.fromCents(linesTotal), orderTotal: order.total };
            }
        } else {
            return res.status(400).json({ status: false, message: 'mode must be "even", "percentage", or "items".' });
        }

        if (mode !== 'items') {
            billSplit.assertSharesSumToTotal(shares, order.total);
        }
        return res.json({ status: true, order_total: order.total, shares, warning: linesTotalMismatch ? 'Computed item shares do not match the order total -- this order likely has a service charge, tip, or manual adjustment not reflected in its line items.' : null, lines_total_mismatch: linesTotalMismatch });
    } catch (error) {
        return res.status(400).json({ status: false, message: error.message });
    }
});

router.post('/:order/refund', fetchuser, requirePermission(PERMISSIONS.PAYMENTS_REFUND), idempotent('orders.refund'), async (req, res) => {
    try {
        const { amount, reason, method } = req.body;
        const transaction = await paymentLedger.refund({
            tenantId: req.body.tenant_id,
            orderId: req.params.order,
            amount,
            reason,
            createdBy: req.body.myID,
            method,
        });
        const netPaid = await paymentLedger.getNetPaid({ tenantId: req.body.tenant_id, orderId: req.params.order });
        const order = await Order.query().where('tenant_id', req.body.tenant_id).findById(req.params.order);
        let updatedOrder = order;
        if (order) {
            const derivedStatus = paymentLedger.deriveStatus(netPaid, order.total);
            updatedOrder = await Order.query().patchAndFetchById(req.params.order, {
                payment_status: netPaid <= 0 ? 'refunded' : derivedStatus,
            }).where('tenant_id', req.body.tenant_id);
        }

        // Cash-register accounting fix (CTO forensic audit 2026-09-21): only a CASH refund
        // ever touches the physical drawer -- a card refund is reversed by the payment
        // provider, never by taking money back out of the till. Best-effort (like every other
        // sync/logging side-effect in this file): a missing open register session must never
        // block a refund that's otherwise valid.
        if (method === 'cash' && Number(amount) > 0) {
            const openSession = await CashRegister.query().where('tenant_id', req.body.tenant_id).where('status', true).orderBy('id', 'DESC').select('id').first();
            if (openSession) {
                await CashRegister.query().findById(openSession.id).where('tenant_id', req.body.tenant_id).patch({
                    closing_cash: CashRegister.raw(`closing_cash - ?`, [Number(amount)]),
                });
            } else {
                console.log('[cash-register] non-fatal: cash refund recorded with no open register session -- drawer not adjusted.');
            }
        }

        // Audit event log (CTO forensic audit 2026-09-21, P1 "Complete audit-event
        // coverage"): a refund is one of the most sensitive actions in the app -- real money
        // moving back out. Best-effort, after the refund has already been recorded.
        auditLog.record({
            tenantId: req.body.tenant_id,
            actorUserId: req.body.myID,
            actorRole: req.authRole,
            eventType: 'payment.refund',
            entityType: 'order',
            entityId: req.params.order,
            payload: { amount, method, reason, netPaid },
        });

        return res.json({ status: true, message: 'Refund recorded.', transaction, netPaid, order: updatedOrder });
    } catch (error) {
        return res.status(400).json({ status: false, message: error.message });
    }
});

router.post('/payments/:transactionId/void', fetchuser, requirePermission(PERMISSIONS.PAYMENTS_REFUND), async (req, res) => {
    try {
        const voidRow = await paymentLedger.voidTransaction({
            tenantId: req.body.tenant_id,
            transactionId: req.params.transactionId,
            createdBy: req.body.myID,
        });

        auditLog.record({
            tenantId: req.body.tenant_id,
            actorUserId: req.body.myID,
            actorRole: req.authRole,
            eventType: 'payment.void',
            entityType: 'payment_transaction',
            entityId: req.params.transactionId,
            payload: { voided: voidRow },
        });

        return res.json({ status: true, message: 'Transaction voided.', transaction: voidRow });
    } catch (error) {
        return res.status(400).json({ status: false, message: error.message });
    }
});

router.get('/view-order/:id', fetchuser, async (req, res) => {
    try {
        let orderID = req.params.id;

        let order = await Order.query().where('id', orderID).where('tenant_id', req.body.tenant_id).withGraphFetched('cashier').first();

        let data = typeof order.data === 'string' ? JSON.parse(order.data) : order.data;
        const products = await Product.query().where('tenant_id', req.body.tenant_id).whereIn('id', keys(data?.quantity ?? {}));
        const pairs = {};
        products.forEach(pr => {
            pr.taxAmount = calculateInclusiveTax(pr.price, pr.tax).toFixed(2);
            pairs[pr.id] = pr;
        });

        return res.json({
            status: true,
            order,
            products: pairs,
            session: data,
            cashier: order.cashier
        });

    } catch (e) {

        error.message = e.message;
        console.log(e.message);
        return res.json({
            status: false,
            order: {},
            products: [],
            session: [],
        })

    }
});

router.get(`/info/:order/:print?`, fetchuser, async (req, res) => {
    try {
        let order = await Order.query().findById(req.params.order).where('tenant_id', req.body.tenant_id);
        let data = JSON.parse(order.data);
        let in_kitchen = JSON.parse(order.in_kitchen ?? '{}');
        let toPrint = [];

        const products = await Product.query().where('tenant_id', req.body.tenant_id).select(['id', 'name', 'price', 'category_id', 'tax', 'stock']).withGraphFetched('category').modifyGraph('category', (builder) => {
            builder.select(
                'menu_categories.name as catName'
            );
        }).whereIn('id', Object.keys(data.quantity ?? []));
        const pairs = [];

        products.forEach(pr => {
            pr.taxAmount = calculateInclusiveTax(pr.price, pr.tax).toFixed(2);
            pr.stock = data.quantity[pr.id];
            pr.note = data.note?.[pr.id] ?? "-";
            pr.taste = data.taste?.[pr.id] ?? "-";
            let catName = (pr.category?.catName ?? '').toLowerCase();
            const isdrink = nonKitchenItems.some(ite => catName.includes(ite));
            if (catName && !isdrink) {
                pr.note = null;
                pr.taste = null;
            }
            if (in_kitchen && in_kitchen[pr.id]) {
                if (in_kitchen[pr.id] === data.quantity[pr.id]) {
                    pairs.push(pr);
                    // skipping
                } else {
                    pr.stock = in_kitchen[pr.id];
                    pairs.push(pr);
                    if (catName && !isdrink) {
                        toPrint.push(pr);
                    };
                }
            } else {
                pairs.push(pr);
                if (catName && !isdrink) {
                    toPrint.push(pr);
                };
            }

        });

        return res.json({
            status: true,
            order,
            table: order.tables,
            products: pairs,
            print: req.params.print !== 'false' ? toPrint : []
        });

    } catch (e) {

        error.message = e.message;
        return res.json({
            ...error,
            status: false,
            order: {},
            table: null,
            products: []
        });

    }

})

router.get(`/last-order`, fetchuser, async (req, res) => {
    try {
        let order = await Order.query().where('tenant_id', req.body.tenant_id).where('status', '<>', 'ongoing').orderBy("created_at", "DESC").withGraphFetched('cashier').first();
        const cashier = order?.cashier;
        // Same crash shape found and fixed in utils.js's generateReport (X-report bug,
        // owner-reported): `order.data` can be null (an ongoing/cancelled order swept up by
        // the `<> 'ongoing'` filter above, or a genuinely dataless row), and JSON.parse(null)
        // returns `null`, not `{}` -- reading `.quantity` off that null throws.
        let data = order.data ? JSON.parse(order.data) : {};

        const products = await Product.query().where('tenant_id', req.body.tenant_id).whereIn('id', keys(data.quantity ?? {}));
        const pairs = {};
        products.forEach(pr => {
            pr.taxAmount = calculateInclusiveTax(pr.price, pr.tax).toFixed(2);
            pairs[pr.id] = pr;
        });

        return res.json({
            status: true,
            order,
            products: pairs,
            session: data,
            cashier
        });

    } catch (e) {
        error.message = e.message;
        return res.json({
            ...error,
            status: false,
            order: {},
            products: [],
            session: [],
        });
    }

})

// RBAC full-enforcement audit (CTO forensic audit 2026-09-21): X/Z register reports are a
// core cashier/waiter end-of-shift duty (checking or closing out their own drawer), not a
// management-only "view reports" action -- there is no dedicated register-reports permission
// in the model, and gating these behind REPORTS_VIEW (admin/manager only, per
// config/permissions.js) would lock cashiers and waiters out of closing their own till, a
// real regression. Deliberately left open to any authenticated staff member; see
// test/rbac-audit.test.js's allowlist for the same reasoning, kept in one place.
router.post(`/x-report`, fetchuser, async (req, res) => {
    try {

        const payload = req.body;
        const { status, message, html } = await generateReport({ ...payload, type: 'X' });
        return res.json({
            status,
            message,
            html
        });

    } catch (error) {
        return res.json({
            status: false,
            message: error.message
        });
    }
});

router.post(`/z-report`, fetchuser, async (req, res) => {
    try {
        const payload = req.body;
        const { status, message, html, register_id } = await generateReport({...payload, type:'Z'})
        if(status){
            if(register_id) {
                await CashRegister.query().where('id', register_id).where('tenant_id', req.body.tenant_id).patch({
                    status:false
                });
            }
            await Table.query().where('tenant_id', req.body.tenant_id).patch({
                status: "free"
            });
        }
        res.json({ status, message, html});

    } catch (error) {
        res.json({ status: false, message: error.message })
    }
})

router.get('/reports', fetchuser, async (req, res) => {
    try { // it is updated with user_id
        const reports = await Report.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID).orderBy('id', 'desc');
        return res.json({ status: true, reports })
    } catch (error) {
        return res.json({ status: false, reports: [] })
    }
})

router.get('/day-close/:id', fetchuser, async (req, res) => {
    try {
        await generateReport({
            register_id: req.params.id,
            type: 'Z',
            myID: req.body.myID,
            currency: '€ ',
            // Data-integrity fix (project audit 2026-09-16): this call was the one route in
            // the app that forgot to pass tenant_id into generateReport at all -- see utils.js's
            // generateReport for the full writeup of what that call needing it actually fixes.
            tenant_id: req.body.tenant_id,
        });
        await CashRegister.query()
            .where('id', req.params.id)
            .where('tenant_id', req.body.tenant_id)
            .patch({ status: false }) // marking it as inactive session now

        return res.json({ status: true });

    } catch (error) {
        console.log(error)
        return res.json({ status: false, message: error.message })
    }
})

// STAGE 2 / phase 18 + 19: was completely unauthenticated — anyone could delete any
// generated report (and its PDF file on disk) with a bare GET. Now requires fetchuser;
// a DELETE alias is added as the correct-verb replacement.
async function removeReportHandler(req, res) {
    try {
        const report = await Report.query().findById(req.params.id).where('tenant_id', req.body.tenant_id);
        try {
            if (fs.existsSync(path.join(__dirname, '../tmp/' + report.path))) {
                fs.unlinkSync(path.join(__dirname, '../tmp/' + report.path));
            }
        } catch (error) { throw new Error("Failed to remove the file:" + error.message) }
        await Report.query().deleteById(req.params.id).where('tenant_id', req.body.tenant_id);
        return res.json({ status: true, message: "Report removed!" });

    } catch (error) {
        return res.json({ status: false })
    }
}
router.get('/remove-report/:id', fetchuser, removeReportHandler);
router.delete('/remove-report/:id', fetchuser, requirePermission(PERMISSIONS.REPORTS_VIEW), removeReportHandler);

module.exports=router
