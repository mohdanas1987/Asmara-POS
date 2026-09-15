const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class OrderDetail extends TenantModel {
  static get tableName() {
    return 'order_details'; // Corresponds to the table name in your database
  }
}

module.exports = OrderDetail;
