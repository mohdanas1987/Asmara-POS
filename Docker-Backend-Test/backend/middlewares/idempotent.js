'use strict';
/**
 * Payment / order idempotency (CTO forensic audit 2026-09-21, P0 "Payment idempotency +
 * recovery"; hardened further per CTO feedback 2026-09-22, item 11 "Idempotency hardening --
 * race conditions, payment-specific idempotency, replay-after-restart testing"). Wraps a
 * route so that a retried request carrying the SAME `idempotency_key` (in the request body --
 * POS requests are always JSON POSTs, no header plumbing needed) replays the original response
 * instead of re-running the handler's side effects a second time. This is what stops a slow-
 * network retry or a double-tapped "Charge" button from double-charging a customer or
 * double-creating an order.
 *
 * Usage: router.post('/create', fetchuser, idempotent('orders.create'), async (req, res) => {...})
 * The wrapped handler must use `res.json(...)` / `res.status(x).json(...)` as its ONLY way of
 * responding -- this middleware intercepts `res.json` to capture what would have been sent.
 *
 * A request that omits `idempotency_key` behaves EXACTLY as before this existed -- it is not
 * required, so no existing caller (frontend not yet updated, or a test that predates this) is
 * broken by adding this middleware to a route.
 *
 * RACE-CONDITION FIX (this hardening pass): the original implementation only ever wrote a row
 * AFTER the handler finished, so two requests with the identical key could both pass the
 * "does a row already exist?" check before either had written one, and both would run the
 * handler's real side effects -- a documented, known gap. This version reserves the key with
 * an INSERT of a 'pending' placeholder row BEFORE calling the handler at all. The table's
 * pre-existing unique constraint on (tenant_id, idempotency_key, route) makes that INSERT
 * itself the atomic race-resolution point at the database level: only one of two simultaneous
 * requests can ever succeed at inserting the same key, full stop, regardless of application-
 * level timing. The loser of that race never runs the handler -- it either replays a
 * completed response or, if the winner is still mid-flight, returns 409 "already in
 * progress" (safe: refusing to double-run a financial side effect is always the right default
 * when we cannot yet know if the first attempt succeeded).
 *
 * CRASH / RESTART: a 'pending' row whose owning request crashed or the process restarted
 * before finishing would otherwise wedge that key forever (every retry gets 409). Rather than
 * silently declaring this solved with a background reaper (a bigger, separate piece of work
 * -- see the CTO's crash/recovery item 16, not attempted here), a pending row older than
 * PENDING_TTL_MS is treated as abandoned and the reservation is retried once. This is a
 * conservative, explicit choice: too short a TTL risks a slow-but-still-running request being
 * treated as abandoned and double-run; PENDING_TTL_MS is deliberately generous (2 minutes,
 * far longer than any real charge/order-create request should ever take) to keep that risk
 * negligible while still letting a genuinely crashed request's key recover.
 */
const IdempotencyKey = require('../models/IdempotencyKey');

const PENDING_TTL_MS = 2 * 60 * 1000;

function idempotent(route) {
  return function idempotentMiddleware(req, res, next) {
    const key = req.body && req.body.idempotency_key;
    if (!key || typeof key !== 'string') {
      return next(); // no key supplied -- behave exactly as before this middleware existed
    }
    const tenantId = req.body.tenant_id;

    async function reserve() {
      return IdempotencyKey.query().insert({
        tenant_id: tenantId,
        idempotency_key: key,
        route,
        status: 'pending',
        status_code: null,
        response_json: null,
      });
    }

    async function run() {
      let reservation;
      try {
        reservation = await reserve();
      } catch (insertError) {
        // Unique-constraint violation -- someone (an earlier attempt, or a genuinely
        // concurrent request) already holds this key. Look at what they left behind.
        const existing = await IdempotencyKey.forTenant(tenantId)
          .where({ idempotency_key: key, route })
          .first();

        if (!existing) {
          // Extremely unlikely (row deleted between the failed insert and this read) --
          // fail safe rather than silently re-running a financial side effect.
          console.log('[idempotency] non-fatal: insert conflict but no existing row found for', route);
          return res.status(409).json({ status: false, conflict: true, message: 'Please retry.' });
        }

        if (existing.status === 'completed') {
          return res.status(existing.status_code).json(JSON.parse(existing.response_json));
        }

        // status === 'pending' -- either genuinely in flight right now, or abandoned by a
        // crash/restart. Only reclaim it if it's old enough to be considered abandoned.
        const ageMs = Date.now() - new Date(existing.created_at).getTime();
        if (ageMs < PENDING_TTL_MS) {
          return res.status(409).json({
            status: false,
            conflict: true,
            message: 'This request is already being processed. Please wait and check the result before retrying.',
          });
        }

        // Abandoned: reclaim the same row for this attempt instead of inserting a new one
        // (the unique constraint means only one row can ever exist for this key anyway).
        try {
          await IdempotencyKey.query().patchAndFetchById(existing.id, {
            status: 'pending',
            status_code: null,
            response_json: null,
          });
          reservation = existing;
        } catch (reclaimError) {
          console.log('[idempotency] non-fatal: could not reclaim abandoned key, proceeding without replay protection:', reclaimError.message);
          return next();
        }
      }

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        const statusCode = res.statusCode || 200;
        const isSuccess = statusCode >= 200 && statusCode < 300;
        const update = isSuccess
          ? { status: 'completed', status_code: statusCode, response_json: JSON.stringify(body) }
          // A non-2xx response means the side effect did NOT durably happen -- delete the
          // reservation so a real retry (same key) is free to actually run again, exactly
          // like the pre-hardening behavior for error responses.
          : null;

        const cleanup = update
          ? IdempotencyKey.query().patchAndFetchById(reservation.id, update)
          : IdempotencyKey.query().deleteById(reservation.id);

        // Awaited (not fire-and-forget) before the response goes out: this closes a subtle
        // window the original fire-and-forget version left open -- a client that sees the
        // response and immediately retries with the same key must never be able to race
        // ahead of this cleanup finishing (which would wrongly return 409 "already in
        // progress" for a request that, from the client's perspective, already got its
        // final answer).
        cleanup
          .catch((err) => {
            console.log('[idempotency] non-fatal: could not finalize reservation record:', err.message);
          })
          .finally(() => originalJson(body));
      };

      // NOTE on the "handler throws or never responds at all" case: every route this
      // middleware wraps already has its own try/catch that calls res.json(...) on any
      // error (see routes/orders.js) -- Preservation Contract, unchanged by this file. If a
      // future handler somehow throws past that and never responds, the reservation is left
      // 'pending' and recovered by the TTL-based reclaim above on the next attempt with the
      // same key, exactly like a crashed process would be. There is deliberately no
      // synchronous try/finally around `next()` here: for an async Express handler, next()
      // returns long before the handler settles, so a finally block at this point would run
      // before the handler has done anything and cannot observe whether it succeeded.
      next();
    }

    run().catch((err) => {
      console.log('[idempotency] non-fatal: reservation flow failed, proceeding without replay protection:', err.message);
      next();
    });
  };
}

module.exports = idempotent;
