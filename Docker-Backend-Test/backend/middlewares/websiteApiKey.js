/**
 * Auth for the website-facing endpoints (menu feed, order webhook). These are called by the
 * restaurant's WEBSITE, not by a logged-in staff member, so there's no JWT -- a per-tenant
 * API key (generated when the restaurant connects, see routes/website.js) stands in for it.
 *
 * Phase 1 is single-tenant in practice (see the same "default to tenant 1" precedent used by
 * menu.js's and items.js's own public routes), so the key is looked up against tenant 1's
 * connection row. Multi-tenant key routing (e.g. one key per restaurant, looked up without
 * assuming which tenant) is a real Phase 2 concern once there's more than one live tenant.
 */
const WebsiteConnection = require('../models/WebsiteConnection');

module.exports = async function websiteApiKey(req, res, next) {
    try {
        const key = req.header('x-api-key');
        if (!key) {
            return res.status(401).json({ status: false, message: 'Missing x-api-key header.' });
        }
        const connection = await WebsiteConnection.query().where('tenant_id', 1).first();
        if (!connection || !connection.connected || connection.api_key !== key) {
            return res.status(401).json({ status: false, message: 'Invalid or inactive API key.' });
        }
        req.body.tenant_id = connection.tenant_id;
        next();
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
};
