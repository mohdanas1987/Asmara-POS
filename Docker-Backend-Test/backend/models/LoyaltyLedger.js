const TenantModel = require('./TenantModel');

// Loyalty subsystem (project audit 2026-09-15). Append-only: rows are inserted, never
// updated or deleted. A customer's balance is always SUM(points) over their rows here --
// see services/loyaltyService.js -- never a mutable counter on the customer record itself.
class LoyaltyLedger extends TenantModel {
  static get tableName() {
    return 'loyalty_ledger';
  }
}

module.exports = LoyaltyLedger;
