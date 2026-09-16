'use strict';
/**
 * RBAC foundation (project audit 2026-09-15, task "RBAC: real permission model").
 *
 * Before this migration, `users.type` was a free-text string (default 'cashier') with no
 * defined set of valid values, no permission model behind it, and nothing anywhere in the
 * codebase checked it before allowing an action -- every authenticated user could do
 * everything any other authenticated user could do. This adds a real `role` column (the
 * source of truth going forward) and backfills it from the existing `type` column so no
 * existing account's access changes as a result of running this migration. `type` is left
 * in place, untouched, per the Preservation Contract -- nothing currently reading it breaks.
 */
exports.up = async function up(knex) {
  const hasRole = await knex.schema.hasColumn('users', 'role');
  if (!hasRole) {
    await knex.schema.alterTable('users', (table) => {
      table.string('role').nullable();
    });
  }

  // Backfill: whatever 'type' already held becomes the initial 'role', so behavior is
  // unchanged immediately after migrating. Anything not recognized falls back to 'cashier'
  // (the least-privileged real staff role) rather than silently inheriting admin rights.
  const KNOWN_ROLES = ['admin', 'manager', 'cashier', 'waiter', 'kitchen'];
  const users = await knex('users').select('id', 'type', 'role');
  for (const user of users) {
    if (user.role) continue; // already set, don't clobber
    const normalized = (user.type || '').toLowerCase().trim();
    const role = KNOWN_ROLES.includes(normalized) ? normalized : 'cashier';
    // eslint-disable-next-line no-await-in-loop
    await knex('users').where('id', user.id).update({ role });
  }
};

exports.down = async function down(knex) {
  const hasRole = await knex.schema.hasColumn('users', 'role');
  if (hasRole) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('role');
    });
  }
};
