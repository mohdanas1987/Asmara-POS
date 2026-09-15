const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class Queue extends TenantModel {
    static get tableName() {
        return 'queues'; // Corresponds to the table name in your database
    }
}

module.exports = Queue;
