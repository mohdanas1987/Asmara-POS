/**
 * Payment terminal support — routes only pick the right adapter (payments/*.js) and read/
 * write config; they never talk to a provider SDK directly. See payments/README.md for the
 * shared adapter shape and an honest account of what's verified vs. not.
 */
const express = require('express');
const router = express.Router();

const fetchuser = require('../middlewares/loggedIn');
// RBAC full-enforcement audit (CTO forensic audit 2026-09-21, "Full RBAC enforcement audit"):
// connecting/disconnecting a payment terminal integration is sensitive tenant-wide config
// (stores provider API secrets) -- gated behind SETTINGS_MANAGE, same as every other
// integration-config route (routes/website.js, routes/sync.js). Firing an actual terminal
// charge is a checkout action, gated behind ORDERS_CREATE like every other checkout route.
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const PaymentTerminalSettings = require('../models/PaymentTerminalSettings');

const ADAPTERS = {
    stripe: require('../payments/stripe'),
    adyen: require('../payments/adyen'),
    sumup: require('../payments/sumup'),
    mollie: require('../payments/mollie'),
};

function maskSecret(value) {
    if (!value) return null;
    return `${value.slice(0, 4)}${'*'.repeat(Math.max(value.length - 8, 4))}${value.slice(-4)}`;
}

async function getSettings(tenantId) {
    return PaymentTerminalSettings.query().where('tenant_id', tenantId).first();
}

router.get('/status', fetchuser, async (req, res) => {
    try {
        const settings = await getSettings(req.body.tenant_id);
        return res.json({
            status: true,
            connected: !!settings?.connected,
            provider: settings?.provider ?? null,
            terminal_id: settings?.terminal_id ?? null,
            api_key_masked: maskSecret(settings?.api_key),
        });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.post('/connect', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        const { provider, api_key, api_secret, terminal_id } = req.body;
        if (!ADAPTERS[provider]) {
            return res.status(400).json({ status: false, message: `Unknown provider: ${provider}. Supported: ${Object.keys(ADAPTERS).join(', ')}.` });
        }
        if (!api_key) {
            return res.status(400).json({ status: false, message: 'api_key is required.' });
        }

        const existing = await getSettings(req.body.tenant_id);
        const payload = { provider, api_key, api_secret: api_secret ?? null, terminal_id: terminal_id ?? null, connected: true };

        if (existing) {
            await PaymentTerminalSettings.query().findById(existing.id).patch(payload);
        } else {
            await PaymentTerminalSettings.query().insert({ tenant_id: req.body.tenant_id, ...payload });
        }

        return res.json({ status: true, message: `${provider} connected.` });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.post('/disconnect', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        await PaymentTerminalSettings.query().where('tenant_id', req.body.tenant_id).patch({ connected: false });
        return res.json({ status: true, message: 'Payment terminal disconnected.' });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.post('/charge', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), async (req, res) => {
    try {
        const settings = await getSettings(req.body.tenant_id);
        if (!settings?.connected) {
            return res.status(400).json({ status: false, message: 'No payment terminal is connected.' });
        }
        const adapter = ADAPTERS[settings.provider];
        if (!adapter.isConfigured(settings)) {
            return res.status(400).json({ status: false, message: `${settings.provider} is connected but missing required configuration.` });
        }

        const { amount, order_id } = req.body;
        if (!amount || !order_id) {
            return res.status(400).json({ status: false, message: 'amount and order_id are required.' });
        }

        const result = await adapter.createTerminalPayment(settings, { amount, currency: 'eur', orderId: order_id });
        return res.json({ status: true, payment: result });
    } catch (err) {
        // Real adapter errors (missing SDK, missing credentials, a real network failure)
        // surface here honestly rather than being swallowed into a fake success.
        return res.status(502).json({ status: false, message: err.message });
    }
});

module.exports = router;
