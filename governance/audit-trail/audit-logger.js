'use strict';
/**
 * audit-logger.js
 * Reference implementation of the §1.G Immutable Audit Trail Standard
 * (Master Development Specification v2.0).
 *
 * This is a LOCAL, DEPENDENCY-FREE demonstration of the hash-chaining
 * tamper-evidence property described in AUDIT-EVENT-SCHEMA.md. It writes
 * events as append-only JSON lines to a flat file and can verify the
 * resulting chain. It is NOT the production implementation — the real
 * system writes to MySQL with an INSERT-only database grant (see the DDL
 * sketch in AUDIT-EVENT-SCHEMA.md). This file exists so the tamper-evidence
 * *concept* can be reviewed and run today, independent of any database.
 *
 * Usage: see demo.js in this same folder.
 */

const fs = require('fs');
const crypto = require('crypto');

const GENESIS_HASH = '0'.repeat(64);

/** Deterministic JSON serialization so hashing is stable regardless of key insertion order. */
function canonicalJSON(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(',')}}`;
}

function computeHash(prevHash, eventWithoutHash) {
  return crypto
    .createHash('sha256')
    .update(prevHash + canonicalJSON(eventWithoutHash))
    .digest('hex');
}

class AuditLogger {
  /**
   * @param {string} logPath - path to the append-only JSONL log file.
   */
  constructor(logPath) {
    this.logPath = logPath;
  }

  /** Returns the hash of the last event in the log, or the genesis hash if the log is empty/missing. */
  _lastHash() {
    if (!fs.existsSync(this.logPath)) return GENESIS_HASH;
    const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
    if (lines.length === 0) return GENESIS_HASH;
    return JSON.parse(lines[lines.length - 1]).hash;
  }

  /**
   * Records one audit event, per the §1.G schema:
   * actor, tenant, location, terminal, action, entity, before, after, correlationId.
   * timestamp is set automatically. Returns the stored record (including its hash).
   */
  record({ actor, tenant, location, terminal, action, entity, before = null, after = null, correlationId }) {
    const prevHash = this._lastHash();
    const event = {
      actor,
      tenant,
      location,
      terminal,
      timestamp: new Date().toISOString(),
      action,
      entity,
      before,
      after,
      correlationId,
      prevHash,
    };
    const hash = computeHash(prevHash, event);
    const record = { ...event, hash };
    fs.appendFileSync(this.logPath, JSON.stringify(record) + '\n', { flag: 'a' });
    return record;
  }

  /**
   * Reads the full log and recomputes the hash chain from scratch.
   * Returns { valid: boolean, brokenAt: number|null, totalEvents: number }.
   * brokenAt is the 0-indexed position of the first event whose stored hash
   * no longer matches what the chain predicts — i.e. where tampering (or
   * corruption) was introduced.
   */
  verifyChain() {
    if (!fs.existsSync(this.logPath)) return { valid: true, brokenAt: null, totalEvents: 0 };
    const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
    let expectedPrev = GENESIS_HASH;

    for (let i = 0; i < lines.length; i++) {
      const record = JSON.parse(lines[i]);
      const { hash, ...eventWithoutHash } = record;

      if (eventWithoutHash.prevHash !== expectedPrev) {
        return { valid: false, brokenAt: i, totalEvents: lines.length, reason: 'prevHash does not match previous record' };
      }
      const recomputed = computeHash(eventWithoutHash.prevHash, eventWithoutHash);
      if (recomputed !== hash) {
        return { valid: false, brokenAt: i, totalEvents: lines.length, reason: 'stored hash does not match recomputed hash — event content was altered' };
      }
      expectedPrev = hash;
    }
    return { valid: true, brokenAt: null, totalEvents: lines.length };
  }
}

module.exports = { AuditLogger, canonicalJSON, computeHash, GENESIS_HASH };
