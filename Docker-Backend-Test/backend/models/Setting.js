const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class Setting extends TenantModel {
  static get tableName() {
    return 'settings'; // Corresponds to the table name in your database
  }
}

module.exports = Setting;
