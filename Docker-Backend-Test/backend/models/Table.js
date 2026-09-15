const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class Table extends TenantModel {
  static get tableName() {
    return 'tables'; 
  }
}

module.exports = Table;
