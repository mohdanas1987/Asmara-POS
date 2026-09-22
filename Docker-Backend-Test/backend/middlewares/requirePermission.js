'use strict';
/**
 * RBAC enforcement middleware (project audit 2026-09-15, task "RBAC: real permission model").
 *
 * Use AFTER `fetchuser` (middlewares/loggedIn.js), which is what populates req.authRole
 * (from the verified JWT) and req.body.tenant_id (also from the verified JWT). This never
 * trusts a client-supplied role -- req.authRole is set only from the signed token and is
 * never read from (or overwritten by) req.body, so a request body field named `role` (e.g.
 * POST /users' "which role to assign") can never be confused with, or escalate, the
 * caller's own permissions.
 *
 * CTO forensic audit 2026-09-20 (task "role_permissions"): now async -- checks the
 * per-tenant role_permissions override table before falling back to the original hardcoded
 * default, via config/permissions.js's roleHasPermissionForTenant(). A tenant that has never
 * touched Settings > Roles & Permissions sees IDENTICAL behavior to before this change
 * (Preservation Contract).
 *
 * Usage: router.post('/staff', fetchuser, requirePermission(PERMISSIONS.STAFF_MANAGE), handler)
 */
const { roleHasPermissionForTenant } = require('../config/permissions');

function requirePermission(permission) {
  const middleware = async (req, res, next) => {
    const role = req.authRole;
    try {
      const allowed = await roleHasPermissionForTenant(req.body.tenant_id, role, permission);
      if (!allowed) {
        return res.status(403).json({
          status: false,
          error: `Forbidden: role '${role || 'unknown'}' lacks permission '${permission}'.`,
        });
      }
      next();
    } catch (e) {
      return res.status(500).json({ status: false, message: e.message });
    }
  };
  // RBAC audit tooling (CTO forensic audit 2026-09-21, "Full RBAC enforcement audit"): tag the
  // returned closure with the permission it enforces so test/rbac-audit.test.js can walk every
  // registered route's real middleware stack at runtime and know, without guessing from
  // function names, exactly which routes are (and are not) permission-gated and with what.
  middleware.__requiresPermission = permission;
  return middleware;
}

module.exports = requirePermission;
