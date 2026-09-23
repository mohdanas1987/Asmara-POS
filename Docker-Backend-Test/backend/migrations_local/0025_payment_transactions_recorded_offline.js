'use strict';
/**
 * Offline payment recording (CTO remediation doc, Section 4: "must distinguish 'payment
 * recorded locally' from 'payment externally confirmed'... never auto-convert UNKNOWN -> PAID
 * without evidence").
 *
 * GROUND TRUTH established before writing this (not assumed): `POST /orders/create`'s
 * `charges` array (services/payments/paymentLedger.js's `recordCharges`) records whatever
 * method/amount the CASHIER entered -- cash or card -- with no live payment-provider
 * verification step in this path at all (that only exists in the SEPARATE
 * routes/payments.js terminal-charge flow, items 5-6, already done via `payment_attempts`).
 * So this path's charges are, and always were, staff-attested facts (cash physically
 * collected, or a card slip run through a standalone terminal never connected to this
 * system) -- identically trusted whether the request reached the server instantly or via the
 * offline outbox an hour later. There is no "externally confirmed" step to distinguish FROM
 * here, for either the online or offline case, so introducing a new payment_transactions
 * `status` value (e.g. PENDING_RECONCILIATION) would be inventing a verification step this
 * flow doesn't actually have, and would risk the real, tested `getNetPaid()`/`deriveStatus()`
 * accounting logic (which only ever excludes `status = 'voided'`) silently mis-counting a new
 * status it doesn't know about.
 *
 * What IS genuinely true and worth recording: a charge that reached the server via the
 * offline queue was entered by staff at a time no one could immediately verify it against
 * anything (no supervisor glancing at a live screen, no real-time card-terminal receipt
 * correlation). This column is purely descriptive metadata for that -- never read by any
 * payment_status/netPaid calculation -- so a manager reviewing the ledger (GET
 * /orders/:order/payments, unchanged, already returns every column) can see which charges
 * were recorded while a terminal was offline and choose to double-check them, without this
 * system ever silently pretending offline-recorded money is somehow less real than online-
 * recorded money (it is exactly as real -- cash in a drawer is cash in a drawer).
 */
exports.up = function (knex) {
  return knex.schema.hasColumn('payment_transactions', 'recorded_offline').then((exists) => {
    if (exists) return;
    return knex.schema.alterTable('payment_transactions', (table) => {
      table.boolean('recorded_offline').notNullable().defaultTo(false);
    });
  });
};

exports.down = function (knex) {
  return knex.schema.hasColumn('payment_transactions', 'recorded_offline').then((exists) => {
    if (!exists) return;
    return knex.schema.alterTable('payment_transactions', (table) => {
      table.dropColumn('recorded_offline');
    });
  });
};
