const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class CashRegister extends TenantModel {
  static get tableName() {
    return 'cash_register'; // Corresponds to the table name in your database
  }
}

module.exports = CashRegister;
