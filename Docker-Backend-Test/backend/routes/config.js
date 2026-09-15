const express = require("express");
const path = require('path')
const Setting = require('../models/Setting');
const Notification = require('../models/Notification');
const router = express.Router();
const fetchuser = require('../middlewares/loggedIn');
const { uploadFile, getCurrentDate, runScheduledJobs } = require("../utils");
const Queue = require("../models/Queue");
const { REPORT_KEY_NAME } = require("../utils/constants");

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
router.get('/daily-reports/:status', fetchuser, dailyReportsToggleHandler);
router.patch('/daily-reports/:status', fetchuser, dailyReportsToggleHandler);

// STAGE 2 / phase 18: was unauthenticated — changes the scheduled time of the daily report job.
router.post('/daily-reports-time', fetchuser, async( req, res )=> {

    await Queue.query().where('tenant_id', req.body.tenant_id).where('name', REPORT_KEY_NAME).update({
        scheduled_time: req.body.time
    });
    return res.json({
        status: true,
        body: req.body
    });
})

module.exports = router
