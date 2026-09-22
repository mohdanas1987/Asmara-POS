const TenantModel = require('./TenantModel');

class IdempotencyKey extends TenantModel {
    static get tableName() {
        return 'idempotency_keys';
    }
}

module.exports = IdempotencyKey;
