const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class Customer extends TenantModel {
  static get tableName() {
    return 'customers'; // Corresponds to the table name in your database
  }
}

module.exports = Customer;
