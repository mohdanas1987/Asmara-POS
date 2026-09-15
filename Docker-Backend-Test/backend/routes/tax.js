const express = require("express");
const Tax = require('../models/Tax');
// const Currency = require('../models/Currency');
const router = express.Router();

const fetchuser= require('../middlewares/loggedIn');

let error = { status : false, message:'Something went wrong!' }

router.get('/', fetchuser, async (req,res) => {
    try {
        let taxes = await Tax.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID ).where('status', true);
        return res.json({ status:true, taxes });
    } catch (e) {
        console.log("exception occured: ",e)
        error.message = e.message
        return res.status(400).json(error)
    }
});

router.get('/list', fetchuser, async (req,res) => {
    try {
        let taxes = await Tax.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID );
        let noT = [{id:'notax',name:'', amount:'0%',status:1}]
        return res.json({status:true, taxes });
    } catch (e) {
        console.log("exception occured: ",e)
        error.message = e.message
        return res.status(400).json(error)
    }
});

// Route 3 : Get logged in user details - login required
router.post('/create', fetchuser, async(req, res) =>{
    try {

        const tax = await Tax.query().insert({
            name: req.body.name,
            amount: req.body.amount??0,
            status: req.body.status??true,
            user_id: req.body.myID,
            tenant_id: req.body.tenant_id
        });

        return res.json({status:true, tax });

    } catch (e) {
        error.message = e.message
        return res.status(500).json(error)
    }
});

router.post('/update', fetchuser, async(req, res) =>{
    try {

        const tax = await Tax.query().patchAndFetchById(req.body.id, {
            name: req.body.name,
            amount:req.body.amount,
            status: req.body.status
        }).where('tenant_id', req.body.tenant_id);

        return res.json({status:true, tax });

    } catch (e) {
        error.message = e.message
        return res.status(500).json(error)
    }
});

router.get('/remove/:id', fetchuser, async(req, res) =>{
    try {
        const taxDeleted = await Tax.query().deleteById(req.params.id).where('tenant_id', req.body.tenant_id);
        if(taxDeleted) {
            return res.json({status:true, taxDeleted});
        } else {
            return res.json({status:false, taxDeleted});
        }
    } catch (e) {
        error.message = e.message
        return res.status(500).json(error)
    }
});

// STAGE 2 / phase 18 + 19: was unauthenticated — enables/disables a tax rate across the
// whole POS with a bare GET. PATCH alias added; original GET kept working for the frontend.
async function toggleTaxHandler(req, res) {
    try {
        const tax = await Tax.query().patchAndFetchById(req.params.id, {
            status: req.params.status
        }).where('tenant_id', req.body.tenant_id);
        return res.json({status:true, tax, message: "Status updated!" });
    } catch (error) {
        return res.json({ status:false, tax:{}, message: error.message, message: "Something went wrong!" })
    }
}
router.get('/toggle/:id/:status', fetchuser, toggleTaxHandler);
router.patch('/toggle/:id/:status', fetchuser, toggleTaxHandler);

module.exports=router
