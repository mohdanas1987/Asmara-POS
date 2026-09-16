'use strict';
/**
 * Product -> Preparation Rule -> Kitchen Station routing (project audit 2026-09-15, task
 * "Kitchen ticket routing as its own domain").
 *
 * Called whenever an order is sent to the kitchen (routes/orders.js's /to-kitchen and
 * /accept handlers). Turns a flat list of ordered items into one kitchen_tickets row PER
 * STATION those items route to -- a grill item and a bar item on the same table go to two
 * different tickets, each printable on its own physical printer.
 *
 * Deliberately isolated from routes/orders.js's existing status-flag logic: this ADDS
 * ticket records alongside the existing order.status = 'in-kitchen' flow, it never replaces
 * or blocks it. If routing fails for any reason, the caller is expected to log and continue
 * -- a missing kitchen ticket must never prevent an order from reaching the kitchen the way
 * it always has (Preservation Contract: the existing flow is the safety net).
 */
const Item = require('../models/Item');
const KitchenStation = require('../models/KitchenStation');
const KitchenTicket = require('../models/KitchenTicket');

/**
 * @param {object} params
 * @param {number} params.tenantId
 * @param {string} params.orderId
 * @param {string|null} params.tableNumber
 * @param {Array<{id: number|string, name?: string, quantity: number, notes?: string}>} params.items
 *   Flat list of ordered items with at least an `id` (menu_items.id) and `quantity`.
 * @returns {Promise<Array>} the kitchen_tickets rows created (one per station touched)
 */
async function routeOrderToKitchen({ tenantId, orderId, tableNumber, items }) {
  if (!items || items.length === 0) return [];

  let stations = await KitchenStation.forTenant(tenantId);
  if (stations.length === 0) {
    // Defensive fallback, not the primary mechanism: migration 0009's backfill and
    // signup-tenant both create a default station already. This only fires for an edge case
    // neither of those covers (e.g. a tenant row inserted directly, bypassing signup-tenant,
    // on a database that predates migration 0009's own backfill window). An order must
    // always be routeable -- never silently dropped for lack of a station to send it to.
    const created = await KitchenStation.query().insert({ tenant_id: tenantId, name: 'Main Kitchen', is_default: true });
    stations = [created];
  }
  const defaultStation = stations.find((s) => s.is_default) || stations[0];

  const itemIds = items.map((i) => i.id).filter((id) => id !== undefined && id !== null);
  const menuItems = itemIds.length
    ? await Item.forTenant(tenantId).whereIn('id', itemIds).select('id', 'kitchen_station_id', 'name')
    : [];
  const stationByItemId = new Map(menuItems.map((mi) => [String(mi.id), mi.kitchen_station_id]));

  // Group items by resolved station id (falling back to the tenant's default station for
  // any item with no preparation rule set, or that couldn't be found in the menu at all --
  // an order must always be routeable, never silently dropped).
  const groups = new Map(); // stationId -> items[]
  for (const item of items) {
    const mappedStationId = stationByItemId.get(String(item.id));
    const stationId = mappedStationId && stations.some((s) => s.id === mappedStationId)
      ? mappedStationId
      : defaultStation.id;
    if (!groups.has(stationId)) groups.set(stationId, []);
    groups.get(stationId).push(item);
  }

  const tickets = [];
  for (const [stationId, stationItems] of groups.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const ticket = await KitchenTicket.query().insert({
      tenant_id: tenantId,
      order_id: orderId,
      station_id: stationId,
      table_number: tableNumber ?? null,
      items: JSON.stringify(stationItems),
      status: 'pending',
    });
    tickets.push(ticket);
  }

  return tickets;
}

module.exports = { routeOrderToKitchen };
