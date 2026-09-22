const express = require("express");
const path = require('path')
const Setting = require('../models/Setting');
const Notification = require('../models/Notification');
const router = express.Router();
const fetchuser = require('../middlewares/loggedIn');
// RBAC full-enforcement audit (CTO forensic audit 2026-09-21, "Full RBAC enforcement audit"):
// tenant-wide report scheduling was previously gated only by fetchuser (any authenticated
// staff, not just management, could enable/disable or reschedule the whole tenant's daily
// report job). Gated behind SETTINGS_MANAGE, same as every other tenant-wide config route.
const requirePermission = require('../middlewares/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const { uploadFile, getCurrentDate, runScheduledJobs } = require("../utils");
const Queue = require("../models/Queue");
const { REPORT_KEY_NAME } = require("../utils/constants");
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const crypto = require('crypto');

// Branding / customer-display media uploads (POS beautification pass): raw uploads land in
// tmp/uploads-tmp/ via multer, then get processed (resized to webp for images, left as-is
// for video) into tmp/branding/ or tmp/customer-display/ -- both already served statically
// at /images/<path> by server.local.js's existing `app.use('/images', express.static(tmp))`
// mount, the same one item photos use. Raw temp file is deleted after processing either way.
const mediaUpload = multer({ dest: path.join(__dirname, '../tmp/uploads-tmp') });
const BRANDING_DIR = path.join(__dirname, '../tmp/branding');
const CUSTOMER_DISPLAY_DIR = path.join(__dirname, '../tmp/customer-display');
for (const dir of [BRANDING_DIR, CUSTOMER_DISPLAY_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogg']);

let error = { status : false, message:'Something went wrong!' }

router.get('/stock-alert', fetchuser, async(req, res) => {
    try {
        const alert = await Setting.query().where('tenant_id', req.body.tenant_id).where('key', "STOCK_ALERT").where('user_id', req.body.myID ).first();
        if(alert) {
            return res.json({status:true, stock: JSON.parse(alert.value)});
        }
        return res.json({status:false});
    } catch (error) {
        return res.json({status:false, alert:0})
    }
});

router.post('/update-stock-alert', fetchuser, async (req,res) => {
    try {
        const alert = await Setting.query().where('tenant_id', req.body.tenant_id).where('key', "STOCK_ALERT").where('user_id', req.body.myID ).first();
        if(alert) {
            await Setting.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID).where('key', 'STOCK_ALERT').patch({
                value: req.body.stock
            });
            return res.json({status:true, message:"Stock alert updated!"});
        }
        await Setting.query().insert({
            user_id: req.body.myID,
            key: "STOCK_ALERT",
            value: req.body.stock,
            tenant_id: req.body.tenant_id
        });

        return res.json({status:true, message:"Stock alert created!" });

    } catch (e) {
        console.log("exception occured: ",e)
        error.message = e.message
        return res.status(400).json(error)
    }
});

router.get('/clear-notifications', fetchuser, async(req,res) => {
    try {
        await Notification.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID).delete();
        return res.json({status:true})
    } catch (error) {
        console.log(error.message);
        return res.json({status:false})
    }
})

router.get('/notifications', fetchuser, async(req,res)=> {
    try {
        return res.json({status:true, notifications: await Notification.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID)})
    }catch (err) {
        console.log(err.message)
        return res.json({status:false, notifications:[]})
    }
})

// STAGE 2 / phase 18 + 19: was unauthenticated — anyone could delete any user's notification
// by id with a bare GET. DELETE alias added; original GET kept working for the frontend.
async function deleteNotificationHandler(req, res) {
    try {
        await Notification.query().where('id',req.params.id).where('tenant_id', req.body.tenant_id).delete();
        return res.json({status:true})
    } catch (error) {
        return res.json({status:false})
    }
}
router.get('/notification/delete/:id', fetchuser, deleteNotificationHandler);
router.delete('/notification/delete/:id', fetchuser, deleteNotificationHandler);

router.get('/inventory/:state', fetchuser, async(req,res) => {
    try {
        const alert = await Setting.query().where('tenant_id', req.body.tenant_id).where('key', "INVENTORY_IS").where('user_id', req.body.myID ).first();
        if(alert) {
            await Setting.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID).where('key', 'INVENTORY_IS').patch({
                value: req.params.state
            });
            return res.json({status:true});
        }
        await Setting.query().insert({
            user_id: req.body.myID,
            key: "INVENTORY_IS",
            value: req.params.state,
            tenant_id: req.body.tenant_id
        });
        return res.json({status:true})
    } catch (error) {
        console.log(error.message)
        return res.json({status:false})
    }
})

router.get('/settings/:key', fetchuser, async( req, res ) => {
    return res.json({status:true, [req.params.key]: await Setting.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID).where('key',req.params.key).first('value')??''})
});

router.get(`/settings`, fetchuser, async(req, res) => {
    try {
        return res.json({
            status:true,
            settings: await Setting.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID ).select('key', 'value')
        })
    } catch (err) {
        res.json({status:false, settings:[]})
    }
})

router.get(`/upload-db/:client`, fetchuser, async(req, res) => {
    try {

        const filePath = path.join(__dirname, "../database/db.sqlite");
        const uploadURL = 'https://pos.dftech.in/upload-db';
        const uploaded = await uploadFile(filePath, uploadURL, req.params.client);

        if(uploaded) {

            const today = getCurrentDate('ymd');
            const last = await Setting.query().where('tenant_id', req.body.tenant_id).where('key', "LAST_UPDATED").where('user_id', req.body.myID ).first();
            if(last) {
                await Setting.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID).where('key', 'LAST_UPDATED').patch({
                    value: today
                });
                return res.json({
                    status:true,
                    settings: await Setting.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID ).select('key', 'value')
                });
            } else {
                await Setting.query().insert({
                    user_id: req.body.myID,
                    key: "LAST_UPDATED",
                    value: today,
                    tenant_id: req.body.tenant_id
                });
            }
            return res.json({
                status:true,
                settings: await Setting.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID ).select('key', 'value')
            })
        }

        return res.json({
            status:false,
            message: "Failed to upload backup!",
            settings: await Setting.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID ).select('key', 'value')
        });

    } catch (err) {
        console.log(err.message)
        res.json({status:false})
    }
})

// STAGE 2 / phase 18 + 19: was unauthenticated — enables/disables the scheduled daily-report
// job with a bare GET. PATCH alias added; original GET kept working for the frontend.
async function dailyReportsToggleHandler(req, res) {
    const exists = await Queue.query().where('tenant_id', req.body.tenant_id).where('name', REPORT_KEY_NAME).first();
    if(!exists) {
        await Queue.query().insert({
            name: REPORT_KEY_NAME,
            scheduled_time: "00:00:00",
            tenant_id: req.body.tenant_id
        })
    } else {
        await Queue.query().where('tenant_id', req.body.tenant_id).where('name', REPORT_KEY_NAME).update({
            enabled: req.params.status === 'true'
        });
    }
    return res.json({
        status: true
    });
}
router.get('/daily-reports/:status', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), dailyReportsToggleHandler);
router.patch('/daily-reports/:status', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), dailyReportsToggleHandler);

// STAGE 2 / phase 18: was unauthenticated — changes the scheduled time of the daily report job.
router.post('/daily-reports-time', fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE), async( req, res )=> {

    await Queue.query().where('tenant_id', req.body.tenant_id).where('name', REPORT_KEY_NAME).update({
        scheduled_time: req.body.time
    });
    return res.json({
        status: true,
        body: req.body
    });
})


// ---------------------------------------------------------------------------------------
// Branding: restaurant logo shown in the sidebar/top-bar header and the login screen.
// Tenant-wide (user_id left null), not per-staff-member -- everyone at this restaurant
// sees the same logo, unlike the per-user STOCK_ALERT/INVENTORY_IS settings above.
// ---------------------------------------------------------------------------------------
router.get('/branding', fetchuser, async (req, res) => {
    try {
        const row = await Setting.query().where('tenant_id', req.body.tenant_id).where('key', 'BRANDING_LOGO').first();
        return res.json({ status: true, logo: row ? row.value : null });
    } catch (e) {
        return res.json({ status: false, logo: null });
    }
});

router.post('/branding/logo', [mediaUpload.single('logo'), fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE)], async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ status: false, message: 'No file uploaded.' });
        const filename = `logo-${req.body.tenant_id}-${Date.now()}.webp`;
        const outputPath = path.join(BRANDING_DIR, filename);
        await sharp(req.file.path).resize(256, 256, { fit: 'inside' }).webp({ quality: 90 }).toFile(outputPath);
        try { fs.unlinkSync(req.file.path); } catch (e) {}
        const relPath = `branding/${filename}`;

        const existing = await Setting.query().where('tenant_id', req.body.tenant_id).where('key', 'BRANDING_LOGO').first();
        if (existing) {
            await Setting.query().where('id', existing.id).patch({ value: relPath });
        } else {
            await Setting.query().insert({ tenant_id: req.body.tenant_id, key: 'BRANDING_LOGO', value: relPath });
        }
        return res.json({ status: true, logo: relPath });
    } catch (e) {
        console.log('branding logo upload failed:', e.message);
        return res.status(500).json({ status: false, message: 'Upload failed.' });
    }
});

// ---------------------------------------------------------------------------------------
// Customer display media: the slideshow/video loop shown on the second-monitor customer
// screen when idle, and behind the bill panel while a sale is in progress. Tenant-wide,
// ordered list stored as one JSON-encoded Setting row (small, infrequently-written list --
// not worth its own migration/table for a POS beautification pass).
// ---------------------------------------------------------------------------------------
async function readMediaList(tenantId) {
    const row = await Setting.query().where('tenant_id', tenantId).where('key', 'CUSTOMER_DISPLAY_MEDIA').first();
    if (!row || !row.value) return [];
    try {
        const parsed = JSON.parse(row.value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

async function writeMediaList(tenantId, list) {
    const existing = await Setting.query().where('tenant_id', tenantId).where('key', 'CUSTOMER_DISPLAY_MEDIA').first();
    const value = JSON.stringify(list);
    if (existing) {
        await Setting.query().where('id', existing.id).patch({ value });
    } else {
        await Setting.query().insert({ tenant_id: tenantId, key: 'CUSTOMER_DISPLAY_MEDIA', value });
    }
}

router.get('/customer-display/media', fetchuser, async (req, res) => {
    try {
        return res.json({ status: true, media: await readMediaList(req.body.tenant_id) });
    } catch (e) {
        return res.json({ status: false, media: [] });
    }
});

router.post('/customer-display/media', [mediaUpload.single('file'), fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE)], async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ status: false, message: 'No file uploaded.' });
        const ext = path.extname(req.file.originalname || '').toLowerCase();
        const isVideo = VIDEO_EXT.has(ext);
        const id = crypto.randomBytes(8).toString('hex');
        let relPath;

        if (isVideo) {
            const filename = `${id}${ext || '.mp4'}`;
            fs.copyFileSync(req.file.path, path.join(CUSTOMER_DISPLAY_DIR, filename));
            relPath = `customer-display/${filename}`;
        } else {
            const filename = `${id}.webp`;
            await sharp(req.file.path).resize(1920, 1080, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(path.join(CUSTOMER_DISPLAY_DIR, filename));
            relPath = `customer-display/${filename}`;
        }
        try { fs.unlinkSync(req.file.path); } catch (e) {}

        const list = await readMediaList(req.body.tenant_id);
        const entry = { id, file: relPath, type: isVideo ? 'video' : 'image', name: req.file.originalname || filename, created_at: new Date().toISOString() };
        list.push(entry);
        await writeMediaList(req.body.tenant_id, list);

        return res.json({ status: true, media: list, item: entry });
    } catch (e) {
        console.log('customer display media upload failed:', e.message);
        return res.status(500).json({ status: false, message: 'Upload failed.' });
    }
});

router.delete('/customer-display/media/:id', [fetchuser, requirePermission(PERMISSIONS.SETTINGS_MANAGE)], async (req, res) => {
    try {
        const list = await readMediaList(req.body.tenant_id);
        const target = list.find((m) => m.id === req.params.id);
        const remaining = list.filter((m) => m.id !== req.params.id);
        await writeMediaList(req.body.tenant_id, remaining);
        if (target) {
            const filePath = path.join(__dirname, '../tmp', target.file);
            try { fs.unlinkSync(filePath); } catch (e) {}
        }
        return res.json({ status: true, media: remaining });
    } catch (e) {
        return res.status(500).json({ status: false, message: 'Delete failed.' });
    }
});

module.exports = router
