'use strict';
/**
 * Real database restore, paired with scripts/backup-db.js (CTO doc "Asmara POS -- Remaining
 * Work Only", item 9). NOT to be confused with the pre-existing scripts/restore-from-export.js,
 * which is a one-off recovery script for a single specific data-loss incident (categories/
 * items/tables from a JSON export) -- this restores a FULL database backup produced by
 * backup-db.js, wholesale.
 *
 * SAFE BY DESIGN:
 *   - Before overwriting the live database, this ALWAYS takes a fresh safety backup of
 *     whatever is currently live (via backupDatabase() itself) -- so a restore to the wrong
 *     backup, or a restore performed by mistake, is itself always undoable by restoring that
 *     safety copy. This is the one behavior that makes "restore" safe to actually run instead
 *     of just a good idea to have on paper.
 *   - Refuses to run against a backup file that isn't a real, openable SQLite database with
 *     at least the `orders`/`knex_migrations` tables present (catches "restored the wrong
 *     file" before it does any damage, not after).
 *   - Atomic swap: writes to a temp path first, then renames over the live path -- a crash
 *     mid-restore leaves the ORIGINAL live database intact, never a half-copied file.
 *
 * Usage:  node scripts/restore-db.js --from=path/to/backups/backup-XYZ.sqlite [--db=path/to/db.sqlite]
 */
const path = require('path');
const fs = require('fs');
const Knex = require('knex');
const { backupDatabase } = require('./backup-db');

function parseArgs(argv) {
    const args = {};
    argv.forEach((a) => {
        const m = a.match(/^--([^=]+)=(.*)$/);
        if (m) args[m[1]] = m[2];
    });
    return args;
}

async function assertLooksLikeARealBackup(backupPath) {
    const knex = Knex({ client: 'sqlite3', useNullAsDefault: true, connection: { filename: backupPath } });
    try {
        const tables = await knex('sqlite_master').where('type', 'table').pluck('name');
        if (!tables.includes('orders') || !tables.includes('knex_migrations')) {
            throw new Error(`${backupPath} does not look like a real Asmara POS database backup (missing 'orders'/'knex_migrations' tables) -- refusing to restore it.`);
        }
    } finally {
        await knex.destroy();
    }
}

/**
 * @param {object} opts
 * @param {string} opts.fromBackupPath The backup file to restore.
 * @param {string} [opts.dbPath] The live database path to restore INTO.
 * @returns {Promise<{ restoredTo: string, safetyBackupPath: string }>}
 */
async function restoreDatabase({ fromBackupPath, dbPath } = {}) {
    if (!fromBackupPath || !fs.existsSync(fromBackupPath)) {
        throw new Error(`Backup file not found: ${fromBackupPath}`);
    }
    const targetPath = dbPath || process.env.RESTAURANTOS_SQLITE_PATH || path.join(__dirname, '../local_test.sqlite');

    await assertLooksLikeARealBackup(fromBackupPath);

    // Safety-first: back up whatever is CURRENTLY live before touching it, so this restore
    // itself can always be undone. If there's nothing live yet (a fresh install), this is
    // simply skipped -- there's nothing to protect.
    let safetyBackupPath = null;
    if (fs.existsSync(targetPath)) {
        const safetyDir = path.join(path.dirname(targetPath), 'backups', 'pre-restore-safety');
        try {
            const safety = await backupDatabase({ dbPath: targetPath, outDir: safetyDir });
            safetyBackupPath = safety.backupPath;
        } catch (vacuumError) {
            // REAL scenario this must handle, not just a theoretical edge case: the whole
            // reason someone is restoring is often that the live database is ALREADY broken
            // (corrupted, truncated, not a valid SQLite file at all) -- exactly the case where
            // VACUUM INTO (which requires opening the source as a real database) cannot work.
            // Requiring the broken database to be "backup-able" the normal way would defeat
            // the entire purpose of restore. Fall back to a raw byte-for-byte copy instead --
            // even a corrupted file's raw bytes are worth preserving in case the "restore" was
            // itself a mistake (e.g. the wrong backup file was chosen).
            if (!fs.existsSync(safetyDir)) fs.mkdirSync(safetyDir, { recursive: true });
            const fallbackPath = path.join(safetyDir, `raw-copy-${Date.now()}.sqlite`);
            fs.copyFileSync(targetPath, fallbackPath);
            safetyBackupPath = fallbackPath;
            console.log(`Could not VACUUM INTO a safety backup (source may already be corrupted: ${vacuumError.message}) -- fell back to a raw file copy at ${fallbackPath}.`);
        }
    }

    const tmpPath = `${targetPath}.restoring-${Date.now()}.tmp`;
    fs.copyFileSync(fromBackupPath, tmpPath);
    fs.renameSync(tmpPath, targetPath); // atomic on the same filesystem

    return { restoredTo: targetPath, safetyBackupPath };
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    if (!args.from) {
        console.error('Usage: node scripts/restore-db.js --from=path/to/backup.sqlite [--db=path/to/db.sqlite]');
        process.exit(1);
    }
    restoreDatabase({ fromBackupPath: args.from, dbPath: args.db })
        .then((result) => {
            console.log(`Restored ${result.restoredTo} from ${args.from}.`);
            if (result.safetyBackupPath) console.log(`The previous live database was safety-backed-up to ${result.safetyBackupPath} first.`);
        })
        .catch((err) => {
            console.error('Restore failed:', err.message);
            process.exit(1);
        });
}

module.exports = { restoreDatabase };
