'use strict';
/**
 * Terminal identity (project audit 2026-09-15, task "Offline-first foundation").
 *
 * Each physical POS terminal (a machine running RestaurantOS-Desktop) needs a stable
 * identity that survives app restarts, so sync_log rows and outbox deliveries can always be
 * attributed to the terminal that made them. A fresh UUID is generated once and written to
 * a small local file NEXT TO the terminal's own sqlite database (not inside it -- this must
 * survive even a database reset/re-migration), then reused on every subsequent boot.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getIdentityFilePath(dbFilePath) {
  const dir = dbFilePath ? path.dirname(dbFilePath) : __dirname;
  return path.join(dir, '.terminal-identity.json');
}

/**
 * Returns this machine's stable terminal id (a UUID), creating and persisting one on first
 * call. `dbFilePath` should be the same sqlite file path the app's knex connection uses, so
 * the identity file lives alongside the actual data it identifies.
 */
function getOrCreateTerminalId(dbFilePath) {
  const identityFile = getIdentityFilePath(dbFilePath);
  try {
    if (fs.existsSync(identityFile)) {
      const data = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
      if (data && data.terminalId) return data.terminalId;
    }
  } catch (err) {
    // Corrupt or unreadable identity file -- fall through and mint a new one rather than
    // crashing the whole app over a broken local file the user can just delete.
    console.log('[terminal-identity] could not read existing identity file, creating a new one:', err.message);
  }

  const terminalId = crypto.randomUUID();
  try {
    fs.writeFileSync(identityFile, JSON.stringify({ terminalId, createdAt: new Date().toISOString() }, null, 2));
  } catch (err) {
    // Best-effort persistence: if the directory isn't writable for some reason, the terminal
    // still works for this process's lifetime, it just won't remember its id across restarts.
    console.log('[terminal-identity] could not persist identity file (will regenerate next boot):', err.message);
  }
  return terminalId;
}

module.exports = { getOrCreateTerminalId, getIdentityFilePath };
