'use strict';
/**
 * Payment state machine + crash/recovery/reconciliation (CTO feedback 2026-09-22, items 5-6:
 * "Payment state machine" and "Payment crash/recovery/reconciliation").
 *
 * THE GAP THIS CLOSES: `POST /payments/charge` (routes/payments.js) fires a real charge
 * against a physical card terminal via one of the provider adapters (payments/stripe.js,
 * adyen.js, sumup.js, mollie.js) and simply relays whatever the adapter returned straight
 * back to the caller -- it never wrote anything to payment_transactions (the append-only
 * ledger from migrations_local/0013) at all. That means: if the terminal actually captured
 * the customer's card and the network then dropped before the frontend's follow-up call
 * landed, the money was taken but there is no record of it anywhere in this system. There was
 * also no tracking of "an attempt was started" at all -- a process crash or restart between
 * firing the terminal charge and recording the result left literally no trace to recover
 * from.
 *
 * `payment_attempts` is that missing state machine: one row per terminal-charge attempt,
 * written BEFORE the provider is ever called (status 'initiated'), so a crash mid-call still
 * leaves a real, queryable record of "this charge was started and we don't yet know how it
 * ended" -- see services/payments/paymentAttempts.js's `reconcile()` for how that gets
 * resolved after the fact via the adapter's own `checkStatus()`.
 *
 * States: 'initiated' (request sent to the provider, no result yet -- includes the "we
 * crashed before finding out" case), 'pending' (the provider itself says this hasn't
 * resolved yet -- normal for some flows where the physical tap/insert happens after the
 * initial API call returns), 'succeeded' (money captured -- this is the ONLY state that ever
 * creates a payment_transactions charge row, exactly once, tracked via `ledger_transaction_id`
 * so a reconcile can never double-record the same money twice), 'failed' (the provider
 * explicitly declined/errored, or our own request to it failed outright -- no money moved).
 *
 * Deliberately its own table rather than bolted onto payment_transactions: a transaction row
 * is "money that definitely moved"; an attempt is "we tried, here's what we currently know",
 * and conflating the two would make the ledger's append-only "real money movements only"
 * invariant (stated in 0013's own header) no longer true.
 */
exports.up = async function up(knex) {
  // Mock provider support (payments/mock.js, part of this same slice): lets a tenant connect
  // the always-available demo/test provider and control which state it resolves to, without
  // adding a real credential field for it (it needs none).
  const hasMockBehavior = await knex.schema.hasColumn('payment_terminal_settings', 'mock_behavior');
  if (!hasMockBehavior) {
    await knex.schema.alterTable('payment_terminal_settings', (table) => {
      table.string('mock_behavior').nullable(); // 'succeed' | 'decline' | 'pending' | 'timeout'
    });
  }

  const exists = await knex.schema.hasTable('payment_attempts');
  if (exists) return;
  await knex.schema.createTable('payment_attempts', (table) => {
    table.increments('id').primary();
    table.integer('tenant_id').notNullable();
    table.string('order_id').notNullable();
    table.string('provider').notNullable(); // 'stripe' | 'adyen' | 'sumup' | 'mollie' | 'mock'
    table.string('terminal_id').nullable();
    table.decimal('amount', 10, 2).notNullable();
    table.string('currency', 8).notNullable().defaultTo('eur');
    table.string('status').notNullable().defaultTo('initiated'); // 'initiated' | 'pending' | 'succeeded' | 'failed'
    table.string('provider_payment_id').nullable(); // the adapter's own id for this attempt, once known
    table.text('error_message').nullable();
    table.integer('ledger_transaction_id').nullable(); // payment_transactions.id, set once (and only once) recorded
    table.integer('created_by').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('reconciled_at').nullable(); // set when a reconcile() call last resolved this attempt's final state

    table.index(['tenant_id', 'order_id']);
    table.index(['tenant_id', 'status']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('payment_attempts');
};
