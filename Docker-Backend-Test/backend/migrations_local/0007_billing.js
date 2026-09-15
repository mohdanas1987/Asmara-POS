// Billing groundwork (SaaS build plan step 5), built as a fully DYNAMIC system rather than
// hardcoded plan tiers -- per explicit instruction, the platform admin manages plans, prices
// and payment partners themselves from the Super Admin panel, not something this build
// guesses at. Real charging is NOT wired (no live payment-provider SDK calls anywhere in
// this migration or the routes built on top of it) -- `payment_providers.mode` defaults to
// 'sandbox' and stays there until a real go-live decision is made; see VERIFICATION.md.
exports.up = async function (knex) {
    await knex.schema.createTable('plans', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
        table.string('slug').notNullable().unique();
        table.text('description').nullable();
        table.integer('price_cents').notNullable().defaultTo(0);
        table.string('currency').notNullable().defaultTo('EUR');
        table.string('billing_interval').notNullable().defaultTo('monthly'); // 'monthly' | 'yearly' | 'custom'
        table.text('features').nullable(); // JSON-encoded string array, platform-admin-authored
        table.boolean('is_active').notNullable().defaultTo(true);
        table.boolean('is_default').notNullable().defaultTo(false); // offered automatically at signup
        table.integer('sort_order').notNullable().defaultTo(0);
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('payment_providers', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
        table.string('provider_key').notNullable(); // e.g. 'stripe', 'mollie', 'adyen', 'manual'
        table.string('mode').notNullable().defaultTo('sandbox'); // 'sandbox' | 'live'
        // Non-secret display/config fields only (e.g. a publishable key, an account label).
        // Real secret keys belong in environment variables / a secrets manager, never in this
        // table -- enforced by convention here since there is no real payment integration yet.
        table.text('config').nullable(); // JSON-encoded string, platform-admin-authored
        table.boolean('is_active').notNullable().defaultTo(true);
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('subscriptions', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.integer('plan_id').nullable().references('id').inTable('plans').onDelete('SET NULL');
        table.integer('payment_provider_id').nullable().references('id').inTable('payment_providers').onDelete('SET NULL');
        // 'trialing' | 'sandbox_active' | 'active' | 'past_due' | 'canceled' -- no real billing
        // states (e.g. real Stripe webhook statuses) exist yet since nothing charges for real.
        table.string('status').notNullable().defaultTo('trialing');
        table.timestamp('current_period_end').nullable();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        table.index('tenant_id');
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('subscriptions');
    await knex.schema.dropTableIfExists('payment_providers');
    await knex.schema.dropTableIfExists('plans');
};
