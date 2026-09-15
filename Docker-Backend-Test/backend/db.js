const Knex = require("knex");
const { Model } = require("objection");
// STAGE 2 / phase 16: this file used to hardcode the live production MySQL host, user,
// database, and password directly as string literals right here in source — meaning every
// copy of this packaged application shipped the real production database password,
// extractable by anyone who opened the app.asar. Credentials now come from the environment,
// through the single shared config/database.js module (see that file for the full
// explanation, and why knexfile.js now reads from the same place).
const { mysqlConnection } = require("./config/database");

const mysqlConfig = {
    client: "mysql2",
    connection: mysqlConnection,
    pool: { min: 2, max: 30 }
};

const sqliteConfig = {
    client: "sqlite3",
    connection: {
        filename: "./db.sqlite", // local db file
    },
    useNullAsDefault: true,
};

let knex = Knex(mysqlConfig); // default is remote MySQL
Model.knex(knex);

function switchToMySQL() {
    knex = Knex(mysqlConfig);
    Model.knex(knex);
}

function switchToSQLite() {
    knex = Knex(sqliteConfig);
    Model.knex(knex);
}

module.exports = {
    mysqlConfig,
    sqliteConfig,
    switchToMySQL,
    switchToSQLite,
    knex: () => knex
};
