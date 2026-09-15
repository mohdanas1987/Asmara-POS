'use strict';
/**
 * demo.js — run with: node demo.js
 *
 * Demonstrates the §1.G Immutable Audit Trail Standard's tamper-evidence
 * property end to end:
 *   1. Records 5 realistic Asmara POS audit events.
 *   2. Verifies the chain — expected result: valid.
 *   3. Simulates a tamper (directly edits one historical event in the log
 *      file, the way a compromised app or a rogue DB write might).
 *   4. Re-verifies the chain — expected result: invalid, with the exact
 *      broken position reported.
 *
 * This does not touch the live Asmara POS or its database in any way —
 * it only writes to ./demo-audit-log.jsonl in this folder, which is
 * deleted and recreated fresh on every run.
 */

const fs = require('fs');
const path = require('path');
const { AuditLogger } = require('./audit-logger');

const LOG_PATH = path.join(__dirname, 'demo-audit-log.jsonl');

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

// Start from a clean file each run.
if (fs.existsSync(LOG_PATH)) fs.unlinkSync(LOG_PATH);

const logger = new AuditLogger(LOG_PATH);

section('STEP 1 — Recording 5 audit events');

const correlationId = 'req-' + Date.now();

logger.record({
  actor: 'user:12',
  tenant: 'asmara',
  location: 'eindhoven-main',
  terminal: 'pos-01',
  action: 'auth.login',
  entity: 'user:12',
  before: null,
  after: { status: 'logged_in' },
  correlationId,
});

logger.record({
  actor: 'user:12',
  tenant: 'asmara',
  location: 'eindhoven-main',
  terminal: 'pos-01',
  action: 'register.open',
  entity: 'register:1',
  before: { status: 'closed' },
  after: { status: 'open', openingCash: 150.0 },
  correlationId,
});

logger.record({
  actor: 'user:12',
  tenant: 'asmara',
  location: 'eindhoven-main',
  terminal: 'pos-01',
  action: 'order.create',
  entity: 'order:1042',
  before: null,
  after: { table: 5, status: 'open' },
  correlationId,
});

logger.record({
  actor: 'user:12',
  tenant: 'asmara',
  location: 'eindhoven-main',
  terminal: 'pos-01',
  action: 'table.transfer',
  entity: 'order:1042',
  before: { table: 5 },
  after: { table: 8 },
  correlationId,
});

logger.record({
  actor: 'user:12',
  tenant: 'asmara',
  location: 'eindhoven-main',
  terminal: 'pos-01',
  action: 'payment.capture',
  entity: 'order:1042',
  before: { status: 'payment_pending' },
  after: { status: 'paid', amount: 64.5, method: 'card' },
  correlationId,
});

console.log(`Recorded 5 events to ${LOG_PATH}`);

section('STEP 2 — Verifying the chain (expect: VALID)');
let result = logger.verifyChain();
console.log(result);
if (!result.valid) {
  console.error('UNEXPECTED: chain should be valid at this point. Something is wrong with the logger itself.');
  process.exit(1);
}

section('STEP 3 — Simulating tampering (directly editing event #3 in the raw file)');
const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
const tamperedIndex = 2; // the order.create event
const tampered = JSON.parse(lines[tamperedIndex]);
console.log('Original event:', tampered.action, tampered.entity, tampered.after);
tampered.after = { table: 5, status: 'open', amount: 999999 }; // an attacker inflating a total, e.g.
lines[tamperedIndex] = JSON.stringify(tampered);
fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n');
console.log('Event #3 was rewritten in place (hash field left untouched, as a naive tamper attempt would).');

section('STEP 4 — Re-verifying the chain (expect: INVALID, broken at position 2)');
result = logger.verifyChain();
console.log(result);

if (result.valid) {
  console.error('FAILURE: tampering was NOT detected. This would be a bug in audit-logger.js.');
  process.exit(1);
} else {
  console.log(`\nSUCCESS: tampering was detected at event index ${result.brokenAt} — reason: "${result.reason}".`);
  console.log('This is the property §1.G requires: an altered historical event is provably detectable,');
  console.log('even though this demo used only a flat file with no database-level protection at all.');
  console.log('The production version adds a second layer on top of this (INSERT-only DB grant — see AUDIT-EVENT-SCHEMA.md)');
  console.log('so that, unlike this demo, the tampering shown above could not even be performed through the app\'s own DB connection.');
}
