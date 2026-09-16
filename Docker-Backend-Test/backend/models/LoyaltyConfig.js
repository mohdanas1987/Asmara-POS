const TenantModel = require('./TenantModel');

// Loyalty subsystem (project audit 2026-09-15). Per-tenant earn/redeem rates as data, not
// hardcoded constants -- see migrations_local/0010_loyalty.js for the field meanings.
class LoyaltyConfig extends TenantModel {
  static get tableName() {
    return 'loyalty_config';
  }
}

module.exports = LoyaltyConfig;
