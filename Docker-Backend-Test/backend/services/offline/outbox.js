'use strict';
/**
 * Generic outbound retry queue (project audit 2026-09-15, task "Offline-first foundation").
 *
 * Shared machinery for ANY delivery that might fail because the other end is temporarily
 * unreachable -- a peer terminal on the LAN, a future cloud API, a payment gateway, or the
 * public website webhook. Each of those integrations enqueues a delivery here instead of
 * hand-rolling its own retry/backoff logic; `processPending()` is meant to be called on a
 * timer (e.g. every 30s) by whatever process owns the connection to that target.
 *
 * Deliberately transport-agnostic: this module never makes an HTTP call itself. The caller
 * passes a `deliver` function (how to actually send this one payload) into processPending(),
 * because "how do I reach a LAN peer" and "how do I call Stripe" are completely different
 * concerns that don't belong inside a generic queue.
 */
const Model = require('objection').Model;

function knex() {
  return Model.knex();
}

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 5000; // 5s, 10s, 20s, 40s, ... capped below

function backoffMsForAttempt(attempt) {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, 30 * 60 * 1000); // cap at 30 minutes
}

/** Queues a delivery. Returns the outbox row. */
async function enqueue({ tenantId, targetType, targetUrl, payload }) {
  const [id] = await knex()('outbox').insert({
    tenant_id: tenantId,
    target_type: targetType,
    target_url: targetUrl ?? null,
    payload: JSON.stringify(payload ?? {}),
    status: 'pending',
    next_attempt_at: new Date().toISOString(),
  });
  return knex()('outbox').where('id', id).first();
}

/**
 * Attempts every due, pending entry for one tenant+targetType (so a dead payment gateway
 * doesn't hold up LAN peer sync, and vice versa). `deliver(entry)` must return a
 * truthy/resolved value on success and throw or reject on failure -- this function handles
 * all the bookkeeping (attempts, backoff, giving up after MAX_ATTEMPTS) around that.
 */
async function processPending({ tenantId, targetType, deliver }) {
  const db = knex();
  const now = new Date().toISOString();
  const due = await db('outbox')
    .where({ tenant_id: tenantId, target_type: targetType, status: 'pending' })
    .where((builder) => builder.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now))
    .orderBy('id', 'asc');

  const results = { sent: 0, failed: 0, gaveUp: 0 };
  for (const entry of due) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await deliver({ ...entry, payload: JSON.parse(entry.payload) });
      // eslint-disable-next-line no-await-in-loop
      await db('outbox').where('id', entry.id).update({ status: 'sent', sent_at: new Date().toISOString() });
      results.sent += 1;
    } catch (err) {
      const attempts = entry.attempts + 1;
      const gaveUp = attempts >= MAX_ATTEMPTS;
      // eslint-disable-next-line no-await-in-loop
      await db('outbox').where('id', entry.id).update({
        attempts,
        status: gaveUp ? 'failed' : 'pending',
        next_attempt_at: gaveUp ? null : new Date(Date.now() + backoffMsForAttempt(attempts)).toISOString(),
        last_error: String(err.message || err),
      });
      if (gaveUp) results.gaveUp += 1;
      else results.failed += 1;
    }
  }
  return results;
}

async function getStatus({ tenantId }) {
  const rows = await knex()('outbox')
    .where('tenant_id', tenantId)
    .select('target_type', 'status')
    .count('* as count')
    .groupBy('target_type', 'status');
  return rows;
}

module.exports = { enqueue, processPending, getStatus, MAX_ATTEMPTS };
