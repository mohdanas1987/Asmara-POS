const { Model } = require('objection');

// Global (platform-level payment partner config, e.g. "Stripe (sandbox)", "Mollie (sandbox)")
// -- NOT the in-restaurant payment terminal settings (see PaymentTerminalSettings.js, which
// is tenant-scoped and already wired for real terminal hardware). This table only ever holds
// non-secret display/config fields; see the 0007_billing migration comment for why.
class PaymentProvider extends Model {
    static get tableName() {
        return 'payment_providers';
    }
}

module.exports = PaymentProvider;
