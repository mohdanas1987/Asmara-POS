'use strict';
/**
 * Billing & payments completeness (task #37). Real transaction ledger backing checkout,
 * split/partial payments, refunds, and voids -- see migrations_local/0013 for the schema
 * rationale. Kept deliberately small: this is arithmetic over one append-only table, not a
 * payment gateway integration (that's payments/*.js, used only for the separate terminal-
 * charge flow in routes/payments.js).
 */
const PaymentTransaction = require('../../models/PaymentTransaction');

const ROUNDING_TOLERANCE_CENTS = 1; // guards against float noise (e.g. 9.999999999999998)

function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

/** Records one or more charges against an order. `payments` is [{ method, amount }, ...]. */
async function recordCharges({ tenantId, orderId, payments, createdBy }) {
  const rows = payments
    .filter((p) => p && Number(p.amount) > 0)
    .map((p) => ({
      tenant_id: tenantId,
      order_id: String(orderId),
      type: 'charge',
      method: p.method,
      amount: Number(p.amount).toFixed(2),
      status: 'succeeded',
      provider_reference: p.provider_reference ?? null,
      created_by: createdBy ?? null,
    }));
  if (rows.length === 0) return [];
  return PaymentTransaction.query().insert(rows);
}

/**
 * Net amount actually paid toward an order right now: successful charges minus successful
 * refunds, with voided charges excluded entirely (a void never counted as revenue).
 */
async function getNetPaid({ tenantId, orderId }) {
  const rows = await PaymentTransaction.forTenant(tenantId).where('order_id', String(orderId));
  let cents = 0;
  for (const row of rows) {
    if (row.status === 'voided') continue;
    if (row.type === 'charge') cents += toCents(row.amount);
    if (row.type === 'refund') cents -= toCents(row.amount);
  }
  return cents / 100;
}

/**
 * Derives the order's payment_status from the ledger against its total. The common case (one
 * charge covering the full total) still resolves to 'paid', exactly as the old hardcoded
 * behavior did -- this only changes outcomes for the genuinely-new partial/overpaid cases.
 */
function deriveStatus(netPaid, total) {
  const paidCents = toCents(netPaid);
  const totalCents = toCents(total);
  if (paidCents <= 0) return 'pending';
  if (paidCents + ROUNDING_TOLERANCE_CENTS < totalCents) return 'partial';
  return 'paid'; // covers exact and (rare, e.g. a tip) over-payment alike
}

async function getLedger({ tenantId, orderId }) {
  return PaymentTransaction.forTenant(tenantId).where('order_id', String(orderId)).orderBy('id', 'asc');
}

/**
 * Refunds `amount` against an order. Refuses to refund more than is currently, actually paid
 * (net of any prior refunds) -- the one invariant that matters here: the ledger can never
 * show the customer refunded more money than they ever paid.
 */
async function refund({ tenantId, orderId, amount, reason, createdBy }) {
  const amountNum = Number(amount);
  if (!(amountNum > 0)) {
    throw new Error('Refund amount must be greater than zero.');
  }
  const netPaid = await getNetPaid({ tenantId, orderId });
  if (toCents(amountNum) > toCents(netPaid) + ROUNDING_TOLERANCE_CENTS) {
    throw new Error(`Cannot refund €${amountNum.toFixed(2)}: only €${netPaid.toFixed(2)} has actually been paid on this order.`);
  }
  return PaymentTransaction.query().insert({
    tenant_id: tenantId,
    order_id: String(orderId),
    type: 'refund',
    method: 'refund',
    amount: amountNum.toFixed(2),
    status: 'succeeded',
    note: reason ?? null,
    created_by: createdBy ?? null,
  });
}

/**
 * Voids a specific charge transaction (e.g. "rang up the wrong table, undo it") -- the charge
 * is marked voided and excluded from net-paid going forward, rather than deleted, so the
 * ledger stays a true append-only history of what happened.
 */
async function voidTransaction({ tenantId, transactionId, createdBy }) {
  const original = await PaymentTransaction.forTenant(tenantId).findById(transactionId);
  if (!original) {
    throw new Error('Transaction not found.');
  }
  if (original.type !== 'charge') {
    throw new Error('Only a charge transaction can be voided.');
  }
  if (original.status === 'voided') {
    throw new Error('This transaction has already been voided.');
  }
  await PaymentTransaction.query().findById(transactionId).patch({ status: 'voided' });
  return PaymentTransaction.query().insert({
    tenant_id: tenantId,
    order_id: original.order_id,
    type: 'void',
    method: original.method,
    amount: original.amount,
    status: 'succeeded',
    refunds_transaction_id: original.id,
    created_by: createdBy ?? null,
  });
}

module.exports = { recordCharges, getNetPaid, deriveStatus, getLedger, refund, voidTransaction };
