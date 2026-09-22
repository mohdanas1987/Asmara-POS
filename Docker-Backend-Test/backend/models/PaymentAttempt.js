const TenantModel = require('./TenantModel');

// Payment state machine (CTO feedback 2026-09-22, items 5-6) -- see
// migrations_local/0024_payment_attempts.js for the full rationale. One row per
// terminal-charge attempt, written before the provider is ever called.
class PaymentAttempt extends TenantModel {
    static get tableName() {
        return 'payment_attempts';
    }
}

module.exports = PaymentAttempt;
