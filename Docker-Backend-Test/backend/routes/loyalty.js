'use strict';
/**
 * Loyalty API (project audit 2026-09-15, task "Loyalty subsystem (ledger-based)"). Thin
 * HTTP layer over services/loyaltyService.js -- all the actual balance/earn/redeem logic
 * lives there so it stays testable independent of Express.
 */
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const fetchuser = require('../middlewares/loggedIn');
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const Customer = require('../models/Customer');
const LoyaltyConfig = require('../models/LoyaltyConfig');
const loyalty = require('../services/loyaltyService');

// --- Config (tenant-wide earn/redeem rates) --------------------------------

router.get('/config', fetchuser, async (req, res) => {
    try {
        const config = await loyalty.getConfig(req.body.tenant_id);
        return res.json({ status: true, config });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

router.patch('/config', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), [
    body('cents_per_point').optional().isInt({ min: 1 }),
    body('redeem_value_cents').optional().isInt({ min: 0 }),
    body('min_redeem_points').optional().isInt({ min: 0 }),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        const config = await loyalty.getConfig(req.body.tenant_id);
        const updates = {};
        for (const key of ['cents_per_point', 'redeem_value_cents', 'min_redeem_points']) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        await LoyaltyConfig.query().where('id', config.id).update(updates);
        return res.json({ status: true, message: 'Loyalty settings updated.' });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// --- Customer lookup (barcode/QR scan-to-lookup, printable card data) ------

router.get('/lookup/:code', fetchuser, async (req, res) => {
    try {
        const customer = await Customer.forTenant(req.body.tenant_id).where('customer_code', req.params.code).first();
        if (!customer) return res.status(404).json({ status: false, message: 'No customer found for this code.' });

        const balance = await loyalty.getBalance(req.body.tenant_id, customer.id);
        return res.json({ status: true, customer, balance });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

router.get('/customers/:id', fetchuser, async (req, res) => {
    try {
        const customer = await Customer.forTenant(req.body.tenant_id).where('id', req.params.id).first();
        if (!customer) return res.status(404).json({ status: false, message: 'Customer not found.' });

        const [balance, ledger] = await Promise.all([
            loyalty.getBalance(req.body.tenant_id, customer.id),
            loyalty.getLedger(req.body.tenant_id, customer.id),
        ]);
        return res.json({ status: true, customer, balance, ledger });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// --- Redeem / manual adjustment --------------------------------------------

router.post('/redeem', fetchuser, requirePermission(PERMISSIONS.LOYALTY_REDEEM), [
    body('customer_id').isInt(),
    body('points').isInt({ min: 1 }),
    body('order_id').optional({ nullable: true }).isString(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        const customer = await Customer.forTenant(req.body.tenant_id).where('id', req.body.customer_id).first();
        if (!customer) return res.status(404).json({ status: false, message: 'Customer not found.' });

        const { euroValue } = await loyalty.redeem({
            tenantId: req.body.tenant_id,
            customerId: req.body.customer_id,
            points: req.body.points,
            orderId: req.body.order_id ?? null,
            createdBy: req.body.myID,
        });
        return res.json({ status: true, message: `Redeemed ${req.body.points} points.`, euro_value: euroValue });
    } catch (e) {
        // Insufficient balance / below minimum are expected user-facing errors, not server faults.
        return res.status(400).json({ status: false, message: e.message });
    }
});

router.post('/adjust', fetchuser, requirePermission(PERMISSIONS.LOYALTY_ADJUST), [
    body('customer_id').isInt(),
    body('points').isInt(),
    body('reason').isLength({ min: 1 }),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        const customer = await Customer.forTenant(req.body.tenant_id).where('id', req.body.customer_id).first();
        if (!customer) return res.status(404).json({ status: false, message: 'Customer not found.' });

        await loyalty.adjust({
            tenantId: req.body.tenant_id,
            customerId: req.body.customer_id,
            points: req.body.points,
            reason: req.body.reason,
            createdBy: req.body.myID,
        });
        return res.json({ status: true, message: 'Adjustment recorded.' });
    } catch (e) {
        return res.status(400).json({ status: false, message: e.message });
    }
});

module.exports = router;
