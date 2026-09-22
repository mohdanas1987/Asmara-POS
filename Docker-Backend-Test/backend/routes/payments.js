/**
 * Payment terminal support — routes only pick the right adapter (payments/*.js) and read/
 * write config; they never talk to a provider SDK directly. See payments/README.md for the
 * shared adapter shape and an honest account of what's verified vs. not.
 *
 * Payment state machine + crash/recovery/reconciliation (CTO feedback 2026-09-22, items 5-6):
 * POST /charge now writes a payment_attempts row BEFORE calling the provider (see
 * services/payments/paymentAttempts.js), records the resulting charge into the real
 * payment_transactions ledger the moment the provider confirms it captured, and exposes
 * POST /attempts/:id/reconcile + GET /attempts so a charge left in an ambiguous state (a
 * crash, a dropped connection, a provider that resolves asynchronously) can be resolved
 * against the provider's own truth instead of just vanishing with no trace, which is what
 * happened before this change -- see routes/payments.js's git history / the migration's
 * header comment for the concrete gap this closes.
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
const idempotent = require('../middlewares/idempotent');
const { PERMISSIONS } = require('../config/permissions');
const PaymentTerminalSettings = require('../models/PaymentTerminalSettings');
const PaymentAttempt = require('../models/PaymentAttempt');
const paymentAttempts = require('../services/payments/paymentAttempts');

const ADAPTERS = {
    stripe: require('../payments/stripe'),
    adyen: require('../payments/adyen'),
    sumup: require('../payments/sumup'),
    mollie: require('../payments/mollie'),
    // Always-available demo/test provider -- see payments/mock.js's header comment. Real
    // providers require an SDK + credentials that aren't available in this environment
    // (payments/README.md); this is what actually exercises the state machine end to end.
    mock: require('../payments/mock'),
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
        const { provider, api_key, api_secret, terminal_id, mock_behavior } = req.body;
        if (!ADAPTERS[provider]) {
            return res.status(400).json({ status: false, message: `Unknown provider: ${provider}. Supported: ${Object.keys(ADAPTERS).join(', ')}.` });
        }
        // The mock provider (payments/mock.js) deliberately needs no real credentials.
        if (provider !== 'mock' && !api_key) {
            return res.status(400).json({ status: false, message: 'api_key is required.' });
        }

        const existing = await getSettings(req.body.tenant_id);
        const payload = {
            provider,
            api_key: api_key ?? null,
            api_secret: api_secret ?? null,
            terminal_id: terminal_id ?? null,
            connected: true,
            mock_behavior: provider === 'mock' ? (mock_behavior || 'succeed') : null,
        };

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

router.post('/charge', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), idempotent('payments.charge'), async (req, res) => {
    const tenantId = req.body.tenant_id;
    let attempt;
    try {
        const settings = await getSettings(tenantId);
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

        // Written BEFORE the provider is ever called -- this is the actual crash-recovery
        // mechanism (see migrations_local/0024's header comment): even a process crash right
        // after this line leaves a real 'initiated' row instead of the charge attempt simply
        // never having existed anywhere.
        attempt = await paymentAttempts.startAttempt({
            tenantId, orderId: order_id, provider: settings.provider, terminalId: settings.terminal_id,
            amount, currency: 'eur', createdBy: req.body.myID,
        });

        let result;
        try {
            result = await adapter.createTerminalPayment(settings, { amount, currency: 'eur', orderId: order_id });
        } catch (adapterError) {
            const failedAttempt = await paymentAttempts.finalizeFailed({ tenantId, attempt, errorMessage: adapterError.message });
            return res.status(502).json({ status: false, message: adapterError.message, attempt: failedAttempt });
        }

        const normalized = paymentAttempts.normalizeStatus(result?.status);
        let finalAttempt;
        if (normalized === 'succeeded') {
            finalAttempt = await paymentAttempts.finalizeSucceeded({ tenantId, attempt, providerPaymentId: result.id, method: settings.provider });
        } else if (normalized === 'failed') {
            finalAttempt = await paymentAttempts.finalizeFailed({ tenantId, attempt, errorMessage: `Provider reports: ${result?.status}`, providerPaymentId: result.id });
        } else {
            // 'pending' -- the provider hasn't resolved this yet (e.g. still waiting for the
            // card to be tapped/inserted on the physical reader). Not a failure: the caller
            // should poll POST /payments/attempts/:id/reconcile once the terminal finishes.
            finalAttempt = await paymentAttempts.markPending({ tenantId, attempt, providerPaymentId: result.id });
        }

        return res.json({ status: normalized === 'succeeded', payment: result, attempt: finalAttempt });
    } catch (err) {
        // Real adapter errors (missing SDK, missing credentials, a real network failure)
        // surface here honestly rather than being swallowed into a fake success.
        return res.status(502).json({ status: false, message: err.message });
    }
});

// Crash/restart recovery + reconciliation (CTO feedback 2026-09-22, item 6): resolves an
// attempt still sitting in 'initiated' or 'pending' by asking the provider what actually
// happened, and finalizes it (including recording the ledger charge, exactly once, if it
// turns out to have succeeded) -- see services/payments/paymentAttempts.js's reconcile().
router.post('/attempts/:id/reconcile', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), async (req, res) => {
    try {
        const tenantId = req.body.tenant_id;
        const attempt = await PaymentAttempt.forTenant(tenantId).findById(req.params.id);
        if (!attempt) {
            return res.status(404).json({ status: false, message: 'Payment attempt not found.' });
        }
        const settings = await getSettings(tenantId);
        const adapter = ADAPTERS[attempt.provider];
        if (!settings || !adapter) {
            return res.status(400).json({ status: false, message: `No configured adapter for provider "${attempt.provider}".` });
        }

        const resolved = await paymentAttempts.reconcile({ tenantId, attemptId: attempt.id, settings, adapter });
        return res.json({ status: true, attempt: resolved });
    } catch (err) {
        return res.status(502).json({ status: false, message: err.message });
    }
});

// Visibility into attempts that still need attention -- an operator (or a future automated
// reconciliation job, not built in this pass) uses this to find every charge left dangling in
// 'initiated'/'pending' after a crash, rather than that state being invisible.
router.get('/attempts', fetchuser, requirePermission(PERMISSIONS.ORDERS_CREATE), async (req, res) => {
    try {
        const tenantId = req.body.tenant_id;
        let query = PaymentAttempt.forTenant(tenantId).orderBy('id', 'desc');
        if (req.query.status) {
            query = query.where('status', req.query.status);
        }
        if (req.query.order_id) {
            query = query.where('order_id', String(req.query.order_id));
        }
        const attempts = await query.limit(200);
        return res.json({ status: true, attempts });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

module.exports = router;
