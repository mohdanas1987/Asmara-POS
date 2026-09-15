'use strict';
/**
 * backend/config/database.js
 *
 * STAGE 2 / phase 16 (Database credential fix) + phase 8 (Credential reconciliation).
 *
 * Before this change, `db.js` hardcoded the live production MySQL host, user, database,
 * and password directly as string literals in source — meaning the real production
 * database password shipped inside every copy of the packaged application, extractable by
 * anyone who opened the .asar. Meanwhile `knexfile.js` read a *different*, `.env`-driven
 * set of the same-named variables for the Knex CLI migrations, so the app and its own
 * migration tool could silently point at two different databases.
 *
 * This module is now the ONE place that reads the database connection out of the
 * environment. Both `db.js` (used by the running app) and `knexfile.js` (used by the
 * Knex CLI) import from here, so there is exactly one source of truth.
 *
 * Required environment variables (see ../../SETUP-INSTRUCTIONS.md):
 *   REMOTE_SERVER_HOST
 *   REMOTE_SERVER_USER
 *   REMOTE_SERVER_PASSWORD
 *   REMOTE_SERVER_DATABASE
 * Optional:
 *   DB_PORT (defaults to 3306)
 */

require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Copy .env.example to .env and fill in your real database credentials before starting the server.`
    );
  }
  return value;
}

const mysqlConnection = {
  host: required('REMOTE_SERVER_HOST'),
  user: required('REMOTE_SERVER_USER'),
  password: required('REMOTE_SERVER_PASSWORD'),
  database: required('REMOTE_SERVER_DATABASE'),
  port: Number(process.env.DB_PORT || 3306),
};

module.exports = { mysqlConnection };
