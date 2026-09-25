'use strict';
/**
 * Generic bidirectional sync-mutation engine -- the push/ACK half of multi-terminal sync.
 * See migrations_local/0028_sync_mutations.js for the schema and the full reasoning on why
 * this exists alongside (not instead of) the order/payment routes' own optimistic locking.
 *
 * PER-ENTITY CONFLICT STRATEGY (ChatGPT CTO review: "one universal algorithm isn't
 * appropriate -- Table assignment needs deterministic ownership, Order needs a real conflict
 * strategy (never generic last-write-wins), Payment must absolutely never use blind
 * last-write-wins, Loyalty needs ledger/transaction semantics, Menu can use version-based
 * replacement"). This module is the generic push path, and it deliberately only accepts the
 * entity types for which "version-based replacement, reject-on-stale-base-version" IS the
 * correct, already-endorsed strategy. Every other entity type is REFUSED here, not silently
 * mis-handled, so the boundary is enforced by code, not just a comment:
 *
 *   - table_claim  -> NOT handled here. Has its own atomic compare-and-set claim inside a
 *                     transaction (GET /orders/init/:table in routes/orders.js) -- a claim
 *                     is a "first free wins" race, not a version replacement, so it needs its
 *                     own primitive. See test/table-claim-race.test.js.
 *   - order        -> NOT handled here. Order mutations go through /orders/create,
 *                     /orders/to-kitchen, /orders/payment-update, which already enforce
 *                     `expected_version` optimistic locking and reject stale writes with a
 *                     409 (see routes/orders.js) -- never blind last-write-wins. Recorded to
 *                     sync_conflicts on rejection (services/conflictLog.js).
 *   - payment      -> NOT handled here, for the same reason as order, with an even harder
 *                     line: a payment is a monetary fact, and this app already treats it as
 *                     append-only ledger entries (services/payments/paymentLedger.js), never
 *                     as a mutable row that a "last write" could clobber. There is nothing
 *                     for a generic replace-if-newer engine to safely do to a payment record.
 *   - loyalty      -> NOT handled here. Loyalty balance changes are ledger/transaction
 *                     entries (earn/redeem rows), not a mutable "current balance" field a
 *                     version-replace could overwrite -- the ledger itself is the conflict-free
 *                     replicated data structure (append-only, order-independent sum).
 *   - table_layout -> HANDLED here. Floor-plan position/size/section on `tables` -- cosmetic,
 *                     no side effects, version-based replacement is genuinely safe.
 *   - menu_item    -> HANDLED here. Price/availability/name edits on `menu_items` --
 *                     version-based replacement is the CTO doc's own suggested strategy.
 *                     Supports 'delete' as a real tombstone (soft-delete via the existing
 *                     `deleted` flag), so a menu item removed on one terminal propagates as a
 *                     removal to every other terminal, not silently reappearing.
 */
const Model = require('objection').Model;
const { transaction } = require('objection');
const { recordChange } = require('./syncLog');
const { recordConflict } = require('../conflictLog');

function knex() {
  return Model.knex();
}

// Entity types this generic engine will actually apply. Anything else is refused outright.
const HANDLED_ENTITY_TYPES = new Set(['table_layout', 'menu_item']);

const NOT_HANDLED_REASONS = {
  table_claim: 'table_claim uses its own atomic compare-and-set claim -- see GET /orders/init/:table, not the generic sync-push path.',
  order: 'order mutations must go through /orders/create, /orders/to-kitchen or /orders/payment-update, which enforce expected_version optimistic locking.',
  payment: 'payments are append-only ledger entries (services/payments/paymentLedger.js) -- there is no mutable payment record for a generic replace to target.',
  loyalty: 'loyalty balance changes are ledger/transaction entries, not a mutable field a generic version-replace could safely overwrite.',
};

const ENTITY_TABLE = { table_layout: 'tables', menu_item: 'menu_items' };
const ENTITY_KEY_COLUMN = { table_layout: 'id', menu_item: 'id' };
// Fields a mutation payload is allowed to touch, per entity type -- keeps this generic engine
// from becoming an arbitrary-column-write primitive.
const ENTITY_MUTABLE_FIELDS = {
  table_layout: ['x', 'y', 'length', 'width', 'section', 'capacity'],
  menu_item: ['name', 'price', 'pos', 'stock', 'sales_desc'],
};

async function currentCursor(trx, tenantId) {
  const row = await (trx || knex())('sync_log').where('tenant_id', tenantId).max('id as maxId').first();
  return row?.maxId || 0;
}

/**
 * Applies (or rejects) a single mutation, idempotently. Safe to call any number of times with
 * the same (terminal_id, mutation_id) -- every call after the first just replays the stored
 * result, never re-applies.
 *
 * @returns {Promise<{mutation_id: string, accepted: boolean, server_version: number|null, cursor: number, reason?: string}>}
 */
async function pushMutation({ tenantId, terminalId, mutationId, entityType, entityId, operation, payload, baseVersion }) {
  const db = knex();

  const existing = await db('sync_mutations')
    .where({ tenant_id: tenantId, terminal_id: terminalId, mutation_id: mutationId })
    .first();
  if (existing) {
    // Duplicate delivery / crash-and-retry / an outbox replaying what it never saw an ACK
    // for -- "apply once, ACK as many times as asked." Never re-run the side effects below.
    return {
      mutation_id: mutationId,
      accepted: existing.status === 'applied',
      server_version: existing.server_version,
      cursor: await currentCursor(null, tenantId),
      reason: existing.status === 'rejected' ? JSON.parse(existing.detail || '{}').reason : undefined,
    };
  }

  if (!HANDLED_ENTITY_TYPES.has(entityType)) {
    const reason = NOT_HANDLED_REASONS[entityType] || `entity_type '${entityType}' is not handled by the generic sync-push engine.`;
    try {
      await db('sync_mutations').insert({
        tenant_id: tenantId, terminal_id: terminalId, mutation_id: mutationId,
        entity_type: entityType, entity_id: String(entityId), operation,
        payload: JSON.stringify(payload ?? {}), base_version: baseVersion ?? null,
        server_version: null, status: 'rejected', detail: JSON.stringify({ reason: 'unsupported_entity_type', message: reason }),
      });
    } catch (e) { /* a genuine concurrent duplicate lost the insert race -- fine, see below */ }
    return { mutation_id: mutationId, accepted: false, server_version: null, cursor: await currentCursor(null, tenantId), reason: 'unsupported_entity_type' };
  }

  const tableName = ENTITY_TABLE[entityType];
  const keyColumn = ENTITY_KEY_COLUMN[entityType];
  const mutableFields = ENTITY_MUTABLE_FIELDS[entityType];

  let result;
  try {
    result = await transaction(db, async (trx) => {
      const current = await trx(tableName).where({ tenant_id: tenantId, [keyColumn]: entityId }).first();
      if (!current) {
        return { accepted: false, serverVersion: null, reason: 'entity_not_found' };
      }
      const currentVersion = current.version || 1;

      if (operation === 'delete') {
        if (tableName !== 'menu_items') {
          return { accepted: false, serverVersion: currentVersion, reason: 'delete_not_supported_for_entity_type' };
        }
        if (Number(baseVersion) !== Number(currentVersion)) {
          return { accepted: false, serverVersion: currentVersion, reason: 'stale_base_version' };
        }
        const newVersion = currentVersion + 1;
        await trx(tableName).where({ tenant_id: tenantId, [keyColumn]: entityId }).update({ deleted: true, version: newVersion });
        return { accepted: true, serverVersion: newVersion, tombstone: true };
      }

      // update
      if (Number(baseVersion) !== Number(currentVersion)) {
        // Someone else's mutation already landed with a higher version -- reject-stale, the
        // same deterministic strategy the order/payment routes already use, applied here
        // generically. The loser gets the real current version back so it can rebase its
        // local copy and retry with the correct base_version -- this is what makes the
        // terminals converge instead of silently diverging.
        return { accepted: false, serverVersion: currentVersion, reason: 'stale_base_version' };
      }
      const patch = {};
      for (const field of mutableFields) {
        if (Object.prototype.hasOwnProperty.call(payload || {}, field)) patch[field] = payload[field];
      }
      const newVersion = currentVersion + 1;
      patch.version = newVersion;
      await trx(tableName).where({ tenant_id: tenantId, [keyColumn]: entityId }).update(patch);
      return { accepted: true, serverVersion: newVersion };
    });
  } catch (e) {
    result = { accepted: false, serverVersion: null, reason: 'apply_failed', message: e.message };
  }

  try {
    await db('sync_mutations').insert({
      tenant_id: tenantId, terminal_id: terminalId, mutation_id: mutationId,
      entity_type: entityType, entity_id: String(entityId), operation,
      payload: JSON.stringify(payload ?? {}), base_version: baseVersion ?? null,
      server_version: result.serverVersion, status: result.accepted ? 'applied' : 'rejected',
      detail: result.accepted ? null : JSON.stringify({ reason: result.reason, message: result.message }),
    });
  } catch (insertError) {
    // A genuine concurrent duplicate push (same terminal, same mutation_id, racing) lost the
    // unique-constraint race -- the winner's row is the truth; replay it instead of the result
    // this call itself computed (which may not even have been the one that got persisted).
    const winner = await db('sync_mutations').where({ tenant_id: tenantId, terminal_id: terminalId, mutation_id: mutationId }).first();
    if (winner) {
      return { mutation_id: mutationId, accepted: winner.status === 'applied', server_version: winner.server_version, cursor: await currentCursor(null, tenantId) };
    }
  }

  if (!result.accepted && result.reason === 'stale_base_version') {
    recordConflict({
      tenantId, entityType, entityId: String(entityId), terminalId, route: 'sync.push',
      localVersion: baseVersion, serverVersion: result.serverVersion,
    });
  }

  if (result.accepted) {
    // Propagate to sync_log so every OTHER terminal's GET /sync/changes poll sees this --
    // this is what makes a push from one terminal actually reach the others (remote mutation
    // application on the READ side; this row is what a peer terminal applies to converge).
    await recordChange({
      tenantId, terminalId, entityType, entityId,
      operation: result.tombstone ? 'delete' : 'update',
      payload: result.tombstone ? { deleted: true, version: result.serverVersion } : { ...payload, version: result.serverVersion },
    });
  }

  return {
    mutation_id: mutationId,
    accepted: result.accepted,
    server_version: result.serverVersion,
    cursor: await currentCursor(null, tenantId),
    reason: result.accepted ? undefined : result.reason,
  };
}

async function getCursor({ tenantId, terminalId }) {
  const row = await knex()('terminal_cursors').where({ tenant_id: tenantId, terminal_id: terminalId }).first();
  return row ? row.cursor : 0;
}

async function setCursor({ tenantId, terminalId, cursor }) {
  const db = knex();
  const existing = await db('terminal_cursors').where({ tenant_id: tenantId, terminal_id: terminalId }).first();
  if (existing) {
    await db('terminal_cursors').where({ id: existing.id }).update({ cursor, updated_at: new Date().toISOString() });
  } else {
    try {
      await db('terminal_cursors').insert({ tenant_id: tenantId, terminal_id: terminalId, cursor, updated_at: new Date().toISOString() });
    } catch (e) { /* a concurrent registration race -- the other writer's row is fine as-is */ }
  }
}

module.exports = { pushMutation, getCursor, setCursor, HANDLED_ENTITY_TYPES };
