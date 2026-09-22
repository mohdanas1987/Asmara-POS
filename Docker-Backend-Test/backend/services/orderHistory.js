'use strict';
/**
 * Order domain normalization, phase 2 (CTO feedback 2026-09-22, item 8). Append-only,
 * immutable history rows for order status transitions and table assignment changes -- see
 * migrations_local/0022_order_status_table_history.js's header comment for the full
 * rationale (additive, doesn't touch or replace `orders.status`/`orders.tables`).
 *
 * Best-effort, exactly like services/orderLineSnapshot.js and the audit/loyalty side
 * effects elsewhere in this codebase: a failure here must never fail the request that
 * triggered it. Callers should wrap these in try/catch (or use the *Safe wrappers below,
 * which do it for you) -- a lost history row is a real gap worth fixing, but it must never
 * become "the order couldn't be created/transferred because history logging threw".
 */
const Model = require('objection').Model;
function knex() {
  return Model.knex();
}

/**
 * @param {object} opts
 * @param {number|string} opts.tenantId
 * @param {string} opts.orderId
 * @param {string|null} [opts.fromStatus]
 * @param {string} opts.toStatus
 * @param {string} [opts.reason]
 * @param {number|string} [opts.userId]
 * @param {string} [opts.terminalId]
 * @param {string} [opts.correlationId]
 */
async function recordStatusChange({ tenantId, orderId, fromStatus = null, toStatus, reason = null, userId = null, terminalId = null, correlationId = null }) {
  if (!tenantId || !orderId || !toStatus) return { skipped: true, reason: 'missing required field' };
  const db = knex();
  await db('order_status_history').insert({
    tenant_id: tenantId,
    order_id: orderId,
    from_status: fromStatus,
    to_status: toStatus,
    reason,
    changed_by_user_id: userId || null,
    terminal_id: terminalId || null,
    correlation_id: correlationId || null,
  });
  return { recorded: true };
}

/**
 * @param {object} opts
 * @param {number|string} opts.tenantId
 * @param {string} opts.orderId
 * @param {string|null} [opts.fromTable]
 * @param {string} opts.toTable
 * @param {'open'|'transfer'|'merge'|'split'} opts.eventType
 * @param {number|string} [opts.userId]
 * @param {string} [opts.terminalId]
 * @param {string} [opts.correlationId]
 */
async function recordTableEvent({ tenantId, orderId, fromTable = null, toTable, eventType, userId = null, terminalId = null, correlationId = null }) {
  if (!tenantId || !orderId || !toTable || !eventType) return { skipped: true, reason: 'missing required field' };
  const db = knex();
  await db('order_table_history').insert({
    tenant_id: tenantId,
    order_id: orderId,
    from_table: fromTable,
    to_table: toTable,
    event_type: eventType,
    changed_by_user_id: userId || null,
    terminal_id: terminalId || null,
    correlation_id: correlationId || null,
  });
  return { recorded: true };
}

/** Same as recordStatusChange, but swallows and logs errors instead of throwing -- use this
 * at call sites that must never fail the parent request over a history-logging bug. */
async function recordStatusChangeSafe(opts) {
  try {
    return await recordStatusChange(opts);
  } catch (e) {
    console.warn('[orderHistory] recordStatusChange failed (non-fatal):', e.message);
    return { skipped: true, reason: 'error', error: e.message };
  }
}

/** Same as recordTableEvent, but swallows and logs errors instead of throwing. */
async function recordTableEventSafe(opts) {
  try {
    return await recordTableEvent(opts);
  } catch (e) {
    console.warn('[orderHistory] recordTableEvent failed (non-fatal):', e.message);
    return { skipped: true, reason: 'error', error: e.message };
  }
}

module.exports = {
  recordStatusChange,
  recordTableEvent,
  recordStatusChangeSafe,
  recordTableEventSafe,
};
