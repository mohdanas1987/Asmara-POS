const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class Tax extends TenantModel {
  static get tableName() {
    return 'taxes'; // Corresponds to the table name in your database
  }
}

module.exports = Tax;
