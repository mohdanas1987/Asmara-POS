/**
 * LOCAL DEV SERVER BOOTSTRAP — Phase 1 (no srv1399.hstgr.io dependency at all)
 *
 * This is a dev/test-only entry point, NOT part of the shipped app and NOT a replacement
 * for server.js. It exists so this project can be run and tested for real -- something that
 * has never been possible before now, because every prior validation pass could only reach
 * as far as `node --check` / `require()` against a database this environment can't connect
 * to. It mounts the exact same route files the real server.js uses (unmodified -- this file
 * imports them, it doesn't fork or duplicate their logic), but wires them to a local SQLite
 * database instead of the real remote MySQL.
 *
 * Exports `createApp(knexInstance)` -- builds a fresh, isolated Express app bound to
 * whichever knex instance you hand it. The automated test suite (test/*.test.js) uses this
 * directly, each with its OWN throwaway SQLite file, so test files never share database
 * state or risk SQLite write-lock contention with each other.
 *
 * Usage (manual, interactive):
 *   node_modules/.bin/knex migrate:latest --knexfile knexfile.local.js   (once)
 *   node_modules/.bin/knex seed:run --knexfile knexfile.local.js         (once, or to reset)
 *   node server.local.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

const express = require('express');
const cors = require('cors');
const { Model } = require('objection');
const path = require('path');
const { logger } = require('./utils/logger');

function createApp(knex) {
    Model.knex(knex);

    const app = express();

    app.use(cors({ origin: true })); // wide open on purpose -- local dev harness, not a deployment
    app.use(express.json());
    app.use('/images', express.static(path.join(__dirname, 'tmp')));

    app.use("/auth", require("./routes/auth"));
    app.use("/tables", require("./routes/tables"));
    app.use("/menu", require("./routes/menu"));
    app.use("/items", require("./routes/items"));
    app.use("/orders", require("./routes/orders"));
    app.use("/pos", require("./routes/pos"));
    app.use("/tax", require("./routes/tax"));
    app.use("/config", require("./routes/config"));
    app.use("/website", require("./routes/website"));
    app.use("/payments", require("./routes/payments"));
    app.use("/superadmin", require("./routes/superadmin"));
    app.use("/superadmin/billing", require("./routes/billing-admin"));
    app.use("/billing", require("./routes/billing"));

    app.get('/check-connection', async (req, res) => {
        knex.raw('SELECT 1')
            .then(() => res.json({ status: true, message: 'Local SQLite connected.' }))
            .catch((err) => res.json({ status: false, message: err.message }));
    });

    app.use((err, req, res, next) => {
        logger.error('local.unhandled.request.error', { message: err.message, path: req.path, method: req.method });
        if (res.headersSent) return next(err);
        res.status(500).json({ status: false, message: 'An unexpected error occurred.' });
    });

    return app;
}

// Only actually build the default knex connection + bind a port when this file is run
// directly (`node server.local.js`). The test suite calls createApp() itself with its own
// isolated knex instance instead, so requiring this file for tests never touches
// local_test.sqlite or opens a real network listener.
if (require.main === module) {
    const Knex = require('knex');
    const knexConfig = require('./knexfile.local.js').development;
    const knex = Knex(knexConfig);
    const port = 5102;

    process.on('unhandledRejection', (reason) => {
        logger.error('local.process.unhandledRejection', { message: reason && reason.message ? reason.message : String(reason) });
    });

    // The packaged desktop app (RestaurantOS-Desktop/main.js) has no separate install step
    // where a person runs `knex migrate:latest` by hand -- a restaurant owner double-clicks
    // an .exe, not a terminal. Running pending migrations automatically on every boot (before
    // the server starts accepting requests) is what makes that possible, and is safe to do
    // unconditionally: knex tracks applied migrations in its own table and this is a no-op
    // once a database is already current, exactly the same as running the command by hand.
    knex.migrate.latest()
        .then(([, migrationsRun]) => {
            if (migrationsRun.length > 0) {
                logger.info('local.migrations.applied', { migrations: migrationsRun });
            }
            startServer();
        })
        .catch((err) => {
            logger.error('local.migrations.failed', { message: err.message });
            console.error('Database migration failed -- refusing to start with a possibly-inconsistent schema:', err.message);
            process.exit(1);
        });

    function startServer() {
    const app = createApp(knex);

    // Real-time layer (Phase 1 build): replaces the old app's unused/broken Pusher
    // integration (see Task #12's frontend assessment) with a built-in Socket.IO server --
    // no external service, no paid dependency. Currently used for one event
    // ('online-order', emitted by routes/website.js's order webhook) so the POS UI can show
    // an incoming online order the instant it arrives, without polling.
    const http = require('http');
    const { Server } = require('socket.io');
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: '*' } });
    app.set('io', io);

    server.listen(port, () => {
        console.log(`Local dev server (SQLite, no Hostinger dependency) listening on http://localhost:${port}`);
    });
    }
}

module.exports = { createApp };
