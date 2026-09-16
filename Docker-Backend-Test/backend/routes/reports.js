'use strict';
/**
 * Sales & table-performance reporting (task #38). Kept as its own route file/prefix
 * (`/reports`) rather than added to routes/orders.js's existing `/orders/reports` (report
 * PDF history) and `/orders/x-report` / `/orders/z-report` (register-session snapshots) --
 * those are a different, already-established concept (one cash-register session) and this
 * is a date-range business dashboard that doesn't touch cash registers at all. Both new
 * endpoints are read-only: unlike a Z-report they never delete or mutate anything, so
 * REPORTS_VIEW (view-only) is the right gate rather than something closer to
 * SETTINGS_MANAGE/PAYMENTS_REFUND.
 */
const express = require('express');
const router = express.Router();
const fetchuser = require('../middlewares/loggedIn');
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const { generateSalesReport } = require('../services/reports/salesReport');
const { generateTablePerformanceReport } = require('../services/reports/tablePerformanceReport');

function parseRange(req) {
    const { from, to } = req.query;
    return {
        from: typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined,
        to: typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : undefined,
    };
}

router.get('/sales', fetchuser, requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res) => {
    try {
        const report = await generateSalesReport(req.body.tenant_id, parseRange(req));
        return res.json({ status: true, ...report });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message });
    }
});

router.get('/table-performance', fetchuser, requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res) => {
    try {
        const report = await generateTablePerformanceReport(req.body.tenant_id, parseRange(req));
        return res.json({ status: true, ...report });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message });
    }
});

module.exports = router;
