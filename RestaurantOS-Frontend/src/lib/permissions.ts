/**
 * Frontend mirror of the backend's config/permissions.js, used ONLY to decide which nav
 * items to show for the current role (see auth.ts's caveat -- this is a UX convenience, the
 * backend's requirePermission middleware is the actual enforcement). Keep this in sync with
 * backend/config/permissions.js by hand; it's small and changes rarely enough that a shared
 * package isn't worth the build complexity yet.
 */

export const PERMISSIONS = {
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
} as const;

const ROLE_PERMISSIONS: Record<string, string[] | ['*']> = {
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
  cashier: [PERMISSIONS.TABLES_MANAGE, PERMISSIONS.TABLES_TRANSFER, PERMISSIONS.ORDERS_CREATE, PERMISSIONS.LOYALTY_REDEEM],
  waiter: [PERMISSIONS.TABLES_MANAGE, PERMISSIONS.TABLES_TRANSFER, PERMISSIONS.ORDERS_CREATE],
  kitchen: [PERMISSIONS.KITCHEN_VIEW],
};

/** True if `role` grants `permission` (admin's wildcard grants everything), matching the backend exactly. */
export function roleHasPermission(role: string | null, permission: string): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role.toLowerCase()];
  if (!perms) return false;
  return (perms as string[]).includes('*') || (perms as string[]).includes(permission);
}
