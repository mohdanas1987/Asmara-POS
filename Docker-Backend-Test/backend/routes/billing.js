/**
 * Public billing routes -- unauthenticated by design, since a prospective restaurant picking
 * a plan on the signup page isn't logged in yet. Read-only, and returns only the fields a
 * signup form needs (never internal config/secrets from payment_providers).
 */
const router = require('express').Router();
const Plan = require('../models/Plan');

router.get('/plans', async (req, res) => {
    try {
        const plans = await Plan.query()
            .where('is_active', true)
            .orderBy(['sort_order', 'id'])
            .select(['id', 'name', 'slug', 'description', 'price_cents', 'currency', 'billing_interval', 'features', 'is_default']);
        return res.json({ status: true, plans });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

module.exports = router;
