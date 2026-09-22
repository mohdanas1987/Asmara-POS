/**
 * Website <-> POS integration (Phase 1 build, new feature -- see migrations_local/0004).
 *
 * Two staff-facing routes (JWT auth, same pattern as every other route file) manage the
 * connection; two website-facing routes (API-key auth, see middlewares/websiteApiKey.js) are
 * what the restaurant's actual website would call once connected. The POS never calls out to
 * the website in either direction -- it only serves the menu feed and accepts the order
 * webhook. Real-time push to the POS UI (Socket.IO) happens on a successful order webhook.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const fetchuser = require('../middlewares/loggedIn');
// RBAC full-enforcement audit (CTO forensic audit 2026-09-21, "Full RBAC enforcement audit"):
// connecting/disconnecting the public website integration is tenant-wide config -- gated
// behind SETTINGS_MANAGE, same as every other integration route. POST /orders is unaffected
// (it's the public-facing webhook, correctly gated by its own websiteApiKey middleware
// instead, not tenant-staff RBAC).
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const websiteApiKey = require('../middlewares/websiteApiKey');
const idempotent = require('../middlewares/idempotent');
const WebsiteConnection = require('../models/WebsiteConnection');
const MenuCategory = require('../models/MenuCategory');
const Product = require('../models/Item');
const Order = require('../models/Order');

function maskKey(key) {
    if (!key) return null;
    return `${key.slice(0, 4)}${'*'.repeat(Math.max(key.length - 8, 4))}${key.slice(-4)}`;
}

// --- Staff-facing (JWT) ---

router.get('/status', fetchuser, async (req, res) => {
    try {
        const connection = await WebsiteConnection.query().where('tenant_id', req.body.tenant_id).first();
        return res.json({
            status: true,
            connected: !!connection?.connected,
            website_url: connection?.website_url ?? null,
            api_key_masked: maskKey(connection?.api_key),
        });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.post('/connect', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        if (!req.body.website_url) {
            return res.status(400).json({ status: false, message: 'website_url is required.' });
        }
        const apiKey = crypto.randomBytes(24).toString('hex');
        const existing = await WebsiteConnection.query().where('tenant_id', req.body.tenant_id).first();

        if (existing) {
            await WebsiteConnection.query().findById(existing.id).patch({
                website_url: req.body.website_url,
                api_key: apiKey,
                connected: true,
            });
        } else {
            await WebsiteConnection.query().insert({
                tenant_id: req.body.tenant_id,
                website_url: req.body.website_url,
                api_key: apiKey,
                connected: true,
            });
        }

        return res.json({ status: true, message: 'Website connected.', api_key: apiKey });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.post('/disconnect', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        await WebsiteConnection.query().where('tenant_id', req.body.tenant_id).patch({ connected: false });
        return res.json({ status: true, message: 'Website disconnected. Online orders are now disabled.' });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

// --- Website-facing (API key) ---

// Pull-based menu sync: the website calls this (on whatever schedule its plugin uses) --
// the POS never calls the website. Same shape as routes/items.js's public listing so a
// website integration can reuse the same field names it would already expect.
router.get('/menu-feed', websiteApiKey, async (req, res) => {
    try {
        const categories = await MenuCategory.query().where('tenant_id', req.body.tenant_id).orderBy('sq_pos').select(['id', 'name']);
        const products = await Product.query().where('tenant_id', req.body.tenant_id).where('deleted', false).select(['id', 'name', 'price', 'category_id', 'image']);
        return res.json({ status: true, categories, products });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

// Website <-> POS synchronization (CTO feedback 2026-09-22, item 15): a website's checkout
// plugin retrying this webhook after a timeout/dropped-response (an extremely common failure
// mode for any webhook -- the order WAS created here, but the website never saw the response
// confirming it) used to create a completely separate, duplicate online order every single
// retry, with no way to tell they were meant to be the same purchase. Wrapped in the same
// hardened `idempotent()` middleware already used for /orders/create, /orders/to-kitchen,
// /orders/init, etc. (migrations_local/0023, middlewares/idempotent.js) -- a resend with the
// same `idempotency_key` (the website should send ITS OWN order id here) returns the exact
// same {order, status:true} response instead of creating a second order. OPTIONAL, so a
// website integration that doesn't send one yet is completely unaffected (Preservation
// Contract) -- exactly the same opt-in shape as every other idempotent route in this codebase.
router.post('/orders', websiteApiKey, idempotent('website.orders'), async (req, res) => {
    try {
        const { items, total, customer_name, note } = req.body;
        if (!items || !total) {
            return res.status(400).json({ status: false, message: 'items and total are required.' });
        }

        const order = await Order.query().insertAndFetch({
            tenant_id: req.body.tenant_id,
            source: 'online',
            status: 'ongoing',
            payment_status: 'pending',
            total,
            data: JSON.stringify({ items, customer_name }),
            note: note ?? `Online order${customer_name ? ` from ${customer_name}` : ''}`,
        });

        const io = req.app.get('io');
        if (io) io.emit('online-order', { order });

        return res.json({ status: true, message: 'Order received.', order });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

module.exports = router;
