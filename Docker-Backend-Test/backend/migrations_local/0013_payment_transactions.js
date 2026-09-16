'use strict';
/**
 * Billing & payments completeness (project audit 2026-09-16, task #37): the checkout flow
 * (routes/orders.js /create and /payment-update) never persisted a real transaction record
 * at all -- it just stuffed a payment_mode string and a raw JSON blob onto the order row and
 * hardcoded payment_status to "paid" unconditionally, even for an underpayment. There was no
 * way to record a split/partial payment correctly, no refund, and no void -- exactly the gap
 * flagged in the rebuild plan ("verify a real payment-intent/attempt/transaction/refund model
 * exists vs. a simpler flow").
 *
 * `payment_transactions` is an append-only ledger, one row per real money movement against an
 * order: a `charge` (money in), a `refund` (money back out, always linked to the order it
 * refunds), or a `void` (marks an earlier charge as cancelled without it ever counting as
 * revenue). The order's own `payment_status` continues to work exactly as before for the
 * common case (a single charge covering the full total still ends up "paid", unchanged), but
 * is now derived from this ledger rather than hardcoded, so a genuine partial payment is
 * finally represented correctly instead of being silently marked "paid".
 */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('payment_transactions');
  if (exists) return;
  await knex.schema.createTable('payment_transactions', (table) => {
    table.increments('id').primary();
    table.integer('tenant_id').notNullable();
    table.string('order_id').notNullable();
    table.string('type').notNullable(); // 'charge' | 'refund' | 'void'
    table.string('method').notNullable(); // 'cash' | 'card' | 'stripe' | 'adyen' | 'sumup' | 'mollie' | ...
    table.decimal('amount', 10, 2).notNullable(); // always stored positive; `type` gives sign/meaning
    table.string('status').notNullable().defaultTo('succeeded'); // 'succeeded' | 'voided'
    table.integer('refunds_transaction_id').nullable(); // set on a refund/void row: the charge it applies to
    table.string('provider_reference').nullable();
    table.integer('created_by').nullable(); // users.id, nullable so a test/legacy row is never blocked
    table.text('note').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['tenant_id', 'order_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('payment_transactions');
};
