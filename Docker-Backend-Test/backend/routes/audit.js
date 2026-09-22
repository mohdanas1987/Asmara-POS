'use strict';
/**
 * Audit event log admin view (CTO forensic audit 2026-09-21, P1 "Complete audit-event
 * coverage"). See migrations_local/0020_audit_events.js and services/auditLog.js for what
 * gets recorded and why. Read-only by design -- an audit log a user could edit or delete
 * from the app isn't an audit log.
 */
const express = require('express');
const router = express.Router();
const fetchuser = require('../middlewares/loggedIn');
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const auditLog = require('../services/auditLog');

router.get('/', fetchuser, requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res) => {
    try {
        const events = await auditLog.list({
            tenantId: req.body.tenant_id,
            eventType: req.query.event_type,
            limit: req.query.limit,
        });
        return res.json({ status: true, events });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

module.exports = router;
