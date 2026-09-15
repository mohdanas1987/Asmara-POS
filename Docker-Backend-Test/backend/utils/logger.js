'use strict';
/**
 * backend/utils/logger.js
 *
 * STAGE 2 / phase 21 (Structured logging & error handling baseline).
 *
 * A deliberately minimal, dependency-free structured logger — no new npm package was added
 * so this Release Bundle doesn't require rebuilding the Electron installer's node_modules.
 * Every call produces one JSON line with a consistent shape (timestamp, level, event,
 * metadata), so logs are machine-parseable from day one. This is the baseline the TDD §27
 * observability work (Stage 11) replaces with real log shipping — this module's job for now
 * is just to stop `console.log`/`console.error` calls from being the only record of what
 * happened, and to guarantee secrets are never accidentally logged.
 *
 * Usage:
 *   const { logger } = require('../utils/logger');
 *   logger.info('order.created', { orderId: order.id, tables: order.tables });
 *   logger.warn('cors.rejected', { origin });
 *   logger.error('unhandled.request.error', { message: err.message, path: req.path });
 *
 * Rule: never pass a password, token, or full JWT/secret value as metadata. If a value
 * might be sensitive, log that it existed, not what it was (e.g. `{ hasToken: true }`).
 */

const REDACT_KEYS = new Set(['password', 'secret', 'token', 'authorization', 'jwt', 'authtoken']);

function redact(meta) {
    if (!meta || typeof meta !== 'object') return meta;
    const safe = {};
    for (const [key, value] of Object.entries(meta)) {
        if (REDACT_KEYS.has(key.toLowerCase())) {
            safe[key] = '[REDACTED]';
        } else {
            safe[key] = value;
        }
    }
    return safe;
}

function write(level, event, meta) {
    const line = {
        timestamp: new Date().toISOString(),
        level,
        event,
        ...redact(meta),
    };
    const out = JSON.stringify(line);
    if (level === 'error') {
        console.error(out);
    } else if (level === 'warn') {
        console.warn(out);
    } else {
        console.log(out);
    }
}

const logger = {
    info: (event, meta) => write('info', event, meta),
    warn: (event, meta) => write('warn', event, meta),
    error: (event, meta) => write('error', event, meta),
};

module.exports = { logger };
