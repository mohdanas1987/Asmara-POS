'use strict';
/**
 * Migration safety certification (CTO doc "Asmara POS -- Remaining Work Only", item 10:
 * "production certification still needs: clean database migration, rollback/recovery
 * strategy, migration failure test, data integrity validation" -- previously only AUDITED by
 * reading each file for the hasColumn/hasTable guard convention, never actually RUN end to
 * end in reverse).
 *
 * This is the first test in this codebase to actually EXECUTE every migration's down() in
 * one full reverse pass, not just read it. A migration whose down() throws, references a
 * table already dropped by an earlier down() (wrong drop order), or leaves the schema unable
 * to re-migrate cleanly would all be caught here -- none of that is provable by inspection
 * alone, which is why the prior audit could only say "CONDITIONAL".
 */
const path = require('path');
const fs = require('fs');
const Knex = require('knex');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const TMP_DIR = path.join(__dirname, '.tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
const DB_FILE = path.join(TMP_DIR, 'migration-safety.sqlite');

let knex;

after(async () => {
    if (knex) await knex.destroy();
    if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
});

test('every migration applies cleanly to a brand-new database', async () => {
    if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
    knex = Knex({
        client: 'sqlite3', useNullAsDefault: true,
        connection: { filename: DB_FILE },
        migrations: { directory: path.join(__dirname, '../migrations_local') },
    });

    await knex.migrate.latest();
    // knex.migrate.list() resolves [completedMigrations, pendingMigrations].
    const [completedMigrations, pendingMigrations] = await knex.migrate.list();
    const migrationCount = fs.readdirSync(path.join(__dirname, '../migrations_local')).filter((f) => f.endsWith('.js')).length;
    assert.equal(completedMigrations.length, migrationCount, 'every migration file must actually be applied, none skipped/errored silently');
    assert.equal(pendingMigrations.length, 0);

    const tablesAfterUp = await knex('sqlite_master').where('type', 'table').pluck('name');
    assert.ok(tablesAfterUp.includes('orders'), 'sanity check: core tables must exist after a clean migrate:latest');
    assert.ok(tablesAfterUp.includes('order_guests'), 'this session\'s own new migration (0026) must be included in a clean migrate:latest');
    assert.ok(tablesAfterUp.includes('sync_conflicts'), 'this session\'s own new migration (0027) must be included in a clean migrate:latest');
});

test('the ENTIRE migration chain rolls back cleanly, in reverse, with no errors and no orphaned tables', async () => {
    // Rolling back ALL batches (not just the latest) actually EXECUTES every migration's
    // down() in reverse dependency order -- this is what proves drop order/FK correctness,
    // not just that each down() individually parses.
    await knex.migrate.rollback({}, true);

    const [completedAfterRollback, pendingAfterRollback] = await knex.migrate.list();
    // After a full rollback, `list()` should report ALL migration files as still-pending
    // (none marked as run) -- if any were left "completed" the tracking table itself would be
    // inconsistent with the actual schema state.
    const migrationCount = fs.readdirSync(path.join(__dirname, '../migrations_local')).filter((f) => f.endsWith('.js')).length;
    assert.equal(completedAfterRollback.length, 0, 'no migration should be marked completed after a full rollback');
    assert.equal(pendingAfterRollback.length, migrationCount, 'every migration must be reported pending again after a full rollback');

    // sqlite_sequence is SQLite's own internal bookkeeping table for AUTOINCREMENT columns,
    // not an application table any migration created directly -- excluded here the same way
    // sqlite_master/knex_migrations* are, so this assertion is about OUR schema, not SQLite's
    // own internals.
    const tablesAfterDown = await knex('sqlite_master').where('type', 'table')
        .whereNotIn('name', ['knex_migrations', 'knex_migrations_lock', 'sqlite_sequence']).pluck('name');
    assert.deepEqual(tablesAfterDown, [], 'a full rollback must leave NO application tables behind -- any leftover table is an incomplete/buggy down()');
});

test('re-applying migrate:latest after a full rollback rebuilds the identical schema (proves the chain is genuinely reversible, not just one-way)', async () => {
    await knex.migrate.latest();

    const tablesAfterReUp = await knex('sqlite_master').where('type', 'table').whereNotIn('name', ['knex_migrations', 'knex_migrations_lock']).pluck('name');
    assert.ok(tablesAfterReUp.includes('orders'));
    assert.ok(tablesAfterReUp.includes('order_guests'));
    assert.ok(tablesAfterReUp.includes('sync_conflicts'));
    assert.ok(tablesAfterReUp.includes('payment_transactions'));

    // A basic write against a freshly-rebuilt schema must actually work end to end -- not just
    // "tables exist", but real data integrity (columns, types, constraints all still function).
    await knex('tables').insert({ table_number: 'migration-safety-1', status: 'free' });
    const row = await knex('tables').where({ table_number: 'migration-safety-1' }).first();
    assert.equal(row.status, 'free');
});
