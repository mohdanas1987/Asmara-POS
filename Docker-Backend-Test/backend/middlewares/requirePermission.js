'use strict';
/**
 * RBAC enforcement middleware (project audit 2026-09-15, task "RBAC: real permission model").
 *
 * Use AFTER `fetchuser` (middlewares/loggedIn.js), which is what populates req.authRole
 * from the verified JWT. This never trusts a client-supplied role -- req.authRole is set
 * only from the signed token and is never read from (or overwritten by) req.body, so a
 * request body field named `role` (e.g. POST /users' "which role to assign") can never be
 * confused with, or escalate, the caller's own permissions.
 *
 * Usage: router.post('/staff', fetchuser, requirePermission(PERMISSIONS.STAFF_MANAGE), handler)
 */
const { roleHasPermission } = require('../config/permissions');

function requirePermission(permission) {
  return (req, res, next) => {
    const role = req.authRole;
    if (!roleHasPermission(role, permission)) {
      return res.status(403).json({
        status: false,
        error: `Forbidden: role '${role || 'unknown'}' lacks permission '${permission}'.`,
      });
    }
    next();
  };
}

module.exports = requirePermission;
