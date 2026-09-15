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
            tableOrders[order.tables] = {
                id: order.id,
                data: JSON.parse(order.data ?? '{}'),
                status: order.status,
                payment: order.payment_status,
                taste: order.taste,
                total: order.total,
                note: order.note
            };
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
        const deleted = await Order.query().deleteById(req.params.order).where('tenant_id', req.body.tenant_id);

        await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', req.params.table.split("+")).patch({
            status: "free"
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
router.get('/cancel/:order/:table', fetchuser, cancelOrderHandler);
router.post('/cancel/:order/:table', fetchuser, cancelOrderHandler);

// STAGE 2 / phase 18 + 19: same treatment as cancel above — was unauthenticated, was GET.
async function finishOrderHandler(req, res) {
    try {

        const order = await Order.query().patchAndFetchById(req.params.order, {
            status: "completed"
        }).where('tenant_id', req.body.tenant_id);

        const tables = req.params.table.indexOf('+') === -1 ? [req.params.table] : req.params.table.split('+');

        await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tables).patch({
            status: "free",
            linked_to: null
        });

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
router.get('/finish/:order/:table', fetchuser, finishOrderHandler);
router.post('/finish/:order/:table', fetchuser, finishOrderHandler);

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
        return res.json({ status: true, message: 'Order accepted -- sent to kitchen!', order });
    } catch (error) {
        return res.json({ status: false, message: error.message });
    }
}
router.post('/accept/:order', fetchuser, acceptOrderHandler);

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
router.post('/prepared/:order', fetchuser, markPreparedHandler);

router.post('/create', fetchuser, async (req, res) => {
    try {
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
            payment_status: "paid"
        };

        if(req.body.extra) {
            payload.added_total = null
        }

        const order = await Order.query().patchAndFetchById(req.body.order_id, payload).where('tenant_id', req.body.tenant_id);

        if (!order) {
            throw new Error('Error creating order');
        }

        if (req.body.data) {
            await CashRegister.query().findById(lastSession).where('tenant_id', req.body.tenant_id).patch({
                closing_cash: CashRegister.raw(`closing_cash + ?`, [order.total]),
            });

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

router.get('/link/:tables', fetchuser, async (req, res) => {

    try {
        let link = req.params.tables;
        await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', link.split("+")).patch({
            linked_to: link
        });

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

});

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

        return res.json({ order, status: true });

    } catch (err) {
        return res.status(500).json({ ...error, exception: err.message });
    }

})

// STAGE 2 / phase 18: was unauthenticated (verb was already correct — POST).
router.post('/to-kitchen/:table?', fetchuser, async (req, res) => {
    try {
        let payload = { status: 'in-kitchen' }

        if (req.body.data) {
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
            order = await Order.query().patchAndFetchById(req.body.order_id, payload).where('tenant_id', req.body.tenant_id);
            if (order.tables) {
                const tables = order.tables ? [order.tables] : order.tables.split('+');
                await Table.query().where('tenant_id', req.body.tenant_id).whereIn('table_number', tables).patch({ status: "occupied" });
            }
        } else {
            order = await Order.query().insertAndFetch({ ...payload, note: "From direct sale.", tenant_id: req.body.tenant_id });
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
        }

        return res.json({
            status: true,
            message: msg,
            order,
            only: updatedQt
        });

    } catch (error) {
        console.log(error.message)
        return res.json({ status: false })
    }
})

router.post('/payment-update', fetchuser, async (req, res) => {
    try {

        let modes = req.body.modes;
        if ((req.body.payment_mode).indexOf(',') !== -1) {
            modes = { ...req.body.data, modes };
        } else {
            modes = req.body.data;
        }

        const order = await Order.query().findById(req.body.order_id).where('tenant_id', req.body.tenant_id).patch({
            payment_status: "paid",
            updated_at: europeanDate(),
            data: modes
        });

        return res.json({
            status: true,
            message: "Payment completed!",
            order
        });

    } catch (error) {
        return res.json({ status: false, exception: error.message, message: "An error occurred!" });
    }
})

router.get('/view-order/:id', fetchuser, async (req, res) => {
    try {
        let orderID = req.params.id;

        let order = await Order.query().where('id', orderID).where('tenant_id', req.body.tenant_id).withGraphFetched('cashier').first();

        let data = typeof order.data === 'string' ? JSON.parse(order.data) : order.data;
        const products = await Product.query().where('tenant_id', req.body.tenant_id).whereIn('id', keys(data?.quantity ?? {}));
        const pairs = {};
        products.forEach(pr => {
            pr.taxAmount = pr.tax && pr.tax !== 'null' ? (pr.price.replace(/\s+/g, '')?.replace(",", '.') * parseFloat(pr.tax) / 100).toFixed(2) : 0.00;
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
            pr.taxAmount = pr.tax && pr.tax !== 'null' ? (pr.price.replace(/\s+/g, '')?.replace(",", '.') * parseFloat(pr.tax) / 100).toFixed(2) : 0.00;
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
        let data = JSON.parse(order.data);

        const products = await Product.query().where('tenant_id', req.body.tenant_id).whereIn('id', keys(data.quantity));
        const pairs = {};
        products.forEach(pr => {
            pr.taxAmount = pr.tax && pr.tax !== 'null' ? (pr.price.replace(/\s+/g, '')?.replace(",", '.') * parseFloat(pr.tax) / 100).toFixed(2) : 0.00;
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
            currency: '€ '
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
router.delete('/remove-report/:id', fetchuser, removeReportHandler);

module.exports=router
