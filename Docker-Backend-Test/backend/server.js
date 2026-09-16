require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Model } = require('objection');
const Knex = require('knex');
const path = require('path');
const { mysqlConfig } = require('./db');
const { logger } = require('./utils/logger');
const buildPath = path.join(__dirname, 'client/build');

const knex = Knex(mysqlConfig);

Model.knex(knex);

const app = express();
const port = 5101;

// STAGE 2 / phase 17 (CORS lockdown): this used to be `app.use(cors())` with no
// configuration at all — every origin on the internet was allowed to call every route.
// Combined with the auth gaps fixed elsewhere in this Release Bundle, that meant any
// website a staff member's browser happened to have open could have silently issued
// requests against this server. The allowlist below defaults to the origins the POS
// frontend itself is actually served from; add any other legitimate origin (a future web
// admin, etc.) via ALLOWED_ORIGINS in .env rather than reopening this to "*".
const defaultOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
];
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
const allowedOrigins = [...new Set([...defaultOrigins, ...configuredOrigins])];

app.use(cors({
    origin(origin, callback) {
        // Requests with no Origin header (e.g. the Electron renderer loading the app itself,
        // or server-to-server calls) are not browser cross-origin requests and are allowed.
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        logger.warn('cors.rejected', { origin });
        return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    }
}));
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'tmp')));
app.use(express.static(buildPath));

app.use("/auth", require("./routes/auth"));
app.use("/users", require("./routes/users"));
app.use("/kitchen", require("./routes/kitchen"));
app.use("/loyalty", require("./routes/loyalty"));
app.use("/sync", require("./routes/sync"));
app.use("/tables", require("./routes/tables"));
app.use("/menu", require("./routes/menu"));
app.use("/items", require("./routes/items"));
app.use("/orders", require("./routes/orders"));
app.use("/pos", require("./routes/pos"));
app.use("/tax", require("./routes/tax"));
app.use("/config", require("./routes/config"));


app.get('/check-connection', async(req,res) => {
    knex.raw('SELECT 1')
    .then(() => res.json({status:true, message: '✅ Database connected successfully!'}))
    .catch((err) => res.json({status:false, message: '❌ Database connection failed'}))
})

// STAGE 2 / phase 21 (Structured logging & error handling baseline): a final error handler
// so an unhandled exception in any route returns a safe, structured response instead of
// leaking a stack trace to the client, while still logging the full detail server-side.
app.use((err, req, res, next) => {
    logger.error('unhandled.request.error', {
        message: err.message,
        path: req.path,
        method: req.method,
    });
    if (res.headersSent) return next(err);
    res.status(500).json({ status: false, message: 'An unexpected error occurred.' });
});

// STAGE 2 / phase 25 (Process-level crash safety net): Express 4 does NOT forward a
// rejected promise from an async route handler to the app.use((err,req,res,next)=>{...})
// error handler above -- that only catches synchronous throws or errors explicitly passed
// to next(err). Any route missing its own try/catch (found and fixed one such case in
// pos.js's /session route -- see that file's STAGE 2 / phase 23 comment) produces an
// unhandled promise rejection instead, which on the Node version this app ships with
// terminates the entire process by default -- taking down the whole restaurant's POS over
// a single bad request. These two handlers are a last-resort net: they log the failure
// (so it's visible, not silent) and keep the server running rather than crashing it. This
// does not fix the underlying missing try/catch anywhere it still exists -- it only stops
// one such bug from being able to take the whole system down.
process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandledRejection', {
        message: reason && reason.message ? reason.message : String(reason)
    });
});
process.on('uncaughtException', (err) => {
    logger.error('process.uncaughtException', { message: err.message });
});

// app.listen(port);

let server
function start(){
    server = app.listen(port)
    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            logger.error('server.start.failed', { reason: 'EADDRINUSE', port });
            console.error(`❌ Port ${port} is already in use.`);
            process.exit(1); // Exit the process
        } else {
            logger.error('server.start.failed', { message: err.message });
            console.error("Server error:", err);
        }
    });
}

function stop(){
  server.close()
}

module.exports = { start, stop }
