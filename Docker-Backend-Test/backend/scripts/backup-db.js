'use strict';
/**
 * Real database backup (CTO doc "Asmara POS -- Remaining Work Only", item 9: "I have not
 * seen sufficient evidence... for a fully tested production backup -> destroy -> restore ->
 * verify cycle" -- the only prior "backup" mechanism found, GET /config/upload-db/:client,
 * has no restore path at all and was only access-control-hardened, not built out).
 *
 * GROUND TRUTH established before writing this: this app's local-first architecture (see
 * knexfile.local.js's own header comment) means production data for a single restaurant
 * install lives in ONE SQLite file. That makes a correct backup much simpler than a generic
 * "dump a production database" script: SQLite's own `VACUUM INTO` command produces a
 * consistent, complete, single-file snapshot of the live database in one atomic step --
 * including if called mid-write elsewhere, since SQLite's own transaction/locking model
 * guarantees `VACUUM INTO` never captures a torn/partial write. This is what SQLite's own
 * documentation recommends for exactly this purpose, in preference to a raw filesystem copy
 * (which CAN capture a mid-transaction, corrupt-looking snapshot if copied while the WAL is
 * mid-checkpoint). Uses this repo's own existing `knex`/`sqlite3` dependencies -- no new
 * package added just for this.
 *
 * Usage:  node scripts/backup-db.js [--db=path/to/db.sqlite] [--out=path/to/backups/]
 * Defaults to the same RESTAURANTOS_SQLITE_PATH env var / ./local_test.sqlite fallback that
 * knexfile.local.js itself uses, so a real install's normal environment "just works" with no
 * extra configuration.
 */
const path = require('path');
const fs = require('fs');
const Knex = require('knex');

function parseArgs(argv) {
    const args = {};
    argv.forEach((a) => {
        const m = a.match(/^--([^=]+)=(.*)$/);
        if (m) args[m[1]] = m[2];
    });
    return args;
}

/**
 * @param {object} opts
 * @param {string} [opts.dbPath] Source SQLite file.
 * @param {string} [opts.outDir] Directory to write the backup into (created if missing).
 * @returns {Promise<{ backupPath: string, sizeBytes: number }>}
 */
async function backupDatabase({ dbPath, outDir } = {}) {
    const sourcePath = dbPath || process.env.RESTAURANTOS_SQLITE_PATH || path.join(__dirname, '../local_test.sqlite');
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`No database found at ${sourcePath} -- nothing to back up.`);
    }
    const backupsDir = outDir || path.join(path.dirname(sourcePath), 'backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupsDir, `backup-${timestamp}.sqlite`);
    if (fs.existsSync(backupPath)) {
        throw new Error(`Refusing to overwrite existing backup file at ${backupPath}.`);
    }

    const knex = Knex({ client: 'sqlite3', useNullAsDefault: true, connection: { filename: sourcePath } });
    try {
        // VACUUM INTO requires an absolute path, and SQLite refuses if the destination
        // already exists -- both already guaranteed above.
        const absoluteDest = path.resolve(backupPath).replace(/'/g, "''");
        await knex.raw(`VACUUM INTO '${absoluteDest}'`);
    } finally {
        await knex.destroy();
    }

    const sizeBytes = fs.statSync(backupPath).size;
    return { backupPath, sizeBytes };
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    backupDatabase({ dbPath: args.db, outDir: args.out })
        .then((result) => console.log(`Backup written to ${result.backupPath} (${result.sizeBytes} bytes).`))
        .catch((err) => {
            console.error('Backup failed:', err.message);
            process.exit(1);
        });
}

module.exports = { backupDatabase };
