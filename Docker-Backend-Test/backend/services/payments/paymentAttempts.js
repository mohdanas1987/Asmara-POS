'use strict';
/**
 * Payment state machine + crash/recovery/reconciliation (CTO feedback 2026-09-22, items 5-6).
 * See migrations_local/0024_payment_attempts.js for the full rationale on why this table
 * exists and how it differs from the payment_transactions ledger (services/payments/
 * paymentLedger.js).
 *
 * STATUS NORMALIZATION, stated plainly: every provider adapter (payments/*.js) returns its
 * own native status vocabulary (Stripe PaymentIntent statuses, Mollie payment statuses,
 * Adyen's Result field, SumUp's checkout status, this codebase's own mock provider). There is
 * no single shared enum across four unrelated payment providers' APIs -- normalizeStatus()
 * below is a best-effort mapping from each provider's known success/failure/pending strings
 * into this module's three states. Any status this function doesn't recognize is treated as
 * 'pending' rather than guessed as success or failure -- an unrecognized status must never be
 * silently treated as "money captured", and must never be silently treated as "safe to
 * retry" either (a real retry against an unresolved attempt could double-charge). 'pending'
 * forces it through reconcile() instead, which is the conservative, correct default.
 */
const PaymentAttempt = require('../../models/PaymentAttempt');
const paymentLedger = require('./paymentLedger');

const SUCCESS_STATUSES = new Set([
  'succeeded', // stripe (after capture), mock
  'paid', // mollie
  'success', // adyen SaleToPOIResponse.Response.Result
  'successful', // sumup
]);

const FAILED_STATUSES = new Set([
  'failed',
  'canceled',
  'cancelled',
  'expired',
  'declined',
  'failure', // adyen
]);

const PENDING_STATUSES = new Set([
  'pending',
  'requires_payment_method', // stripe -- intent created, no card presented to the reader yet
  'requires_confirmation',
  'requires_capture',
  'open', // mollie
]);

function normalizeStatus(providerStatus) {
  const s = String(providerStatus || '').toLowerCase();
  if (SUCCESS_STATUSES.has(s)) return 'succeeded';
  if (FAILED_STATUSES.has(s)) return 'failed';
  if (PENDING_STATUSES.has(s)) return 'pending';
  return 'pending'; // unrecognized -- conservative default, see header comment
}

/**
 * Starts a new attempt row BEFORE the provider is ever called. This is the write that makes
 * a crash recoverable: even if the process dies immediately after this insert and before the
 * adapter call returns, there is now a real, queryable 'initiated' row an operator (or an
 * automated reconciliation job, not built in this pass) can act on instead of the charge
 * simply vanishing with no trace.
 */
async function startAttempt({ tenantId, orderId, provider, terminalId, amount, currency, createdBy }) {
  return PaymentAttempt.query().insert({
    tenant_id: tenantId,
    order_id: String(orderId),
    provider,
    terminal_id: terminalId ?? null,
    amount: Number(amount).toFixed(2),
    currency: currency || 'eur',
    status: 'initiated',
    created_by: createdBy ?? null,
  });
}

/**
 * Finalizes an attempt as 'succeeded', recording the ONE corresponding ledger charge -- and
 * only once, ever, for this attempt (checked via ledger_transaction_id) so a reconcile() that
 * runs twice against the same already-finalized attempt can never double-charge the ledger.
 */
async function finalizeSucceeded({ tenantId, attempt, providerPaymentId, method }) {
  const fresh = await PaymentAttempt.forTenant(tenantId).findById(attempt.id);
  if (!fresh) throw new Error('Payment attempt not found.');
  if (fresh.ledger_transaction_id) {
    // Already recorded -- this is the safe no-op path for a reconcile racing (or repeating)
    // against an attempt that was already finalized by the original request.
    return fresh;
  }

  const [ledgerRow] = await paymentLedger.recordCharges({
    tenantId,
    orderId: fresh.order_id,
    payments: [{ method: method || fresh.provider, amount: Number(fresh.amount), provider_reference: providerPaymentId }],
    createdBy: fresh.created_by,
  });

  return PaymentAttempt.query().patchAndFetchById(fresh.id, {
    status: 'succeeded',
    provider_payment_id: providerPaymentId ?? fresh.provider_payment_id,
    ledger_transaction_id: ledgerRow ? ledgerRow.id : null,
    reconciled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function finalizeFailed({ tenantId, attempt, errorMessage, providerPaymentId }) {
  return PaymentAttempt.query().patchAndFetchById(attempt.id, {
    status: 'failed',
    error_message: errorMessage ? String(errorMessage).slice(0, 2000) : null,
    provider_payment_id: providerPaymentId ?? attempt.provider_payment_id ?? null,
    reconciled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function markPending({ tenantId, attempt, providerPaymentId }) {
  return PaymentAttempt.query().patchAndFetchById(attempt.id, {
    status: 'pending',
    provider_payment_id: providerPaymentId ?? attempt.provider_payment_id ?? null,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Re-queries the provider for an attempt's true current state and finalizes it accordingly.
 * This is the actual crash/restart recovery mechanism: an attempt left 'initiated' or
 * 'pending' (by a crash, a dropped connection, or a provider that resolves asynchronously)
 * gets its real outcome pulled from the provider itself rather than guessed at.
 *
 * HONEST LIMIT, stated rather than glossed over: this can only reconcile an attempt that
 * already has a `provider_payment_id` -- if the process crashed DURING the very first call to
 * the provider, before any id was ever returned, there is nothing here to check the status
 * of. That specific window (crash between "request sent" and "id received") is a real,
 * remaining gap; closing it fully needs the provider's own webhook/callback mechanism (a
 * larger, separate integration this pass does not attempt) rather than a pull-based check.
 */
async function reconcile({ tenantId, attemptId, settings, adapter }) {
  const attempt = await PaymentAttempt.forTenant(tenantId).findById(attemptId);
  if (!attempt) throw new Error('Payment attempt not found.');

  if (attempt.status === 'succeeded' || attempt.status === 'failed') {
    return attempt; // already resolved -- nothing to reconcile
  }
  if (!attempt.provider_payment_id) {
    throw new Error(
      'Cannot reconcile: no provider payment id was ever recorded for this attempt (the process likely crashed before the provider responded at all). This must be resolved manually against the provider\'s own dashboard.'
    );
  }

  let result;
  try {
    result = await adapter.checkStatus(settings, attempt.provider_payment_id);
  } catch (err) {
    // The status check itself failing tells us nothing new about the payment -- leave the
    // attempt exactly as it was rather than guessing.
    throw new Error(`Could not reach ${attempt.provider} to check this payment's status: ${err.message}`);
  }

  const normalized = normalizeStatus(result?.status);
  if (normalized === 'succeeded') {
    return finalizeSucceeded({ tenantId, attempt, providerPaymentId: result.id });
  }
  if (normalized === 'failed') {
    return finalizeFailed({ tenantId, attempt, errorMessage: `Provider reports: ${result?.status}`, providerPaymentId: result.id });
  }
  return markPending({ tenantId, attempt, providerPaymentId: result.id });
}

module.exports = {
  normalizeStatus,
  startAttempt,
  finalizeSucceeded,
  finalizeFailed,
  markPending,
  reconcile,
};
