/**
 * RECONSTRUCTED SCHEMA — Phase 1 (local/offline development environment)
 *
 * IMPORTANT: this migration does NOT come from the original migrations/ folder in this
 * codebase. Those files were checked first and found to be stale -- they don't match what
 * the live route/model code actually reads and writes (no `tables` table at all, no
 * `menu_categories` table, `orders` missing columns like `tables`/`status`/`payment_status`
 * that routes/orders.js depends on constantly, `reports` missing `user_id`/`cash_register_id`
 * /`html` that utils.js's generateReport() actually inserts). The real production schema was
 * clearly altered directly on the live database over time, outside of any committed
 * migration. Running the OLD migrations fresh would produce a database the app cannot
 * actually run against.
 *
 * This file was built instead by reading every route file, every model, and utils.js, and
 * extracting every column actually referenced in a `.where()`, `.select()`, `.insert()`,
 * `.patch()`, or a destructured property read off a query result. It is a best-effort
 * reconstruction from CODE USAGE, not from the real database -- it has not been compared
 * against the real production schema (that comparison needs a real connection to
 * srv1399.hstgr.io, which is exactly what this local environment is deliberately avoiding
 * for now). Treat this as "good enough to run the app and test real behavior locally," not
 * as a guaranteed-accurate copy of production. When Phase 2 gets real DB access, the first
 * thing to do is diff this against `DESCRIBE <table>` / `SHOW CREATE TABLE` on the real
 * database and correct anything that drifted.
 *
 * Columns marked "extra, from the old migrations, kept nullable" are ones the old migration
 * files defined that current code doesn't seem to touch -- kept in case something references
 * them indirectly (a report template, a rarely-hit code path) that wasn't caught by reading.
 */

exports.up = async function (knex) {

    await knex.schema.createTable('users', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
        table.string('email').notNullable().unique();
        table.string('password').notNullable();
        table.string('type').defaultTo('cashier'); // extra, from the old migration, kept nullable-safe
        table.boolean('verified').defaultTo(false); // extra
        table.boolean('status').defaultTo(true);
        table.timestamp('email_verified_at').nullable(); // extra
        table.string('remember_token').nullable(); // extra
        table.timestamps(true, true);
    });

    await knex.schema.createTable('tables', (table) => {
        table.increments('id').primary();
        table.string('table_number').notNullable().unique();
        table.decimal('length').nullable();
        table.decimal('width').nullable();
        table.decimal('x').nullable();
        table.decimal('y').nullable();
        table.string('status').defaultTo('free'); // free | occupied | reserved | order ongoing
        table.string('linked_to').nullable();
        table.timestamps(true, true);
    });

    await knex.schema.createTable('menu_categories', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
        table.string('color').defaultTo('#1f1d1d');
        table.boolean('status').defaultTo(true);
        table.integer('sq_pos').defaultTo(0);
        table.bigInteger('user_id').nullable(); // extra -- referenced by some queries, unclear if real
        table.timestamps(true, true);
    });

    await knex.schema.createTable('menu_items', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
        table.string('image').nullable();
        table.string('thumb').nullable();
        table.bigInteger('category_id').nullable().index();
        table.string('price').notNullable();
        table.string('code').nullable().index(); // barcode
        table.string('tax').nullable();
        table.integer('stock').defaultTo(0); // used by pos.js's POS-screen query
        table.integer('quantity').defaultTo(20); // used by items.js's admin-screen query -- kept
        // as a SEPARATE column from `stock` deliberately: the code reads them via two
        // different queries (pos.js selects `stock as quantity`, items.js selects `quantity`
        // directly) -- this divergence looks like real drift in the live app, documented as
        // a DISCOVERED ITEM rather than silently "fixed" by merging them, since merging could
        // change real behavior we don't have enough information to be sure about yet.
        table.boolean('pos').defaultTo(true); // whether this item shows on the POS screen
        table.boolean('deleted').defaultTo(false);
        table.bigInteger('added_by').nullable(); // user id who created it
        table.longText('sales_desc').nullable();
        table.integer('seq').defaultTo(0);
        table.timestamps(true, true);
    });

    await knex.schema.createTable('taxes', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
        table.string('amount').defaultTo('0');
        table.boolean('status').defaultTo(true);
        table.bigInteger('user_id').nullable();
        table.timestamps(true, true);
    });

    await knex.schema.createTable('customers', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
        table.string('phone').notNullable().unique();
        table.string('email').nullable();
        table.longText('note').nullable();
        table.timestamps(true, true);
    });

    await knex.schema.createTable('cash_register', (table) => {
        table.increments('id').primary();
        table.string('opening_cash').nullable();
        table.string('closing_cash').nullable();
        table.string('date');
        table.boolean('status').defaultTo(true);
        table.bigInteger('user_id');
        table.timestamps(true, true);
    });

    await knex.schema.createTable('order_details', (table) => {
        table.increments('id').primary();
        table.bigInteger('cash_register_id').nullable();
        table.bigInteger('session_id').nullable();
        table.timestamps(true, true);
    });

    await knex.schema.createTable('orders', (table) => {
        // Real primary key is a generated id (nanoid, 12 chars) set by Order.$beforeInsert()
        // in the model itself, not an auto-increment integer or a UUID -- see models/Order.js.
        table.string('id', 32).primary();
        table.string('tables').nullable(); // table_number, or "1+2" for merged tables
        table.bigInteger('cash_register_id').nullable();
        table.bigInteger('user_id').nullable(); // cashier -- see Order.relationMappings 'cashier'
        table.bigInteger('customer_id').nullable();
        table.string('status').defaultTo('ongoing'); // ongoing | in-kitchen | completed
        table.string('payment_status').defaultTo('pending'); // pending | paid
        table.string('payment_mode').nullable();
        table.longText('data').nullable(); // JSON: {quantity, note, taste, modes, ...}
        table.longText('in_kitchen').nullable(); // JSON: per-product quantity sent to kitchen
        table.decimal('total').nullable();
        table.decimal('added_total').nullable();
        table.string('note').nullable();
        table.string('taste').nullable();
        table.timestamps(true, true);
    });

    await knex.schema.createTable('reports', (table) => {
        table.increments('id').primary();
        table.string('path').nullable(); // PDF file path
        table.longText('html').nullable(); // rendered report HTML, used for re-print
        table.string('date').nullable();
        table.bigInteger('user_id').nullable();
        table.bigInteger('cash_register_id').nullable();
        table.timestamps(true, true);
        // NOTE: models/Reservation.js also points at this SAME table ('reports') with a
        // broken relation (join.to: "") -- a pre-existing bug, documented, not fixed here.
        // GET /tables/reservations currently returns report rows mislabeled as reservations.
    });

    await knex.schema.createTable('notifications', (table) => {
        table.increments('id').primary();
        table.bigInteger('user_id').nullable();
        table.string('key').nullable();
        table.longText('value').nullable();
        table.timestamps(true, true);
    });

    await knex.schema.createTable('settings', (table) => {
        table.increments('id').primary();
        table.bigInteger('user_id');
        table.string('key');
        table.longText('value').nullable();
    });

    await knex.schema.createTable('queues', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable().unique();
        table.string('scheduled_time').nullable();
        table.boolean('enabled').defaultTo(true);
        table.timestamps(true, true);
    });

    await knex.schema.createTable('currency', (table) => { // present in old migrations, kept -- unclear if actively used
        table.increments('id').primary();
        table.string('name');
        table.boolean('status').defaultTo(false);
        table.string('unit').nullable();
    });

    await knex.schema.createTable('applications', (table) => { // referenced only by User.relationMappings; no route reads/writes it that we found
        table.increments('id').primary();
        table.bigInteger('user_id').nullable();
        table.timestamps(true, true);
    });
};

exports.down = async function (knex) {
    // Reverse order so foreign-key-ish references (informal -- this schema uses no real FK
    // constraints, matching the original app's style) drop cleanly.
    const tables = [
        'applications', 'currency', 'queues', 'settings', 'notifications', 'reports',
        'orders', 'order_details', 'cash_register', 'customers', 'taxes', 'menu_items',
        'menu_categories', 'tables', 'users'
    ];
    for (const t of tables) {
        await knex.schema.dropTableIfExists(t);
    }
};
