# Audit Trail Reference Implementation — §1.G

This folder is a working, runnable demonstration of the Immutable Audit Trail Standard from the Master Development Specification v2.0. It is **not** wired into the Asmara POS — it's standalone, dependency-free reference code you can run right now to see and verify the tamper-evidence property before it's built into the real system in Stage 5.

## Files

- `AUDIT-EVENT-SCHEMA.md` — the event shape, the two-layer tamper-resistance design, and the production MySQL DDL sketch for when this gets wired into the real database.
- `audit-logger.js` — the `AuditLogger` class: `record(event)` appends a hash-chained event to a local file; `verifyChain()` recomputes the chain and reports whether it's intact.
- `demo.js` — a runnable script that records 5 realistic events (login, register open, order create, table transfer, payment), verifies the chain, deliberately tampers with one event, and re-verifies — proving the tampering is detected.

## How to test it

```
cd governance/audit-trail
node demo.js
```

No `npm install` needed — it only uses Node's built-in `fs` and `crypto` modules, so it'll run on any Node version the rest of this project already requires.

### What you should see

1. "Recorded 5 events" — confirmation the log was written.
2. `{ valid: true, brokenAt: null, totalEvents: 5 }` — the chain is intact.
3. A message showing event #3 (`order.create`) being rewritten in place, simulating what a compromised process or a raw database edit might attempt.
4. `{ valid: false, brokenAt: 2, ... }` — the tampering is caught, and the exact position it happened at is reported.

If you see anything other than that (e.g. `valid: true` after the tamper step), that's a bug in `audit-logger.js` and should be treated as a failing test, not a passing one.

## What this does and doesn't prove

**Does prove:** the hash-chaining approach correctly detects any alteration to historical event data, using nothing but the raw log contents — no external system needed to catch it.

**Doesn't prove (by design, this is a local demo):** the storage-level protection the real system needs. In production, the equivalent MySQL table is written by a database user with `INSERT`-only privileges (no `UPDATE`, no `DELETE`) — see the DDL sketch in `AUDIT-EVENT-SCHEMA.md` — so the tamper this demo simulates (directly rewriting a historical row) couldn't even be performed through the application's own database connection in the first place. The hash chain is the second, independent layer of defense on top of that, valuable specifically because it also catches tampering performed *outside* the normal database connection (e.g. a direct file/disk-level edit, or a privileged admin action).

## Next step for this to become real

Wiring `AuditLogger`'s approach into the actual POS is Stage 5/phase 48's job, at which point:
- The flat-file storage is replaced with the MySQL `audit_events` table from the DDL sketch.
- `record()` calls are added at the points the schema doc lists (login, permission changes, table transfer, payment, register open/close, price changes, cancellations).
- The `verifyChain()` logic is adapted into a periodic integrity-check job (Stage 11's durable job system) rather than something run ad hoc.

Nothing in this folder should be treated as already deployed — it exists so the design can be reviewed and tested on its own merits now, ahead of that integration work.
