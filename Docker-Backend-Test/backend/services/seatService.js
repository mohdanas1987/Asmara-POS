'use strict';
/**
 * Seat & guest management (CTO doc "Asmara POS -- Remaining Work Only", Phase 22). See
 * migrations_local/0026's header comment for the domain design decision (seats are numbered
 * per-order, not a fixed row on `tables`).
 */
const Model = require('objection').Model;
function knex() {
  return Model.knex();
}

/**
 * Assigns or renames a guest at a seat on an order. Upserts by (tenant_id, order_id,
 * seat_number) -- calling this twice for the same seat updates the name rather than creating
 * a second guest, so re-confirming a name (or correcting a typo) is always safe.
 */
async function upsertGuest({ tenantId, orderId, seatNumber, guestName }) {
  if (!Number.isInteger(seatNumber) || seatNumber < 1) {
    throw Object.assign(new Error('seat_number must be a positive integer.'), { statusCode: 400 });
  }
  const db = knex();
  const existing = await db('order_guests').where({ tenant_id: tenantId, order_id: orderId, seat_number: seatNumber }).first();
  const now = new Date().toISOString();
  if (existing) {
    await db('order_guests').where({ id: existing.id }).update({ guest_name: guestName ?? null, updated_at: now });
    return { ...existing, guest_name: guestName ?? null, updated_at: now };
  }
  await db('order_guests').insert({
    tenant_id: tenantId, order_id: orderId, seat_number: seatNumber, guest_name: guestName ?? null, created_at: now, updated_at: now,
  });
  // Re-query by the unique (tenant_id, order_id, seat_number) key rather than relying on
  // `.returning('id')`, which not every driver in this app's supported DBs (sqlite/mysql)
  // handles the same way -- the same defensive pattern services/orderLineSnapshot.js already
  // uses for its own multi-row insert.
  return db('order_guests').where({ tenant_id: tenantId, order_id: orderId, seat_number: seatNumber }).first();
}

async function listGuests({ tenantId, orderId }) {
  return knex()('order_guests').where({ tenant_id: tenantId, order_id: orderId }).orderBy('seat_number', 'asc');
}

async function removeGuest({ tenantId, orderId, seatNumber }) {
  const deleted = await knex()('order_guests').where({ tenant_id: tenantId, order_id: orderId, seat_number: seatNumber }).del();
  return { deleted };
}

module.exports = { upsertGuest, listGuests, removeGuest };
