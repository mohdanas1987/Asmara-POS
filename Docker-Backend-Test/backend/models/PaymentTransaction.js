const TenantModel = require('./TenantModel');

// Billing & payments completeness (task #37): append-only ledger of real money movements
// against an order -- see migrations_local/0013_payment_transactions.js for the full
// rationale. Never updated in place except to flip `status` to 'voided' (a void doesn't
// delete history, it marks it inert).
class PaymentTransaction extends TenantModel {
  static get tableName() {
    return 'payment_transactions';
  }
}

module.exports = PaymentTransaction;
