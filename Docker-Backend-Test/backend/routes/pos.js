const express = require("express");
const Item = require('../models/Item');
const OrderDetail = require('../models/OrderDetail');
const CashRegister = require('../models/CashRegister');
const Customer = require('../models/Customer');
const router = express.Router();

const fetchuser= require('../middlewares/loggedIn');
const { getCurrentDate } = require("../utils");
const { logger } = require('../utils/logger');
let error = { status : false, message:'Something went wrong!' }


router.get('/items', fetchuser, async(req, res) => { // updated function
    try
    {
        let products;
        const cols = [
            'id',
            'name',
            'price',
            'category_id',
            'tax',
            'image',
            'stock as quantity',
            'thumb',
            'seq',
            'sold_by_weight',
            'weight_unit',
        ];

        if (req.body.category_id && req.body.category_id !== 'all') {
            products = await Item.query()
            .where('tenant_id', req.body.tenant_id).where('pos', true).where('category_id', req.body.category_id).orderBy('seq').select(cols).withGraphFetched().modifyGraph('category', (builder) => {
                builder.select(
                    'menu_categories.name as catName'
                );
            });
        } else {
            products = await Item.query()
            .where('tenant_id', req.body.tenant_id).where('pos', true).orderBy('seq').select(cols).withGraphFetched('category').modifyGraph('category', (builder) => {
                builder.select(
                    'menu_categories.name as catName'
                );
            });
        }

        return res.json({
            status:true,
            products: products.map(({ category, ...rest }) => ({
                ...rest,
                stock: 1,
                image: rest.thumb ? rest.thumb: rest.image,
                catName: category ? category.catName : null,
                taxAmount: rest.tax && rest.tax!=='null'? (rest.price.replace(/\s+/g, '')?.replace(",",'.') * parseFloat(rest.tax) / 100).toFixed(2) : 0.00
            }))
        })

    } catch (e) {
        error.message = e.message
        if (error.message.toLowerCase().includes('column')) {
            // await runCommand(`npx knex migrate:latest --cwd ${__dirname.replace('routes','')}`);
            return { status: false, relaunch:true, message: "Module installed, please restart." };
        }
        return res.status(400).json(error);
    }
});

// Route 3 : Get logged in user details - login required

// STAGE 2 / phase 23 (extending Stage 2's auth-gap-closure and error-handling baseline to
// the one remaining untouched route file, pos.js): this route had two separate problems.
//
// 1. It was completely unauthenticated -- fetchuser is now applied, matching every other
//    mutating/reading route in this Release Bundle.
// 2. It had NO try/catch at all, unlike every other route in the codebase, and its logic
//    (`session_id.session_id + 1`) throws a TypeError if no prior OrderDetail row exists for
//    this cash register yet (e.g. the very first session ever opened on a fresh register).
//    Because Express 4 does not forward a rejected promise from an async handler to the
//    global error middleware in server.js, that exception was an unhandled promise
//    rejection -- which, on the Node version this app ships with, terminates the whole
//    process. In practice: opening the first-ever session on a cash register could crash
//    the entire POS server for the whole restaurant. Fixed by wrapping in try/catch and
//    treating "no prior session" as session 1, not an error.
router.post('/session', fetchuser, async(req, res)=> {
    try {
        const previous = await OrderDetail.query()
        .where('tenant_id', req.body.tenant_id)
        .where('cash_register_id', req.body.cash_register_id )
        .orderBy('id', 'desc')
        .first();

        const session = previous ? previous.session_id + 1 : 1;
        return res.json({ session });
    } catch (e) {
        logger.error('pos.session.failed', { message: e.message, cash_register_id: req.body.cash_register_id });
        return res.status(500).json({ status: false, message: 'Could not determine session number.' });
    }
});

router.post('/opening-day-cash-amount', fetchuser, async(req, res) => {
    try {
        let created = await CashRegister.query().insert({
            opening_cash: req.body.cash,
            closing_cash: req.body.cash,
            date: getCurrentDate(),
            status: true,
            user_id: req.body.myID,
            tenant_id: req.body.tenant_id
        });
        return res.json({ status:true, created, message:"You can now start transactions!" });

    } catch (error) {
        return res.json({ status:false, message:error.message });
    }
});

router.get('/last-active-session', fetchuser, async(req, res)=> {
    try {
        const session = await CashRegister.query().where('tenant_id', req.body.tenant_id).where('user_id', req.body.myID).orderBy('id', 'desc').first();
        return res.json({ status:true, session });
    } catch (error) {
        console.log(error.message)
        return res.status(500).json({ status:false, reason:error.message });
    }
})

router.post('/create-customer', fetchuser, async (req, res )=> {
    try
    {
        await Customer.query().insertAndFetch({
            name: req.body.first_name+" "+req.body.last_name,
            email: req.body.email,
            phone: req.body.phone,
            note: req.body.note,
            tenant_id: req.body.tenant_id
        });
        const customers = await Customer.query().where('tenant_id', req.body.tenant_id).orderBy('id','desc').select(['id','name','email','phone']);

        return res.json({
            status:true,
            message: "Customer added!",
            customers
        });

    } catch (error) {
        console.log(error.message);
        return res.json({status:false, message: "Customer already exists!", exception: error.message });
    }

});

router.get('/customers', fetchuser, async (req,res) => {
    try {
        const customers = await Customer.query().where('tenant_id', req.body.tenant_id).orderBy(`id`,'desc').select(['id','name','phone','email']);
        return res.json(customers);
    } catch (error) {
        console.log(error)
    }
});

module.exports=router
