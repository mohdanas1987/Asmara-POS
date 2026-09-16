'use strict';
/**
 * Loyalty domain logic (project audit 2026-09-15, task "Loyalty subsystem (ledger-based)").
 *
 * Balance is ALWAYS derived (SUM of loyalty_ledger.points for a customer), never read from
 * or written to a mutable counter -- every function here that changes a balance does so by
 * inserting one new ledger row and returning the resulting sum, so the full history is
 * always reconstructable and a bad transaction can be reasoned about and reversed with
 * another ledger row, never silently overwritten.
 */
const Customer = require('../models/Customer');
const LoyaltyConfig = require('../models/LoyaltyConfig');
const LoyaltyLedger = require('../models/LoyaltyLedger');

/** Returns the tenant's loyalty config, creating the default one on the fly if missing
 * (mirrors the defensive fallback pattern in services/kitchenRouting.js -- a tenant must
 * never be left unable to earn/redeem just because it predates this feature). */
async function getConfig(tenantId) {
  let config = await LoyaltyConfig.forTenant(tenantId).first();
  if (!config) {
    config = await LoyaltyConfig.query().insert({ tenant_id: tenantId });
  }
  return config;
}

/** Current point balance for a customer: SUM(points) over their ledger, 0 if they have none. */
async function getBalance(tenantId, customerId) {
  const row = await LoyaltyLedger.forTenant(tenantId)
    .where('customer_id', customerId)
    .sum('points as total')
    .first();
  return Number(row?.total || 0);
}

/** Full transaction history for a customer, newest first. Orders by `id` (not just
 * `created_at`) because SQLite's default CURRENT_TIMESTAMP has only second-level precision
 * -- two ledger rows inserted within the same second would otherwise sort ambiguously.
 * `id` is a strictly-increasing autoincrement, so it always reflects true insertion order
 * even when timestamps tie. (Found via a real failing test, not guessed at.) */
async function getLedger(tenantId, customerId) {
  return LoyaltyLedger.forTenant(tenantId)
    .where('customer_id', customerId)
    .orderBy('id', 'desc');
}

async function insertLedgerRow({ tenantId, customerId, orderId, type, points, reason, createdBy }) {
  const currentBalance = await getBalance(tenantId, customerId);
  const balanceAfter = currentBalance + points;
  return LoyaltyLedger.query().insert({
    tenant_id: tenantId,
    customer_id: customerId,
    order_id: orderId ?? null,
    type,
    points,
    balance_after: balanceAfter,
    reason: reason ?? null,
    created_by: createdBy ?? null,
  });
}

/**
 * Earn points for a completed order. `orderTotalEuros` is the order's paid total; points
 * are floor(totalCents / cents_per_point) -- a customer never earns a fraction of a point,
 * and rounding always favors the restaurant over invented fractional points.
 */
async function earnForOrder({ tenantId, customerId, orderId, orderTotalEuros, createdBy }) {
  if (!customerId) return null; // no customer attached to this order -- nothing to earn
  const config = await getConfig(tenantId);
  const totalCents = Math.round(Number(orderTotalEuros || 0) * 100);
  const points = Math.floor(totalCents / config.cents_per_point);
  if (points <= 0) return null;
  return insertLedgerRow({
    tenantId, customerId, orderId, type: 'earn', points,
    reason: `Earned from order ${orderId}`, createdBy,
  });
}

/**
 * Redeem points for a euro discount. Throws (caller returns 400) rather than silently
 * clamping, so a cashier never redeems less than the customer asked for without knowing why.
 */
async function redeem({ tenantId, customerId, points, orderId, createdBy }) {
  const config = await getConfig(tenantId);
  if (points < config.min_redeem_points) {
    throw new Error(`Minimum redemption is ${config.min_redeem_points} points.`);
  }
  const balance = await getBalance(tenantId, customerId);
  if (points > balance) {
    throw new Error(`Insufficient balance: customer has ${balance} points, tried to redeem ${points}.`);
  }
  const euroValue = (points * config.redeem_value_cents) / 100;
  const ledgerRow = await insertLedgerRow({
    tenantId, customerId, orderId, type: 'redeem', points: -points,
    reason: `Redeemed ${points} points for EUR ${euroValue.toFixed(2)}`, createdBy,
  });
  return { ledgerRow, euroValue };
}

/** Manual correction (positive or negative) -- e.g. a goodwill grant or fixing a mistake.
 * Gated by PERMISSIONS.LOYALTY_ADJUST at the route level, not here (services stay policy-free). */
async function adjust({ tenantId, customerId, points, reason, createdBy }) {
  if (!points || points === 0) throw new Error('Adjustment must be a non-zero number of points.');
  return insertLedgerRow({ tenantId, customerId, orderId: null, type: 'adjustment', points, reason, createdBy });
}

/** Generates a unique-enough customer_code and retries on the rare collision. */
async function generateCustomerCode(tenantId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `LC-${tenantId}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await Customer.forTenant(tenantId).where('customer_code', candidate).first();
    if (!existing) return candidate;
  }
  throw new Error('Could not generate a unique customer code after 5 attempts.');
}

module.exports = { getConfig, getBalance, getLedger, earnForOrder, redeem, adjust, generateCustomerCode };
