'use strict';
/**
 * Menu modifiers & spice levels (task #40) -- see migrations_local/0015_menu_modifiers.js for
 * the schema rationale. This is menu CONFIGURATION only: defining what modifier groups and
 * options exist on a menu item. Selecting a modifier while taking an order is a separate,
 * not-yet-built follow-up (see that migration's comment for why it's deliberately not bundled
 * here) -- nothing in this file touches orders, the cart, or kitchen tickets.
 */
const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const fetchuser = require('../middlewares/loggedIn');
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const Item = require('../models/Item');
const ModifierGroup = require('../models/ModifierGroup');
const Modifier = require('../models/Modifier');

let error = { status: false, message: 'Something went wrong!' };

async function assertOwnsItem(tenantId, menuItemId) {
    const item = await Item.forTenant(tenantId).findById(menuItemId);
    if (!item) {
        const err = new Error('Menu item not found.');
        err.statusCode = 404;
        throw err;
    }
    return item;
}

async function assertOwnsGroup(tenantId, groupId) {
    const group = await ModifierGroup.forTenant(tenantId).findById(groupId);
    if (!group) {
        const err = new Error('Modifier group not found.');
        err.statusCode = 404;
        throw err;
    }
    return group;
}

// GET /modifiers/item/:menu_item_id -- every group + its modifiers for one item, ordered for
// display. Not permission-gated beyond login: any authenticated role that can see the menu at
// all (which is everyone at a POS) needs to be able to read this once selection is wired in.
router.get('/item/:menu_item_id', fetchuser, async (req, res) => {
    try {
        const groups = await ModifierGroup.forTenant(req.body.tenant_id)
            .where('menu_item_id', req.params.menu_item_id)
            .withGraphFetched('modifiers')
            .modifyGraph('modifiers', (builder) => builder.orderBy('sort_order'))
            .orderBy('sort_order');
        return res.json({ status: true, groups });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// --- Modifier groups ---------------------------------------------------------------------

router.post('/groups', fetchuser, requirePermission(PERMISSIONS.MENU_MANAGE), [
    body('menu_item_id').isInt(),
    body('name').isLength({ min: 1 }),
    body('selection_type').optional().isIn(['single', 'multiple']),
    body('required').optional().isBoolean(),
    body('min_select').optional().isInt({ min: 0 }),
    body('max_select').optional({ nullable: true }).isInt({ min: 0 }),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        await assertOwnsItem(req.body.tenant_id, req.body.menu_item_id);

        const group = await ModifierGroup.query().insertAndFetch({
            tenant_id: req.body.tenant_id,
            menu_item_id: req.body.menu_item_id,
            name: req.body.name,
            selection_type: req.body.selection_type ?? 'single',
            required: !!req.body.required,
            min_select: req.body.min_select ?? 0,
            max_select: req.body.max_select ?? null,
        });
        return res.json({ status: true, message: 'Modifier group created.', group });
    } catch (e) {
        return res.status(e.statusCode || 500).json({ status: false, message: e.message });
    }
});

router.patch('/groups/:id', fetchuser, requirePermission(PERMISSIONS.MENU_MANAGE), [
    param('id').isInt(),
    body('name').optional().isLength({ min: 1 }),
    body('selection_type').optional().isIn(['single', 'multiple']),
    body('required').optional().isBoolean(),
    body('min_select').optional().isInt({ min: 0 }),
    body('max_select').optional({ nullable: true }).isInt({ min: 0 }),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        await assertOwnsGroup(req.body.tenant_id, req.params.id);

        const updates = {};
        for (const key of ['name', 'selection_type', 'required', 'min_select', 'max_select']) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        const group = await ModifierGroup.query().patchAndFetchById(req.params.id, updates);
        return res.json({ status: true, message: 'Modifier group updated.', group });
    } catch (e) {
        return res.status(e.statusCode || 500).json({ status: false, message: e.message });
    }
});

router.delete('/groups/:id', fetchuser, requirePermission(PERMISSIONS.MENU_MANAGE), async (req, res) => {
    try {
        await assertOwnsGroup(req.body.tenant_id, req.params.id);
        await ModifierGroup.query().deleteById(req.params.id); // cascades to its modifiers
        return res.json({ status: true, message: 'Modifier group deleted.' });
    } catch (e) {
        return res.status(e.statusCode || 500).json({ status: false, message: e.message });
    }
});

// --- Individual modifiers ----------------------------------------------------------------

router.post('/groups/:group_id/modifiers', fetchuser, requirePermission(PERMISSIONS.MENU_MANAGE), [
    param('group_id').isInt(),
    body('name').isLength({ min: 1 }),
    body('price_delta').optional().isFloat(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        await assertOwnsGroup(req.body.tenant_id, req.params.group_id);

        const modifier = await Modifier.query().insertAndFetch({
            tenant_id: req.body.tenant_id,
            modifier_group_id: req.params.group_id,
            name: req.body.name,
            price_delta: req.body.price_delta ?? 0,
        });
        return res.json({ status: true, message: 'Modifier added.', modifier });
    } catch (e) {
        return res.status(e.statusCode || 500).json({ status: false, message: e.message });
    }
});

router.patch('/modifiers/:id', fetchuser, requirePermission(PERMISSIONS.MENU_MANAGE), [
    param('id').isInt(),
    body('name').optional().isLength({ min: 1 }),
    body('price_delta').optional().isFloat(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ status: false, message: errors.array()[0].msg });

        const modifier = await Modifier.forTenant(req.body.tenant_id).findById(req.params.id);
        if (!modifier) return res.status(404).json({ status: false, message: 'Modifier not found.' });

        const updates = {};
        if (req.body.name !== undefined) updates.name = req.body.name;
        if (req.body.price_delta !== undefined) updates.price_delta = req.body.price_delta;
        const updated = await Modifier.query().patchAndFetchById(req.params.id, updates);
        return res.json({ status: true, message: 'Modifier updated.', modifier: updated });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

router.delete('/modifiers/:id', fetchuser, requirePermission(PERMISSIONS.MENU_MANAGE), async (req, res) => {
    try {
        const modifier = await Modifier.forTenant(req.body.tenant_id).findById(req.params.id);
        if (!modifier) return res.status(404).json({ status: false, message: 'Modifier not found.' });

        await Modifier.query().deleteById(req.params.id);
        return res.json({ status: true, message: 'Modifier deleted.' });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

module.exports = router;
