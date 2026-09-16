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

/** True if `role` grants `permission` (admin's '*' grants everything). */
function roleHasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[String(role || '').toLowerCase()];
  if (!perms) return false;
  return perms.includes('*') || perms.includes(permission);
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, KNOWN_ROLES, roleHasPermission };
