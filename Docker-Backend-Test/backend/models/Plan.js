const { Model } = require('objection');

// Global (not tenant-scoped -- a plan belongs to the platform, not to one restaurant).
// Fully managed by the platform admin via routes/billing-admin.js; no hardcoded tiers here.
class Plan extends Model {
    static get tableName() {
        return 'plans';
    }
}

module.exports = Plan;
