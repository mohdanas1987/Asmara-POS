/**
 * Production-ready Knex configuration
 *
 * STAGE 2 / phase 16 + phase 8 (Credential reconciliation): this file previously read its
 * own independent set of REMOTE_SERVER_* environment variables, separate from the literals
 * db.js hardcoded — two independently-maintained credential sources for the same database.
 * Both now import the single shared config/database.js module, so the app and its own
 * migration CLI are guaranteed to point at the same database.
 */

require('dotenv').config();
const { mysqlConnection } = require('./config/database');

/** @type { Object.<string, import("knex").Knex.Config> } */
module.exports = {

    development: {
        client: 'mysql2',

        connection: {
            ...mysqlConnection,
            charset: 'utf8mb4'
        },

        pool: {
            min: 2,
            max: 20,
            acquireTimeoutMillis: 60000,
            idleTimeoutMillis: 30000,
            createTimeoutMillis: 30000,
            reapIntervalMillis: 1000,
            createRetryIntervalMillis: 200
        },

        migrations: {
            tableName: 'knex_migrations'
        }
    },

    production: {
        client: 'mysql2',

        connection: {
            ...mysqlConnection,
            charset: 'utf8mb4',
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
        },

        pool: {
            min: 5,
            max: 40, // 👈 important for POS load
            acquireTimeoutMillis: 60000,
            idleTimeoutMillis: 30000
        },

        migrations: {
            tableName: 'knex_migrations'
        }
    }

};
