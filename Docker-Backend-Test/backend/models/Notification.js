const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class Notification extends TenantModel {
  static get tableName() {
    return 'notifications'; // Corresponds to the table name in your database
  }
}

module.exports = Notification;
