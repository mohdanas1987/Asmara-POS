const express = require("express");
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const KitchenStation = require('../models/KitchenStation'); // kitchen ticket routing (project audit 2026-09-15)
const router = express.Router();
const { body, validationResult }=require('express-validator')
const bcrypt= require('bcrypt');
const jwt = require('jsonwebtoken');
const fetchuser = require('../middlewares/loggedIn');
// STAGE 2 / phase 15: JWT_SECRET was a hardcoded literal ('whateverItWas') here. It now
// comes from the environment via config/auth.js — see that file for the full explanation.
const { JWT_SECRET } = require('../config/auth');
// const knex = require('./../server');

let error = { status : false, message:'Something went wrong!' }
let output = { status : true }

// Create a user
router.post('/signup', [
    body('name').isLength({min:5}),
    body('username').isLength({min:5}),
    body('password').isLength({min:6}),
], async (req,res) => {
    try {

        const errors=validationResult(req);

        if(!errors.isEmpty()) return res.status(400).res.json({errors : errors.array()});

        let user = await User.query().where('email', req.body.email);
        if(user){
            return res.status(400).json({...error, key:'email', message:'A user with that email already exists!'})
        }
        const salt = await bcrypt.genSalt(8);
        const secPass = await bcrypt.hash(req.body.password, salt)
        // Phase 1 / Task #10 (multi-tenant foundation, DEFERRED item): this route has no
        // way to know which tenant a brand-new signup belongs to -- there is no tenant/
        // restaurant-selection step anywhere in this request, and building real tenant
        // onboarding (choosing or creating a restaurant, invites, billing, etc.) is a
        // product decision well beyond "add a tenant_id column," so it is intentionally not
        // guessed at here. This route was already effectively unused (the POS provisions
        // staff accounts via seeding/an admin flow, not public signup) -- left working
        // exactly as before, defaulting into tenant 1 via the column default, and flagged as
        // a real gap to close before this app could actually onboard a second restaurant.
        user = User.query().insert({
            name: req.body.name,
            email : req.body.email.toLowerCase(),
            password : secPass
        });

        output.message = 'Account created successfully!'
        return res.json(output);

    } catch (e) {
        error.message = e.message;
        return res.status(500).json(error);
    }

});

// Real tenant onboarding -- closes the Phase 1 build plan's documented gap (see the long
// comment on the old /signup route above): creates a brand NEW restaurant (tenant row) and
// its first admin user, in one transaction, and logs them straight in. The old /signup route
// is left untouched (Preservation Contract) even though reading it closely while building
// this surfaced that it's actually non-functional -- `User.query().where('email', ...)`
// without `.first()` returns a query-builder promise that resolves to an ARRAY, which is
// always truthy even when empty, so the "email already exists" branch fires on every single
// signup attempt. That's a real, separate discovery, documented in VERIFICATION.md, and NOT
// silently fixed here since nothing currently depends on that route working (it was already
// flagged as unused) and fixing it isn't part of what was asked.
router.post('/signup-tenant', [
    body('restaurant_name', 'Restaurant name must be at least 2 characters.').isLength({ min: 2 }),
    body('name', 'Your name must be at least 2 characters.').isLength({ min: 2 }),
    body('email', 'A valid email is required.').isEmail(),
    body('password', 'Password must be at least 6 characters.').isLength({ min: 6 }),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ status: false, message: errors.array()[0].msg, errors: errors.array() });
        }

        const existing = await User.query().where('email', req.body.email.toLowerCase()).first();
        if (existing) {
            return res.status(400).json({ status: false, key: 'email', message: 'A user with that email already exists!' });
        }

        const baseSlug = req.body.restaurant_name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'restaurant';
        let slug = baseSlug;
        let suffix = 1;
        // eslint-disable-next-line no-await-in-loop
        while (await Tenant.query().where('slug', slug).first()) {
            suffix += 1;
            slug = `${baseSlug}-${suffix}`;
        }

        const salt = await bcrypt.genSalt(8);
        const hashedPassword = await bcrypt.hash(req.body.password, salt);

        // Clean SaaS-standard signup: a prospective restaurant can pick a plan right on the
        // signup form (fetched from the public GET /billing/plans list). If they don't pick
        // one (or pick an invalid/inactive one), fall back to whichever plan the platform
        // admin has flagged as the default (is_default), and if none exists yet, no plan at
        // all -- the subscription still gets created in 'trialing' status so every tenant
        // has one from day one, ready for a platform admin to assign a real plan later from
        // the Super Admin panel. Nothing here processes a real charge (sandbox/mock only).
        const { tenant, user, subscription } = await Tenant.transaction(async (trx) => {
            const newTenant = await Tenant.query(trx).insert({
                name: req.body.restaurant_name.trim(),
                slug,
                status: true,
            });
            const newUser = await User.query(trx).insert({
                name: req.body.name.trim(),
                email: req.body.email.toLowerCase().trim(),
                password: hashedPassword,
                type: 'admin',
                role: 'admin', // RBAC (project audit 2026-09-15): first user of a new tenant is always admin
                tenant_id: newTenant.id,
            });

            let chosenPlan = null;
            if (req.body.plan_id) {
                chosenPlan = await Plan.query(trx).where('id', req.body.plan_id).where('is_active', true).first();
            }
            if (!chosenPlan) {
                chosenPlan = await Plan.query(trx).where('is_default', true).where('is_active', true).first();
            }
            const newSubscription = await Subscription.query(trx).insert({
                tenant_id: newTenant.id,
                plan_id: chosenPlan ? chosenPlan.id : null,
                payment_provider_id: null,
                status: 'trialing',
            });

            // Kitchen ticket routing (project audit 2026-09-15): migration 0009's backfill
            // only ran once, for tenants that already existed at migration time -- a brand
            // new tenant created here afterwards needs its own default station too, or
            // routeOrderToKitchen() would have nowhere to send its first order.
            await KitchenStation.query(trx).insert({
                tenant_id: newTenant.id,
                name: 'Main Kitchen',
                is_default: true,
            });

            return { tenant: newTenant, user: newUser, subscription: newSubscription };
        });

        const authToken = jwt.sign({ user: { id: user.id, tenant_id: tenant.id, role: user.role || 'admin' } }, JWT_SECRET); // RBAC (project audit 2026-09-15)

        return res.json({
            status: true,
            message: 'Restaurant created!',
            authToken,
            tenant_id: tenant.id,
            tenant_name: tenant.name,
            tenant_slug: tenant.slug,
            subscription_status: subscription.status,
            plan_id: subscription.plan_id,
        });
    } catch (e) {
        return res.status(500).json({ status: false, message: e.message });
    }
});

// Route 3 : Authenticate the user
router.post('/login',[
    body('email','Invalid credentials!').isLength({min:5}),
    body('password','Password cannot be blank!').exists(),
],async (req,res) =>
{
    try
    {
        const errors=validationResult(req);
        if(!errors.isEmpty()){
            return res.status(400).json({errors : errors.array()})
        }
        let user = await User.query().where('email', req.body.email).first();
        if(!user){
            error.message = "User not found, please create an account to start!"
            return res.status(400).json(error);
        }

        const compared = await bcrypt.compare(req.body.password, user.password.replace(/^\$2y\$/, '$2a$'));
        if(!compared){
            error.message = "Incorrect Password!";
            return res.status(400).json(error);
        }

        // Phase 1 / Task #10 (multi-tenant foundation): embed the user's tenant in the
        // JWT so every downstream route (via middlewares/loggedIn.js) knows which restaurant
        // this request belongs to, without trusting anything the client sends.
        // RBAC (project audit 2026-09-15): embed the resolved role in the JWT so
        // requirePermission() has a trustworthy source -- falls back to the legacy `type`
        // column for any account that predates the `role` column, then to 'admin' so no
        // existing account loses access it already had (Preservation Contract).
        const payload = {
            user : {
                id : user.id,
                tenant_id: user.tenant_id,
                role: user.role || user.type || 'admin'
            }
        }

        const authToken = jwt.sign(payload, JWT_SECRET);
        return res.json({
            status:true,
            authToken,
            user,
            currency: '€ '
        });

    } catch (e) {
        console.log("exception occured: ",e);
        error.message = e.message;
        return res.status(400).json(error);
    }

});

// Route 3 : Get logged in user details - login required

router.get('/getuser', fetchuser, async(req, res) => {
    try {
        const userid = req.body.myID ?? req.body.id;
        // Phase 1 / Task #10: scope by tenant_id too -- a valid token from one tenant should
        // never be able to fetch a user record belonging to a different tenant, even if
        // `id` were ever taken from something other than the token itself.
        const user = await User.query().findById(userid).where('tenant_id', req.body.tenant_id);
        return res.json(user);
    } catch (e) {
        error.message = e.message;
        return res.status(500).json(error);
    }
});

router.get("/seed", async(req,res)=> {
    // const salt = await bcrypt.genSalt(8);
    // const password = await bcrypt.hash('121212', salt);
    // await Product.query().truncate();
    // const created = await Currency.query().insert({ name:'euro', status:true })
    return res.json({msg:'cleared'});
})

module.exports = router;
