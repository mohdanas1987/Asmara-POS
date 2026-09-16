const TenantModel = require('./TenantModel');

class Modifier extends TenantModel {
    static get tableName() {
        return 'modifiers';
    }
}

module.exports = Modifier;
