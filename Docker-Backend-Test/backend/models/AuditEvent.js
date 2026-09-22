const TenantModel = require('./TenantModel');

class AuditEvent extends TenantModel {
    static get tableName() {
        return 'audit_events';
    }
}

module.exports = AuditEvent;
