'use strict';
/**
 * Staff management (project audit 2026-09-15, task "RBAC: real permission model").
 *
 * Before this route existed, there was no way to create a staff account with a role other
 * than the single 'admin' user created at tenant signup -- every real Manager/Cashier/
 * Waiter/Kitchen account the plan calls for had no provisioning path at all. This is that
 * path, gated by the new RBAC permission model (config/permissions.js) rather than a
 * hardcoded role check, and tenant-scoped like every other route in this backend (a
 * manager can never list or create staff for a different restaurant).
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const fetchuser = require('../middlewares/loggedIn');
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS, KNOWN_ROLES } = require('../config/permissions');
const User = require('../models/User');

// List staff for the current tenant. Passwords are never returned.
router.get('/', fetchuser, requirePermission(PERMISSIONS.STAFF_VIEW), async (req, res) => {
    try {
        const staff = await User.forTenant(req.body.tenant_id)
            .select('id', 'name', 'email', 'role', 'type', 'status', 'created_at', 'pin_hash', 'qr_token');
        // Quick-login staff badges (CTO forensic audit 2026-09-20): never return the raw
        // hash or token in a list response -- only whether each is set, same trust level as
        // never echoing back a password hash anywhere else in this app.
        const safeStaff = staff.map(({ pin_hash, qr_token, ...rest }) => ({
            ...rest,
            has_pin: Boolean(pin_hash),
            has_qr_badge: Boolean(qr_token),
        }));
        return res.json({ status: true, staff: safeStaff });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Create a new staff account for the current tenant with an explicit role.
router.post('/', fetchuser, requirePermission(PERMISSIONS.STAFF_MANAGE), [
    body('name').isLength({ min: 2 }),
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    body('role').isIn(KNOWN_ROLES),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ status: false, message: errors.array()[0].msg, errors: errors.array() });
        }

        const existing = await User.forTenant(req.body.tenant_id)
            .where('email', req.body.email.toLowerCase())
            .first();
        if (existing) {
            return res.status(400).json({ status: false, key: 'email', message: 'A user with that email already exists in this restaurant.' });
        }

        const salt = await bcrypt.genSalt(8);
        const hashedPassword = await bcrypt.hash(req.body.password, salt);

        const newUser = await User.query().insert({
            name: req.body.name.trim(),
            email: req.body.email.toLowerCase().trim(),
            password: hashedPassword,
            role: req.body.role,
            type: req.body.role, // kept in sync for anything still reading the legacy column
            tenant_id: req.body.tenant_id,
            status: true,
        });

        return res.json({
            status: true,
            message: 'Staff account created.',
            user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
        });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Change an existing staff member's role or active status. Cannot touch another tenant's user.
router.patch('/:id', fetchuser, requirePermission(PERMISSIONS.STAFF_MANAGE), [
    body('role').optional().isIn(KNOWN_ROLES),
    body('status').optional().isBoolean(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ status: false, message: errors.array()[0].msg, errors: errors.array() });
        }

        const target = await User.forTenant(req.body.tenant_id)
            .where('id', req.params.id)
            .first();
        if (!target) {
            return res.status(404).json({ status: false, message: 'Staff member not found.' });
        }

        const updates = {};
        if (req.body.role !== undefined) {
            updates.role = req.body.role;
            updates.type = req.body.role;
        }
        if (req.body.status !== undefined) updates.status = req.body.status;

        await User.query().where('id', target.id).update(updates);
        return res.json({ status: true, message: 'Staff account updated.' });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// --- Staff quick-login: PIN + QR badge (CTO forensic audit 2026-09-20, task "QR staff
// login" -- flagged as never built, correctly) ------------------------------------------

// Sets (or changes) a staff member's PIN for the shared-terminal quick-switch flow (see
// routes/auth.js's /pin-login). A staff member can set their OWN PIN; setting someone
// ELSE's PIN requires STAFF_MANAGE, same as any other staff-account change.
router.post('/:id/pin', fetchuser, [
    body('pin').isLength({ min: 4, max: 8 }).isNumeric(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ status: false, message: errors.array()[0].msg });
        }
        const isSelf = String(req.body.myID ?? req.body.id) === String(req.params.id);
        if (!isSelf) {
            const { roleHasPermissionForTenant } = require('../config/permissions');
            const allowed = await roleHasPermissionForTenant(req.body.tenant_id, req.authRole, PERMISSIONS.STAFF_MANAGE);
            if (!allowed) {
                return res.status(403).json({ status: false, error: "Forbidden: cannot set another staff member's PIN." });
            }
        }
        const target = await User.forTenant(req.body.tenant_id).where('id', req.params.id).first();
        if (!target) return res.status(404).json({ status: false, message: 'Staff member not found.' });

        const salt = await bcrypt.genSalt(8);
        const pinHash = await bcrypt.hash(req.body.pin, salt);
        await User.query().where('id', target.id).update({ pin_hash: pinHash });
        return res.json({ status: true, message: 'PIN set.' });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Issues (or reissues) a QR badge token for a staff member. Requires STAFF_MANAGE -- a
// manager prints the badge, not the staff member themselves. The raw token is returned ONLY
// in this response (to render/print the QR code immediately), same pattern as any other
// "shown once at creation" credential in this app (e.g. the website integration's api_key).
router.post('/:id/qr-badge', fetchuser, requirePermission(PERMISSIONS.STAFF_MANAGE), async (req, res) => {
    try {
        const target = await User.forTenant(req.body.tenant_id).where('id', req.params.id).first();
        if (!target) return res.status(404).json({ status: false, message: 'Staff member not found.' });

        const token = crypto.randomBytes(16).toString('hex');
        await User.query().where('id', target.id).update({ qr_token: token });
        return res.json({ status: true, message: 'QR badge issued.', qr_token: token });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Revokes a QR badge (lost badge, staff departure) without touching anything else about
// the account.
router.delete('/:id/qr-badge', fetchuser, requirePermission(PERMISSIONS.STAFF_MANAGE), async (req, res) => {
    try {
        const target = await User.forTenant(req.body.tenant_id).where('id', req.params.id).first();
        if (!target) return res.status(404).json({ status: false, message: 'Staff member not found.' });
        await User.query().where('id', target.id).update({ qr_token: null });
        return res.json({ status: true, message: 'QR badge revoked.' });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

module.exports = router;
