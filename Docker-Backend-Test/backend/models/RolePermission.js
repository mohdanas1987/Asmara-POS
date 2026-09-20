'use strict';
const TenantModel = require('./TenantModel');

// role_permissions override table (CTO forensic audit 2026-09-20). See migration
// 0018_role_permissions_table.js and config/permissions.js's roleHasPermissionForTenant()
// for how a row here overrides the hardcoded default for one (role, permission) pair.
class RolePermission extends TenantModel {
  static get tableName() {
    return 'role_permissions';
  }
}

module.exports = RolePermission;
