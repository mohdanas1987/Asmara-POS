'use strict';
/**
 * Staff quick-login: PIN + QR badge (CTO forensic audit 2026-09-20: "QR staff login" flagged
 * as never built -- correctly, it never was). A shared POS terminal needs a fast way for
 * staff to identify themselves without a full email/password login every time a shift
 * changes hands -- that's what these two columns support. Both are OPTIONAL per user
 * (nullable, no default) so every existing account keeps working exactly as it does today
 * (Preservation Contract) until a manager deliberately sets a PIN or issues a badge for
 * someone via Settings > Staff.
 *
 *   - pin_hash: bcrypt hash of a short numeric PIN (never the raw PIN, same as `password`).
 *   - qr_token: an opaque random token printed as a QR code on a staff badge. Not treated as
 *     secret as `password` (it's a convenience credential, revocable by regenerating it, the
 *     same trust level as the website integration's api_key elsewhere in this app), so it is
 *     looked up directly rather than hashed -- generating a NEW token invalidates the old
 *     badge immediately.
 */
exports.up = async function up(knex) {
  const hasPinHash = await knex.schema.hasColumn('users', 'pin_hash');
  if (!hasPinHash) {
    await knex.schema.alterTable('users', (table) => {
      table.string('pin_hash').nullable();
    });
  }
  const hasQrToken = await knex.schema.hasColumn('users', 'qr_token');
  if (!hasQrToken) {
    await knex.schema.alterTable('users', (table) => {
      table.string('qr_token').nullable();
      table.index('qr_token');
    });
  }
};

exports.down = async function down(knex) {
  const hasPinHash = await knex.schema.hasColumn('users', 'pin_hash');
  if (hasPinHash) {
    await knex.schema.alterTable('users', (table) => table.dropColumn('pin_hash'));
  }
  const hasQrToken = await knex.schema.hasColumn('users', 'qr_token');
  if (hasQrToken) {
    await knex.schema.alterTable('users', (table) => table.dropColumn('qr_token'));
  }
};
