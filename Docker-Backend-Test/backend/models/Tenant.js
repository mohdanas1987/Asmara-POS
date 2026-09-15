const { Model } = require('objection');

// Phase 1 / Task #10: one row per restaurant/business using the platform. Deliberately a
// plain Model (not a TenantModel) -- a tenant obviously isn't scoped to itself.
class Tenant extends Model {
    static get tableName() {
        return 'tenants';
    }
}

module.exports = Tenant;
