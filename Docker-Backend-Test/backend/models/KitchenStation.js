const TenantModel = require('./TenantModel');

// Kitchen ticket routing (project audit 2026-09-15). A tenant's physical kitchen
// stations -- e.g. "Main Kitchen", "Grill", "Bar" -- each optionally wired to one printer
// id from RestaurantOS-Desktop/hardware.js's listPrinters().
class KitchenStation extends TenantModel {
  static get tableName() {
    return 'kitchen_stations';
  }
}

module.exports = KitchenStation;
