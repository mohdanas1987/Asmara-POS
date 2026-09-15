const TenantModel = require('./TenantModel');

class PaymentTerminalSettings extends TenantModel {
    static get tableName() {
        return 'payment_terminal_settings';
    }
}

module.exports = PaymentTerminalSettings;
