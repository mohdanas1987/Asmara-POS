const TenantModel = require('./TenantModel');

// Kitchen ticket routing (project audit 2026-09-15). One row per (order, station) pair --
// the KDS-ready, reprintable, per-station record that plain order.status never gave us.
class KitchenTicket extends TenantModel {
  static get tableName() {
    return 'kitchen_tickets';
  }
}

module.exports = KitchenTicket;
