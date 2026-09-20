'use strict';
/**
 * Roles & Permissions admin UI backing routes (CTO forensic audit 2026-09-20, task
 * "role_permissions" -- flagged as missing, correctly: RBAC was enforced everywhere but
 * nothing let a tenant admin see or change it without editing config/permissions.js and
 * redeploying). See that file's roleHasPermissionForTenant() for how a row written here
 * actually takes effect.
 */
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const fetchuser = require('../middlewares/loggedIn');
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS, ROLE_PERMISSIONS, KNOWN_ROLES, roleHasPermission } = require('../config/permissions');
const RolePermission = require('../models/RolePermission');

const ALL_PERMISSIONS = Object.values(PERMISSIONS);
// admin is intentionally excluded -- its wildcard access is never editable (see
// config/permissions.js's roleHasPermissionForTenant for why).
const EDITABLE_ROLES = KNOWN_ROLES.filter((r) => r !== 'admin');

// The full matrix: every editable role x every permission, with the EFFECTIVE value (an
// explicit override if one exists for this tenant, otherwise the hardcoded default) and
// whether that value is an override or just the default -- the UI needs both to render
// "customized" vs "default" state honestly.
router.get('/permissions', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        const overrides = await RolePermission.forTenant(req.body.tenant_id);
        const overrideMap = new Map(overrides.map((o) => [`${o.role}:${o.permission}`, Boolean(o.enabled)]));

        const matrix = EDITABLE_ROLES.map((role) => ({
            role,
            permissions: ALL_PERMISSIONS.map((permission) => {
                const key = `${role}:${permission}`;
                const hasOverride = overrideMap.has(key);
                return {
                    permission,
                    enabled: hasOverride ? overrideMap.get(key) : roleHasPermission(role, permission),
                    isOverride: hasOverride,
                    default: roleHasPermission(role, permission),
                };
            }),
        }));

        return res.json({ status: true, matrix, allPermissions: ALL_PERMISSIONS, roles: EDITABLE_ROLES });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Sets (or clears, if `enabled` matches the hardcoded default) one explicit override.
router.patch('/permissions', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), [
    body('role').isIn(EDITABLE_ROLES),
    body('permission').isIn(ALL_PERMISSIONS),
    body('enabled').isBoolean(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ status: false, message: errors.array()[0].msg });
        }
        const { role, permission, enabled } = req.body;
        const tenantId = req.body.tenant_id;

        const existing = await RolePermission.forTenant(tenantId).where({ role, permission }).first();
        if (existing) {
            await RolePermission.query().where('id', existing.id).patch({ enabled });
        } else {
            await RolePermission.query().insert({ tenant_id: tenantId, role, permission, enabled });
        }

        return res.json({ status: true, message: `${role} ${enabled ? 'granted' : 'denied'} '${permission}'.` });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Removes an override, reverting that (role, permission) pair back to the hardcoded default.
router.delete('/permissions', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), [
    body('role').isIn(EDITABLE_ROLES),
    body('permission').isIn(ALL_PERMISSIONS),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ status: false, message: errors.array()[0].msg });
        }
        await RolePermission.forTenant(req.body.tenant_id)
            .where({ role: req.body.role, permission: req.body.permission })
            .delete();
        return res.json({ status: true, message: 'Reverted to default.' });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

module.exports = router;
