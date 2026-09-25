'use strict';
/**
 * Backup / restore certification (CTO doc "Asmara POS -- Remaining Work Only", item 9: "I
 * have not seen sufficient evidence... for a fully tested production backup -> destroy ->
 * restore -> verify cycle"). This IS that cycle, run for real against a throwaway database:
 * seed real data -> back it up -> destroy/corrupt the live database -> restore -> verify every
 * row is back exactly as it was.
 */
const path = require('path');
const fs = require('fs');
const Knex = require('knex');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { backupDatabase } = require('../scripts/backup-db');
const { restoreDatabase } = require('../scripts/restore-db');

const TMP_DIR = path.join(__dirname, '.tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
const DB_PATH = path.join(TMP_DIR, 'backup-restore-live.sqlite');
const BACKUPS_DIR = path.join(TMP_DIR, 'backup-restore-backups');

let knex;

before(async () => {
    [DB_PATH].forEach((f) => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    if (fs.existsSync(BACKUPS_DIR)) fs.rmSync(BACKUPS_DIR, { recursive: true, force: true });

    knex = Knex({
        client: 'sqlite3', useNullAsDefault: true,
        connection: { filename: DB_PATH },
        migrations: { directory: path.join(__dirname, '../migrations_local') },
    });
    await knex.migrate.latest();
});

after(async () => {
    if (knex) await knex.destroy();
});

test('a real backup -> destroy -> restore -> verify cycle recovers every row exactly', async () => {
    // 1. Seed real, distinctive data onto the "live" database.
    await knex('menu_categories').insert({ id: 1, name: 'Mains', sq_pos: 0 });
    await knex('menu_items').insert({ name: 'Backup Test Burger', price: '11.50', tenant_id: 1, category_id: 1, seq: 1 });
    await knex('tables').insert({ table_number: 'backup-1', status: 'occupied' });
    const orderRow = await knex('orders').insert({
        id: 'backup-restore-order-1', tenant_id: 1, tables: 'backup-1', status: 'in-kitchen',
        payment_status: 'pending', total: 11.5, data: JSON.stringify({ quantity: { 1: 1 } }),
    });
    void orderRow;

    const beforeCounts = {
        menu_items: await knex('menu_items').count('id as c').first(),
        orders: await knex('orders').count('id as c').first(),
        tables: await knex('tables').count('id as c').first(),
    };

    // 2. BACKUP the live database.
    const { backupPath, sizeBytes } = await backupDatabase({ dbPath: DB_PATH, outDir: BACKUPS_DIR });
    assert.ok(fs.existsSync(backupPath), 'the backup file must actually exist on disk');
    assert.ok(sizeBytes > 0, 'the backup file must not be empty');

    // 3. DESTROY the live database -- simulates real data loss (disk failure, accidental
    // DELETE, a bad migration, etc.), not just "close the connection."
    await knex.destroy();
    fs.writeFileSync(DB_PATH, 'this is not a real database anymore -- simulated corruption/loss');
    assert.notEqual(fs.statSync(DB_PATH).size, sizeBytes, 'sanity check: the live file really has been destroyed/replaced');

    // 4. RESTORE from the backup.
    const restoreResult = await restoreDatabase({ fromBackupPath: backupPath, dbPath: DB_PATH });
    assert.equal(restoreResult.restoredTo, DB_PATH);
    assert.ok(restoreResult.safetyBackupPath, 'restoring over an existing (even corrupted) file must take a safety backup of it first');
    assert.ok(fs.existsSync(restoreResult.safetyBackupPath));

    // 5. VERIFY: reconnect and confirm every row is back exactly as it was.
    knex = Knex({ client: 'sqlite3', useNullAsDefault: true, connection: { filename: DB_PATH } });
    const restoredBurger = await knex('menu_items').where({ name: 'Backup Test Burger' }).first();
    assert.ok(restoredBurger, 'the seeded menu item must survive the full cycle');
    assert.equal(restoredBurger.price, '11.50');

    const restoredOrder = await knex('orders').where({ id: 'backup-restore-order-1' }).first();
    assert.ok(restoredOrder, 'the seeded order must survive the full cycle');
    assert.equal(restoredOrder.status, 'in-kitchen');
    assert.equal(JSON.parse(restoredOrder.data).quantity['1'], 1);

    const afterCounts = {
        menu_items: await knex('menu_items').count('id as c').first(),
        orders: await knex('orders').count('id as c').first(),
        tables: await knex('tables').count('id as c').first(),
    };
    assert.deepEqual(afterCounts, beforeCounts, 'row counts across every seeded table must match EXACTLY after the full cycle -- nothing lost, nothing duplicated');
});

test('backupDatabase refuses to run when the source database does not exist', async () => {
    await assert.rejects(
        () => backupDatabase({ dbPath: path.join(TMP_DIR, 'does-not-exist.sqlite'), outDir: BACKUPS_DIR }),
        /No database found/
    );
});

test('restoreDatabase refuses a file that is not a real Asmara POS backup', async () => {
    const fakeBackupPath = path.join(TMP_DIR, 'not-a-real-backup.sqlite');
    const fakeKnex = Knex({ client: 'sqlite3', useNullAsDefault: true, connection: { filename: fakeBackupPath } });
    await fakeKnex.schema.createTable('unrelated_table', (t) => { t.increments('id'); });
    await fakeKnex.destroy();

    await assert.rejects(
        () => restoreDatabase({ fromBackupPath: fakeBackupPath, dbPath: DB_PATH }),
        /does not look like a real Asmara POS database backup/
    );

    // The live database must be COMPLETELY untouched by a rejected restore attempt.
    const stillThere = await knex('menu_items').where({ name: 'Backup Test Burger' }).first();
    assert.ok(stillThere, 'a refused restore must never touch the live database at all');

    fs.unlinkSync(fakeBackupPath);
});
