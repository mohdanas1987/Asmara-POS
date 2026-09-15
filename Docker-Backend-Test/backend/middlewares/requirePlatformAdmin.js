/**
 * Gate for the super-admin panel. A platform admin is just a `users` row with
 * type === 'platform_admin' -- not scoped to any particular tenant's data, but the schema
 * still requires a tenant_id (NOT NULL, defaultTo 1) so that column is unused/ignored for
 * these accounts rather than meaning anything.
 *
 * Deliberately a SEPARATE check from the normal tenant-scoped `fetchuser` middleware (used
 * first, in front of this) rather than folding this into it -- every existing route stays
 * exactly as permissive/restrictive as before, and super-admin routes get an explicit,
 * visible extra gate rather than a silent special case buried in shared auth logic.
 *
 * There is deliberately no public signup path to this role (unlike /auth/signup-tenant for
 * restaurant admins) -- creating a platform admin is an operator action (seed script /
 * direct DB access), not something exposed over HTTP, since it grants cross-tenant read
 * access to every restaurant on the platform.
 */
const User = require('../models/User');

async function requirePlatformAdmin(req, res, next) {
    try {
        const user = await User.query().findById(req.body.myID);
        if (!user || user.type !== 'platform_admin') {
            return res.status(403).json({ status: false, message: 'Platform admin access required.' });
        }
        next();
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
}

module.exports = requirePlatformAdmin;
