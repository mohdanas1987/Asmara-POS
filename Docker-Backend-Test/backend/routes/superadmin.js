/**
 * Super-admin panel routes -- cross-tenant, read-mostly (per the build plan: "safe support
 * tools, view-only by default"). Every route here is gated by fetchuser (must be a real,
 * logged-in user) THEN requirePlatformAdmin (must specifically be a platform admin) -- see
 * that middleware for why a platform admin is a distinct thing from a normal tenant admin.
 */
const router = require('express').Router();
const fetchuser = require('../middlewares/loggedIn');
const requirePlatformAdmin = require('../middlewares/requirePlatformAdmin');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Order = require('../models/Order');
const Subscription = require('../models/Subscription');

router.use(fetchuser, requirePlatformAdmin);

// Tenant list with basic usage/health at a glance -- user count, order count, most recent
// order -- exactly what the build plan asked for ("tenant list, usage/health at a glance"),
// nothing more invasive than that.
router.get('/tenants', async (req, res) => {
    try {
        const tenants = await Tenant.query().orderBy('id');
        const userCounts = await User.query().count('id as count').groupBy('tenant_id').select('tenant_id');
        const orderCounts = await Order.query().count('id as count').groupBy('tenant_id').select('tenant_id');
        const lastOrders = await Order.query()
            .max('created_at as last_order_at')
            .groupBy('tenant_id')
            .select('tenant_id');

        const userCountByTenant = Object.fromEntries(userCounts.map((r) => [r.tenant_id, Number(r.count)]));
        const orderCountByTenant = Object.fromEntries(orderCounts.map((r) => [r.tenant_id, Number(r.count)]));
        const lastOrderByTenant = Object.fromEntries(lastOrders.map((r) => [r.tenant_id, r.last_order_at]));

        // Billing groundwork: surface each tenant's current subscription (plan name + status)
        // right in the tenant list, since that's exactly the "usage/health at a glance" the
        // build plan asked for -- one query, not a per-tenant loop.
        const subscriptions = await Subscription.query().withGraphFetched('plan').orderBy('id', 'desc');
        const subscriptionByTenant = {};
        subscriptions.forEach((s) => {
            if (!(s.tenant_id in subscriptionByTenant)) subscriptionByTenant[s.tenant_id] = s;
        });

        const result = tenants.map((t) => {
            const sub = subscriptionByTenant[t.id];
            return {
                id: t.id,
                name: t.name,
                slug: t.slug,
                status: t.status,
                created_at: t.created_at,
                user_count: userCountByTenant[t.id] ?? 0,
                order_count: orderCountByTenant[t.id] ?? 0,
                last_order_at: lastOrderByTenant[t.id] ?? null,
                subscription_status: sub ? sub.status : null,
                plan_name: sub && sub.plan ? sub.plan.name : null,
            };
        });

        return res.json({ status: true, tenants: result });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

router.get('/tenants/:id', async (req, res) => {
    try {
        const tenant = await Tenant.query().findById(req.params.id);
        if (!tenant) return res.status(404).json({ status: false, message: 'Tenant not found.' });
        const users = await User.query().where('tenant_id', req.params.id).select(['id', 'name', 'email', 'type', 'status']);
        const orderCount = await Order.query().where('tenant_id', req.params.id).resultSize();
        return res.json({ status: true, tenant, users, order_count: orderCount });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

// Suspend/reactivate a tenant -- the one write action here, and a reversible, non-destructive
// one (flips `status`; never deletes anything). Deliberately the only mutation in this file.
router.post('/tenants/:id/toggle', async (req, res) => {
    try {
        const tenant = await Tenant.query().findById(req.params.id);
        if (!tenant) return res.status(404).json({ status: false, message: 'Tenant not found.' });
        const updated = await Tenant.query().patchAndFetchById(req.params.id, { status: !tenant.status });
        return res.json({ status: true, tenant: updated });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

module.exports = router;
