const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class Report extends TenantModel {
  static get tableName() {
    return 'reports'; // Corresponds to the table name in your database
  }
}

module.exports = Report;
