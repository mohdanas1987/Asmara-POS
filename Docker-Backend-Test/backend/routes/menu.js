const express = require("express");
const router = express.Router();

const fetchuser= require('../middlewares/loggedIn');
const { getRandomHexColor } = require("../utils");
const MenuCategory = require("../models/MenuCategory");

let error = { status : false, message:'Something went wrong!' }

// Phase 1 / Task #10 follow-up (multi-tenancy correctness fix): same issue as items.js's
// GET '/' -- no auth meant every tenant but the first ever created saw an empty category
// list. The only caller (useMenu.ts) only ever runs behind the dashboard's auth guard, so
// there's no real unauthenticated use case here to preserve.
router.get('/', fetchuser, async (req,res) => {
    try {
        let categories = MenuCategory.forTenant(req.body.tenant_id)
        .orderBy(`sq_pos`).select(['id','name']);
        return res.json({status:true, categories: await categories });
    } catch (e) {
        console.log("exception occured: ",e)
        error.message = e.message
        return res.status(400).json(error);
    }
});

// Route 3 : Get logged in user details - login required
router.post('/create', fetchuser, async(req, res) => {
    try {
        const category = await MenuCategory.query().insert({
            name: req.body.name,
            color: req.body.color??'#fff',
            status: req.body.status??true,
            user_id: req.body.myID,
            tenant_id: req.body.tenant_id
        });
        return res.json({ status:true, category });
    } catch (e) {
        error.message = e.message;
        return res.status(500).json(error);
    }
});

router.post('/update', fetchuser, async(req, res) => {
    try {
        // return res.json({req: req.body})
        await MenuCategory.query().findById(req.body.id).where('tenant_id', req.body.tenant_id).patch({
            name: req.body.name,
            color:req.body.color,
            status: req.body.status
        });
        return res.json({status:true, message:'Category updated successfully' });
    } catch (e) {
        error.message = e.message
        return res.status(500).json(error);
    }
});

// STAGE 2 / phase 19: already authenticated (fetchuser was already present). Verb was GET
// for a delete operation — DELETE alias added, GET kept working for the current frontend.
async function removeCategoryHandler(req, res) {
    try {
        // no worries for `user_id` here z `id` >>>> `user_id`
        const categoryDeleted = await MenuCategory.query().deleteById(req.params.id).where('tenant_id', req.body.tenant_id);
        if(categoryDeleted) {
            return res.json({ status:true, categoryDeleted });
        } else {
            return res.json({ status:false, categoryDeleted });
        }
    } catch (e) {
        error.message = e.message
        return res.status(500).json(error)
    }
}
router.get('/remove/:id', fetchuser, removeCategoryHandler);
router.delete('/remove/:id', fetchuser, removeCategoryHandler);

// STAGE 2 / phase 18 + 19: was unauthenticated (this toggles a menu category on/off across
// the whole POS — a real operational mutation). PATCH alias added for the verb fix.
async function toggleCategoryHandler(req, res) {
    try {
        // `id` dominates over `user_id`
        const category = await MenuCategory.query().patchAndFetchById(req.params.id, {
            status: req.params.status
        }).where('tenant_id', req.body.tenant_id);
        return res.json({status:true, category, message: "Status updated!" });
    } catch (error) {
        return res.json({
            status:false,
            category:{},
            error: error.message,
            message: "Something went wrong!"
        })
    }
}
router.get('/toggle/:id/:status', fetchuser, toggleCategoryHandler);
router.patch('/toggle/:id/:status', fetchuser, toggleCategoryHandler);

// STAGE 2 / phase 18: was unauthenticated — recolors every category in the system.
router.get('/fill-color', fetchuser, async(req,res) => {
    try {
        let cats =  (await MenuCategory.forTenant(req.body.tenant_id).select('id')).map( c => c.id);
        for (let index = 0; index < cats.length; index++) {
            const cat = cats[index];
            await MenuCategory.query().findById(cat).where('tenant_id', req.body.tenant_id).patch({
                color: getRandomHexColor() // '#000000'
            });
        }
        return res.json({message:"Category colors updated!"});
    } catch (error) {
        console.log(error.message);
        return res.json({status:false, message:"Failed to fill the colors in black & white life."});
    }
})

module.exports=router
