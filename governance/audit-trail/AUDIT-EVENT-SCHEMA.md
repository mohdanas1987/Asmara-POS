# AUDIT-EVENT-SCHEMA.md
**Governance item:** §1.G, Master Development Specification v2.0
**Status:** ACTIVE reference design. The working demo in this same folder (`audit-logger.js` + `demo.js`) implements this shape and its tamper-evidence property so it can be reviewed and tested now, ahead of Stage 5/phase 48 wiring it into the real POS.

## The event shape

```
Audit Event
 ├── actor            (who performed the action — user id, or "system")
 ├── tenant           (reserved field even pre-SaaS — will be a fixed "asmara" value until Stage 13)
 ├── location         (reserved field — fixed single-location value until Stage 15)
 ├── terminal         (which POS terminal/device the action came from)
 ├── timestamp        (ISO 8601, UTC)
 ├── action           (e.g. "order.cancel", "register.close", "price.change")
 ├── entity           (what was acted on — type + id, e.g. "order:1042")
 ├── before           (state before the action, where applicable — null for pure creations)
 ├── after            (state after the action)
 └── correlationId    (ties related events together — e.g. one request that touches multiple entities)
```

## Tamper-resistance, in two layers

**Layer 1 — application-level hash chaining (implemented in `audit-logger.js`, demonstrated in `demo.js`):**
Every event, when recorded, is serialized deterministically and hashed together with the previous event's hash:

```
hash(n) = SHA-256( hash(n-1) + canonical_json(event(n)) )
```

The first event in a chain uses a fixed genesis value in place of `hash(n-1)`. Anyone can independently recompute the chain from the raw event log and confirm it matches the stored hashes; if even one field of one historical event is altered, every hash from that point forward stops matching, and the break is immediately locatable (see `demo.js`'s tamper-simulation step).

**Layer 2 — storage-level append-only enforcement (design target for the real MySQL implementation, not part of this local demo):**
In production, the `audit_events` table is written by a database user/role granted `INSERT` only — no `UPDATE`, no `DELETE` — so even a compromised application layer cannot rewrite history through the normal connection. This is the MySQL-appropriate equivalent of SQLite's `BEFORE UPDATE`/`BEFORE DELETE` triggers, and is what actually gets implemented when this schema is wired into the live database in Stage 5. It is not simulated in this local demo, which uses a flat file specifically so it can be run and inspected without any database dependency at all.

## Production MySQL DDL sketch (for Stage 5 implementation — not run against anything now)

```sql
CREATE TABLE audit_events (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor           VARCHAR(255)     NOT NULL,
  tenant          VARCHAR(64)      NOT NULL DEFAULT 'asmara',
  location        VARCHAR(64)      NOT NULL DEFAULT 'eindhoven-main',
  terminal        VARCHAR(64)      NOT NULL,
  event_timestamp DATETIME(3)      NOT NULL,
  action          VARCHAR(128)     NOT NULL,
  entity          VARCHAR(255)     NOT NULL,
  before_state    JSON             NULL,
  after_state     JSON             NULL,
  correlation_id  VARCHAR(64)      NOT NULL,
  prev_hash       CHAR(64)         NOT NULL,
  event_hash      CHAR(64)         NOT NULL,
  created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX idx_entity (entity),
  INDEX idx_actor (actor),
  INDEX idx_correlation (correlation_id),
  INDEX idx_timestamp (event_timestamp)
) ENGINE=InnoDB;

-- Production hardening (applied when this ships in Stage 5, not before):
-- REVOKE UPDATE, DELETE ON audit_events FROM <app_db_user>;
-- GRANT INSERT, SELECT ON audit_events TO <app_db_user>;
```

## How this maps to the phases that use it

- Stage 5/phase 48 — authentication/authorization audit logging (login, permission changes) writes to this shape.
- Stage 9/phase 69 — the audit trail UI/export reads from this shape.
- Stage 4/phase 35 — table-transfer audit records use this shape (`action: "table.transfer"`, `entity: "order:<id>"`, `before`/`after` capturing source/destination table).
