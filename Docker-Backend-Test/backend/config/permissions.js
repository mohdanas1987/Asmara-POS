'use strict';
/**
 * RBAC permission model (project audit 2026-09-15, task "RBAC: real permission model").
 *
 * Replaces "if (user.type === 'admin')" checks scattered through route handlers with a
 * single, explicit map of role -> permissions. Adding a new role or changing what an
 * existing role can do means editing this file only, not hunting through every route.
 *
 * Roles mirror the plan's Admin / Manager / Cashier / Waiter / Kitchen model. 'admin' has
 * the wildcard '*' (everything) so new permissions added later are safe-by-default for
 * admins without needing this file updated every time a permission is added elsewhere.
 */

const PERMISSIONS = Object.freeze({
  STAFF_VIEW: 'staff.view',
  STAFF_MANAGE: 'staff.manage',
  MENU_MANAGE: 'menu.manage',
  TABLES_MANAGE: 'tables.manage',
  TABLES_TRANSFER: 'tables.transfer',
  ORDERS_CREATE: 'orders.create',
  ORDERS_VOID: 'orders.void',
  PAYMENTS_REFUND: 'payments.refund',
  KITCHEN_VIEW: 'kitchen.view',
  REPORTS_VIEW: 'reports.view',
  SETTINGS_MANAGE: 'settings.manage',
  BILLING_MANAGE: 'billing.manage',
  LOYALTY_REDEEM: 'loyalty.redeem',
  LOYALTY_ADJUST: 'loyalty.adjust',
});

const ROLE_PERMISSIONS = Object.freeze({
  admin: ['*'],
  manager: [
    PERMISSIONS.STAFF_VIEW,
    PERMISSIONS.MENU_MANAGE,
    PERMISSIONS.TABLES_MANAGE,
    PERMISSIONS.TABLES_TRANSFER,
    PERMISSIONS.ORDERS_CREATE,
    PERMISSIONS.ORDERS_VOID,
    PERMISSIONS.PAYMENTS_REFUND,
    PERMISSIONS.KITCHEN_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.LOYALTY_REDEEM,
    PERMISSIONS.LOYALTY_ADJUST,
  ],
  cashier: [
    PERMISSIONS.TABLES_MANAGE,
    PERMISSIONS.TABLES_TRANSFER,
    PERMISSIONS.ORDERS_CREATE,
    PERMISSIONS.LOYALTY_REDEEM,
  ],
  waiter: [
    PERMISSIONS.TABLES_MANAGE,
    PERMISSIONS.TABLES_TRANSFER,
    PERMISSIONS.ORDERS_CREATE,
  ],
  kitchen: [
    PERMISSIONS.KITCHEN_VIEW,
  ],
});

const KNOWN_ROLES = Object.freeze(Object.keys(ROLE_PERMISSIONS));

/** True if `role` grants `permission` (admin's '*' grants everything). Pure, hardcoded-map
 * lookup -- no DB, no tenant. This is the ORIGINAL function, deliberately left unchanged
 * (existing callers and existing tests depend on this exact two-argument, synchronous
 * signature). It's now also the fallback `roleHasPermissionForTenant` uses when a tenant has
 * no override row for a given (role, permission) pair -- which is every tenant, always,
 * unless someone has explicitly customized something in Settings > Roles & Permissions. */
function roleHasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[String(role || '').toLowerCase()];
  if (!perms) return false;
  return perms.includes('*') || perms.includes(permission);
}

// role_permissions as a real, editable table (CTO forensic audit 2026-09-20, task
// "role_permissions"). admin's wildcard ('*' in the hardcoded map) is intentionally NOT
// overridable here -- an admin account must always retain full access, or a mistaken/
// malicious override could lock every admin out of their own restaurant with no recovery
// path. Every other role's individual permissions can be toggled per tenant.
let RolePermissionModel = null;
function getRolePermissionModel() {
  // Lazy require to avoid a circular dependency (models/TenantModel.js has no dependency on
  // this file, but requiring Objection models eagerly at module-load time, before the app's
  // knex instance is bound via Model.knex(), can throw in some boot orders).
  if (!RolePermissionModel) RolePermissionModel = require('../models/RolePermission');
  return RolePermissionModel;
}

/**
 * Tenant-aware permission check used by middlewares/requirePermission.js. Checks for an
 * explicit per-tenant override row first; falls back to the hardcoded default (identical to
 * roleHasPermission()) when none exists -- which is the case for every tenant that has never
 * touched Settings > Roles & Permissions (Preservation Contract).
 */
async function roleHasPermissionForTenant(tenantId, role, permission) {
  const normalizedRole = String(role || '').toLowerCase();
  if (normalizedRole === 'admin') return true; // never overridable -- see comment above

  if (tenantId !== undefined && tenantId !== null) {
    try {
      const override = await getRolePermissionModel()
        .query()
        .where({ tenant_id: tenantId, role: normalizedRole, permission })
        .first();
      if (override) return Boolean(override.enabled);
    } catch {
      // DB unavailable / table missing on an older, not-yet-migrated database -- fall back
      // to the hardcoded default rather than failing every permission check tenant-wide.
    }
  }
  return roleHasPermission(normalizedRole, permission);
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, KNOWN_ROLES, roleHasPermission, roleHasPermissionForTenant };
