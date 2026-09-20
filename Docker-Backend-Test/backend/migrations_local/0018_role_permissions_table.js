'use strict';
/**
 * role_permissions as a real, queryable/editable table (CTO forensic audit 2026-09-20:
 * correctly flagged -- RBAC was enforced everywhere but the role -> permission map lived
 * only as a hardcoded object in config/permissions.js, with no way for a tenant admin to
 * see or change it without a code deploy).
 *
 * Deliberately an OVERRIDE table, not a full mirror of the hardcoded map: it starts (and
 * usually stays) empty. config/permissions.js's roleHasPermissionForTenant() checks this
 * table first for an explicit (tenant_id, role, permission) row; if none exists, it falls
 * back to the original hardcoded ROLE_PERMISSIONS map exactly as before (Preservation
 * Contract -- an empty table changes NOTHING about how any existing tenant behaves). A row
 * only appears here once a tenant admin explicitly flips a permission in Settings > Roles &
 * Permissions, and only for that one (role, permission) pair -- everything else a role can
 * do keeps coming from the hardcoded default. This also sidesteps needing to seed anything
 * at migration time (which would need a tenant to already exist, and this migration runs
 * before any tenant does on a fresh database).
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('role_permissions');
  if (!hasTable) {
    await knex.schema.createTable('role_permissions', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').notNullable();
      table.string('role').notNullable();
      table.string('permission').notNullable();
      table.boolean('enabled').notNullable().defaultTo(true);
      table.unique(['tenant_id', 'role', 'permission']);
    });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('role_permissions');
  if (hasTable) {
    await knex.schema.dropTable('role_permissions');
  }
};
