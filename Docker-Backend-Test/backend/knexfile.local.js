/**
 * LOCAL/OFFLINE DEV KNEXFILE — Phase 1 (no srv1399.hstgr.io dependency)
 *
 * Originally a dev-only tool; the packaged RestaurantOS Desktop app (see
 * RestaurantOS-Desktop/main.js) now also runs the app through this exact same SQLite path
 * for real restaurant data, since Phase 1's local-first architecture never grew a separate
 * MySQL-backed production mode. The filename is overridable via RESTAURANTOS_SQLITE_PATH so
 * the desktop shell can point it at a persistent, writable per-install location (Electron's
 * userData directory) instead of a path next to the app binary -- a real restaurant's order/
 * table/menu data must never live inside the installation folder itself, since that folder
 * can be read-only (a standard Windows Program Files install) and gets wiped by every
 * update/reinstall. Falls back to the original relative path when unset, so nothing about
 * the existing manual dev workflow changes:
 *   node_modules/.bin/knex migrate:latest --knexfile knexfile.local.js
 *   node_modules/.bin/knex seed:run --knexfile knexfile.local.js
 */
module.exports = {
    development: {
        client: 'sqlite3',
        connection: {
            filename: process.env.RESTAURANTOS_SQLITE_PATH || './local_test.sqlite'
        },
        useNullAsDefault: true,
        migrations: {
            directory: './migrations_local'
        },
        seeds: {
            directory: './seeds_local'
        }
    }
};
