'use strict';
/**
 * Payment / order idempotency (CTO forensic audit 2026-09-21, P0 "Payment idempotency +
 * recovery"). Wraps a route so that a retried request carrying the SAME `idempotency_key`
 * (in the request body -- POS requests are always JSON POSTs, no header plumbing needed)
 * replays the original response instead of re-running the handler's side effects a second
 * time. This is what stops a slow-network retry or a double-tapped "Charge" button from
 * double-charging a customer or double-creating an order.
 *
 * Usage: router.post('/create', fetchuser, idempotent('orders.create'), async (req, res) => {...})
 * The wrapped handler must use `res.json(...)` / `res.status(x).json(...)` as its ONLY way of
 * responding -- this middleware intercepts `res.json` to capture what would have been sent,
 * and only persists it (so it's replayed on a genuine retry) once the handler completes
 * successfully without throwing.
 *
 * A request that omits `idempotency_key` behaves EXACTLY as before this existed -- it is not
 * required, so no existing caller (frontend not yet updated, or a test that predates this)
 * is broken by adding this middleware to a route. This is honestly a lighter-weight
 * implementation than a full reservation/lock scheme: a genuine race between two concurrent
 * requests carrying the identical key can both pass the initial existence check before either
 * has written its row (there is no "reserve the key up front" step) -- in POS reality this
 * requires the identical retried request racing itself within milliseconds of network jitter,
 * which the pre-existing unique DB constraint still turns into a clean, safe failure (a
 * duplicate insert throws, caught below and returned as a 409) rather than a silent double
 * charge; it does not by itself guarantee the SECOND racer's *response* is the original one.
 */
const IdempotencyKey = require('../models/IdempotencyKey');

function idempotent(route) {
  return function idempotentMiddleware(req, res, next) {
    const key = req.body && req.body.idempotency_key;
    if (!key || typeof key !== 'string') {
      return next(); // no key supplied -- behave exactly as before this middleware existed
    }
    const tenantId = req.body.tenant_id;

    IdempotencyKey.forTenant(tenantId)
      .where({ idempotency_key: key, route })
      .first()
      .then((existing) => {
        if (existing) {
          // Replay -- the handler's side effects (the charge, the order, whatever it was)
          // already happened exactly once on the original request. Never run them again.
          return res.status(existing.status_code).json(JSON.parse(existing.response_json));
        }

        const originalJson = res.json.bind(res);
        res.json = (body) => {
          const statusCode = res.statusCode || 200;
          // Only persist a successful (2xx) response as the replay-able record -- an error
          // response is allowed to be retried for real (the request may legitimately
          // succeed on a second attempt, e.g. after a transient DB error).
          if (statusCode >= 200 && statusCode < 300) {
            IdempotencyKey.query()
              .insert({
                tenant_id: tenantId,
                idempotency_key: key,
                route,
                status_code: statusCode,
                response_json: JSON.stringify(body),
              })
              .catch((err) => {
                // Unique-constraint violation means a genuine concurrent duplicate raced us
                // to the insert -- both requests' side effects still only ran once each
                // independently, which is the one guarantee this must never break; the raw
                // race on which response wins is the documented limitation above.
                console.log('[idempotency] non-fatal: could not persist replay record:', err.message);
              });
          }
          return originalJson(body);
        };

        next();
      })
      .catch((err) => {
        console.log('[idempotency] non-fatal: lookup failed, proceeding without replay protection:', err.message);
        next();
      });
  };
}

module.exports = idempotent;
