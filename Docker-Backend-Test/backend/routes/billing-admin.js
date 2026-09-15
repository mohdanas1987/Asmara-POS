/**
 * Dynamic billing management -- built per explicit instruction: the platform admin adds/edits
 * as many plans and payment partners as they want from the Super Admin panel, rather than this
 * codebase hardcoding fixed tiers or a single payment provider. Nothing here processes a real
 * charge; `payment_providers.mode` and `subscriptions.status` stay in sandbox/mock territory
 * until a real go-live decision is made (see VERIFICATION.md "billing groundwork" entry).
 * Gated identically to routes/superadmin.js: fetchuser then requirePlatformAdmin.
 */
const router = require('express').Router();
const fetchuser = require('../middlewares/loggedIn');
const requirePlatformAdmin = require('../middlewares/requirePlatformAdmin');
const Plan = require('../models/Plan');
const PaymentProvider = require('../models/PaymentProvider');
const Subscription = require('../models/Subscription');
const Tenant = require('../models/Tenant');

router.use(fetchuser, requirePlatformAdmin);

// ---------- Plans ----------

router.get('/plans', async (req, res) => {
    try {
        const plans = await Plan.query().orderBy(['sort_order', 'id']);
        return res.json({ status: true, plans });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.post('/plans', async (req, res) => {
    try {
        if (!req.body.name || !req.body.slug) {
            return res.status(400).json({ status: false, message: 'Plan name and slug are required.' });
        }
        const existing = await Plan.query().where('slug', req.body.slug).first();
        if (existing) return res.status(400).json({ status: false, message: 'A plan with that slug already exists.' });

        const plan = await Plan.query().insert({
            name: req.body.name,
            slug: req.body.slug,
            description: req.body.description ?? null,
            price_cents: Number.isFinite(Number(req.body.price_cents)) ? Number(req.body.price_cents) : 0,
            currency: req.body.currency || 'EUR',
            billing_interval: req.body.billing_interval || 'monthly',
            features: Array.isArray(req.body.features) ? JSON.stringify(req.body.features) : (req.body.features ?? null),
            is_active: req.body.is_active ?? true,
            is_default: req.body.is_default ?? false,
            sort_order: Number.isFinite(Number(req.body.sort_order)) ? Number(req.body.sort_order) : 0,
        });

        // Only one plan can be the auto-offered default at signup.
        if (plan.is_default) {
            await Plan.query().whereNot('id', plan.id).patch({ is_default: false });
        }

        return res.json({ status: true, plan });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.patch('/plans/:id', async (req, res) => {
    try {
        const plan = await Plan.query().findById(req.params.id);
        if (!plan) return res.status(404).json({ status: false, message: 'Plan not found.' });

        const patch = {};
        ['name', 'description', 'currency', 'billing_interval'].forEach((f) => {
            if (req.body[f] !== undefined) patch[f] = req.body[f];
        });
        if (req.body.price_cents !== undefined) patch.price_cents = Number(req.body.price_cents) || 0;
        if (req.body.sort_order !== undefined) patch.sort_order = Number(req.body.sort_order) || 0;
        if (req.body.is_active !== undefined) {
            patch.is_active = !!req.body.is_active;
            // A deactivated plan can't remain the auto-offered signup default -- otherwise a
            // new restaurant that doesn't pick a plan silently ends up with none at all
            // (auth.js's fallback query requires is_default AND is_active).
            if (!patch.is_active) patch.is_default = false;
        }
        if (req.body.features !== undefined) {
            patch.features = Array.isArray(req.body.features) ? JSON.stringify(req.body.features) : req.body.features;
        }
        patch.updated_at = new Date().toISOString();

        const updated = await Plan.query().patchAndFetchById(req.params.id, patch);

        if (req.body.is_default !== undefined) {
            if (req.body.is_default) {
                await Plan.query().whereNot('id', updated.id).patch({ is_default: false });
                await Plan.query().patchAndFetchById(updated.id, { is_default: true });
            } else {
                await Plan.query().patchAndFetchById(updated.id, { is_default: false });
            }
        }

        const fresh = await Plan.query().findById(req.params.id);
        return res.json({ status: true, plan: fresh });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

// Soft "delete" -- deactivates rather than hard-deleting, so existing subscriptions that
// reference this plan (via ON DELETE SET NULL if hard-deleted) don't silently lose context.
router.delete('/plans/:id', async (req, res) => {
    try {
        const plan = await Plan.query().findById(req.params.id);
        if (!plan) return res.status(404).json({ status: false, message: 'Plan not found.' });
        const inUse = await Subscription.query().where('plan_id', req.params.id).resultSize();
        if (inUse > 0) {
            const updated = await Plan.query().patchAndFetchById(req.params.id, { is_active: false, is_default: false });
            return res.json({ status: true, plan: updated, message: 'Plan is in use by existing subscriptions -- deactivated instead of deleted.' });
        }
        await Plan.query().deleteById(req.params.id);
        return res.json({ status: true, message: 'Plan deleted.' });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

// ---------- Payment providers (platform billing partners, not in-restaurant terminals) ----------

router.get('/payment-providers', async (req, res) => {
    try {
        const providers = await PaymentProvider.query().orderBy('id');
        return res.json({ status: true, payment_providers: providers });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.post('/payment-providers', async (req, res) => {
    try {
        if (!req.body.name || !req.body.provider_key) {
            return res.status(400).json({ status: false, message: 'Provider name and key are required.' });
        }
        const provider = await PaymentProvider.query().insert({
            name: req.body.name,
            provider_key: req.body.provider_key,
            mode: req.body.mode === 'live' ? 'live' : 'sandbox',
            config: typeof req.body.config === 'object' ? JSON.stringify(req.body.config) : (req.body.config ?? null),
            is_active: req.body.is_active ?? true,
        });
        return res.json({ status: true, payment_provider: provider });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.patch('/payment-providers/:id', async (req, res) => {
    try {
        const existing = await PaymentProvider.query().findById(req.params.id);
        if (!existing) return res.status(404).json({ status: false, message: 'Payment provider not found.' });
        const patch = {};
        ['name', 'provider_key'].forEach((f) => {
            if (req.body[f] !== undefined) patch[f] = req.body[f];
        });
        if (req.body.mode !== undefined) patch.mode = req.body.mode === 'live' ? 'live' : 'sandbox';
        if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active;
        if (req.body.config !== undefined) {
            patch.config = typeof req.body.config === 'object' ? JSON.stringify(req.body.config) : req.body.config;
        }
        patch.updated_at = new Date().toISOString();
        const updated = await PaymentProvider.query().patchAndFetchById(req.params.id, patch);
        return res.json({ status: true, payment_provider: updated });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.delete('/payment-providers/:id', async (req, res) => {
    try {
        const existing = await PaymentProvider.query().findById(req.params.id);
        if (!existing) return res.status(404).json({ status: false, message: 'Payment provider not found.' });
        const inUse = await Subscription.query().where('payment_provider_id', req.params.id).resultSize();
        if (inUse > 0) {
            const updated = await PaymentProvider.query().patchAndFetchById(req.params.id, { is_active: false });
            return res.json({ status: true, payment_provider: updated, message: 'Provider is in use by existing subscriptions -- deactivated instead of deleted.' });
        }
        await PaymentProvider.query().deleteById(req.params.id);
        return res.json({ status: true, message: 'Payment provider deleted.' });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

// ---------- Subscriptions (assigning a tenant to a plan / provider / status) ----------

router.get('/tenants/:id/subscription', async (req, res) => {
    try {
        const tenant = await Tenant.query().findById(req.params.id);
        if (!tenant) return res.status(404).json({ status: false, message: 'Tenant not found.' });
        const subscription = await Subscription.query()
            .where('tenant_id', req.params.id)
            .withGraphFetched('[plan, paymentProvider]')
            .orderBy('id', 'desc')
            .first();
        return res.json({ status: true, subscription: subscription ?? null });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.post('/tenants/:id/subscription', async (req, res) => {
    try {
        const tenant = await Tenant.query().findById(req.params.id);
        if (!tenant) return res.status(404).json({ status: false, message: 'Tenant not found.' });

        const existing = await Subscription.query().where('tenant_id', req.params.id).orderBy('id', 'desc').first();
        const patchData = {
            plan_id: req.body.plan_id ?? existing?.plan_id ?? null,
            payment_provider_id: req.body.payment_provider_id ?? existing?.payment_provider_id ?? null,
            status: req.body.status || existing?.status || 'trialing',
            current_period_end: req.body.current_period_end ?? existing?.current_period_end ?? null,
            updated_at: new Date().toISOString(),
        };

        let subscription;
        if (existing) {
            subscription = await Subscription.query().patchAndFetchById(existing.id, patchData);
        } else {
            subscription = await Subscription.query().insert({ tenant_id: Number(req.params.id), ...patchData });
        }
        const fresh = await Subscription.query().findById(subscription.id).withGraphFetched('[plan, paymentProvider]');
        return res.json({ status: true, subscription: fresh });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

module.exports = router;
