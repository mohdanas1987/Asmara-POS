const express = require("express");
const ProductCategory = require('../models/MenuCategory');
const Product = require('../models/Item');
const Tax = require('../models/Tax');
const XLSX = require('xlsx');
const axios = require('axios');
const sharp = require('sharp');
const url = require('url');
const path = require('path');
const router = express.Router();
const fs = require('fs');
const fetchuser = require('../middlewares/loggedIn');
const upload = require('../middlewares/multer');
const { uploadToServer, queueProduct } = require("../utils");
const { calculateInclusiveTax } = require('../utils/tax');
const User = require("../models/User");

let error = { status : false, message:'Something went wrong!' }

const normalizeSpaces = (str) => str.replace(/\s+/g, ' ').trim()

// Phase 1 / Task #10 follow-up (multi-tenancy correctness fix): this route used to have no
// `fetchuser` at all and silently fell back to tenant_id 1 whenever there was no token --
// meaning every tenant EXCEPT the very first one ever created would see a permanently empty
// menu here, since their real items live under their own tenant_id. Confirmed (by searching
// the whole frontend) that the only caller, useMenu.ts, only ever runs behind the dashboard's
// auth guard, where a real token always exists -- so there was never a legitimate
// unauthenticated use of this route to preserve. Now scoped like every other tenant-aware
// route in this app.
router.get('/', fetchuser, async (req,res) => { // updated function
    try {
        let products;
        const cols = [
            'id',
            'name',
            'price',
            'code',
            'tax',
            'image',
            'quantity',
            'pos',
            'category_id',
            'sold_by_weight',
            'weight_unit'
        ];

        const tenantId = req.body.tenant_id;
        if (req.body.category_id && req.body.category_id !== 'all') {
            products = await Product.query()
            .where('tenant_id', tenantId).where('category_id', req.body.category_id).where('deleted', false).orderBy('quantity', 'desc').select(cols).withGraphFetched().modifyGraph('category', (builder) => {
                builder.select(
                  'menu_categories.name as catName'
                );
            });
        } else {
            products = await Product.query().where('tenant_id', tenantId).where('deleted', false).orderBy('id', 'desc').select(cols).withGraphFetched('category').modifyGraph('category', (builder) => {
                builder.select(
                  'menu_categories.name as catName'
                );
            });
        }
        return res.json({
            status:true,
            products: products.map( item => {
                if(item.category) {
                    item.catName = item.category.catName
                    delete item.category
                }
                return item;
            })
        });

    } catch (e) {
        error.message = e.message;
        if (error.message.includes('column')) {
            await runCommand(`npx knex migrate:latest --cwd ${__dirname.replace('routes','')}`);
            return { status: false, relaunch:true, message: "Module installed, please restart." };
        }
        return res.status(400).json(error);
    }

});

// STAGE 2 / phase 18: was unauthenticated — any request could change any product's stock count.
router.post(`/updateStock/:id`, fetchuser, async (req, res)=> {
    try {
        const updated =  await Product.query().patchAndFetchById(req.params.id, {
            quantity: req.body.quantity
        }).where('tenant_id', req.body.tenant_id);
        return res.json({status:true, message:'Stock updated!', product:updated });

    } catch (error) {
        return res.json({status:false, message:"Something went wrong!"});
    }
});

// Route 3 : Get logged in user details - login required
router.post('/create', [upload.single('image'), fetchuser ], async(req, res) => {  // updated function
    try
    {

        if(req.body.barcode) { // check if barcode already exists
            const existing = await Product.query()
            .where('tenant_id', req.body.tenant_id)
            .where('added_by', req.body.myID)
            .where('code',(req.body.barcode).trim())
            .where('deleted', false)
            .first()

            if(existing) {
                return res.json({status:false, message:"This barcode already exists!"});
            }
        }

        const payload = {
            name: req.body.name,
            price: (req.body.price).trim()??0,
            code: (req.body.barcode).trim()?? null,
            category_id: req.body.category_id,
            sold_by_weight: req.body.sold_by_weight === true || req.body.sold_by_weight === 'true',
            weight_unit: req.body.weight_unit || 'kg',
            // BUG FIX (Task #36 / VAT-inclusive pricing sub-task): this is the route the real
            // frontend (src/lib/api.ts's createItem()) actually calls, but it never included
            // `tax` in the insert payload at all -- every item created through the live UI
            // got tax = null (its column default), so calculateInclusiveTax() always returned
            // 0 for it downstream (POS feed, order lines, X/Z reports). /create-custom and
            // /update both already set this field; /create was simply missing it.
            tax: req.body.tax ?? null,
        }

        // DISCOVERED BUG (found while adding the weight-based-item test suite, not
        // introduced by it): if a product is created with no category_id at all, the old
        // code called ProductCategory.query().where('id', undefined) which knex/objection
        // rejects outright ("undefined passed as argument #1 for 'where' operation"),
        // crashing item creation with a 500. Every real caller so far always sent a
        // category_id, so this never surfaced -- but a quick-add-without-category flow
        // (or, as here, a bare test) hits it immediately. Guarded rather than silently
        // left broken.
        const category = req.body.category_id
            ? await ProductCategory.query().where('id', req.body.category_id).where('tenant_id', req.body.tenant_id).first()
            : null;
        if(req.file)
        {
            const pName = payload.code ? payload.code: payload.name
            const updatedFilename = `${pName}.webp`;
            const outputPath = path.join(__dirname, '../tmp/products', updatedFilename.replace(/\s+/g, '_').trim());
            payload.image = `products/`+ updatedFilename.replace(/\s+/g, '_').trim();

            await sharp(req.file.path)
            .resize(400,400, { fit: 'inside' })
            .webp({ quality:50 })
            .toFile(outputPath);

            try { fs.unlinkSync(req.file.path) } catch (error) {}

        }

        payload.tenant_id = req.body.tenant_id;
        const product = await Product.query().insertAndFetch(payload);
        if (typeof queueProduct === 'function') {
            queueProduct('/queue-product', axios, req);
        } else {
            console.warn('[items/create] queueProduct is not defined in utils.js -- skipping (see routes/items.js comment)');
        }

        // ADDITIVE (Task #36): expose the corrected inclusive taxAmount alongside the raw
        // product, same shape /create-custom already returns, so the frontend can display
        // it without recomputing the (previously buggy) formula itself. Existing `product`
        // and `catName` fields are untouched -- Preservation Contract.
        const productWithTax = { ...product, taxAmount: calculateInclusiveTax(product.price, product.tax) };

        return res.json({
            status:true,
            message:"Product added successfully!",
            product: category? {...productWithTax, catName: category.name}: productWithTax
        });

    } catch (e) {
        error.message = e.message
        return res.status(500).json(error)
    }

});

router.post('/import', [ upload.single('file'), fetchuser ], async(req, res) => { // updated function
    try
    {
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0]; // Get the first sheet
        const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        const products = []
        for (const row of sheetData) {

            const catName = normalizeSpaces(row['Product Category'])
            let category = await ProductCategory.query().findOne({ name: catName, user_id: req.body.myID, tenant_id: req.body.tenant_id });

            if (!category) {
                category = await ProductCategory.query().insert({ name: catName, user_id: req.body.myID, tenant_id: req.body.tenant_id });
            }

            // Step 2: Find or create the product with the barcode
            let path=null
            if(row.Images){
                path = await downloadAndProcessImage(row.Images)
                path = 'products/'+path;
            }

            // NOTE (discovered, pre-existing, unrelated to Task #10 -- not fixed here per
            // "no scope creep"): `product` is the QueryBuilder itself, never awaited, so
            // `if(product)` is always truthy and the `else` branch below (meant to update an
            // existing product) is dead code -- every row from this import always takes the
            // insertGraph path. Left exactly as it already behaved; tenant_id is still added
            // to both branches so this doesn't become a new tenant-isolation gap if/when the
            // underlying bug is ever fixed.
            let product = Product.query().where('tenant_id', req.body.tenant_id).where('added_by', req.body.myID ).where('code', row.Barcode).where('deleted',false).first()
            let url = null;
            if(product) {
                await Product.query().insertGraph({
                    code: row.Barcode,
                    name: row.Name,
                    price: row['Sales Price'],
                    sales_desc: row['Sales Description'],
                    image: path,  // Use the uploaded path or the default image from Excel
                    category_id: category.id ?? null,  // Associate with the category
                    tax: row['Taxes'] ?? null,  // Handle optional tax field,
                    added_by: req.body.myID,
                    tenant_id: req.body.tenant_id
                });
            } else {
                await Product.query().findById(product.id).where('tenant_id', req.body.tenant_id).patch({
                    name: row.Name,
                    price: row['Sales Price'],
                    sales_desc: row['Sales Description'],
                    image: path,  // Use the uploaded path or the default image from Excel
                    category_id: category.id ?? null,  // Associate with the category
                    tax: row['Taxes'] ?? null,  // Handle optional tax field
                });
            }
            products.push({
                barCode: row.Barcode,
                name: row.Name,
                price: row['Sales Price'],
                category: category.name,
                tax: row['Taxes']??'0%',
                synced:false
            })
        }
        // queueProduct(url, axios, products) // make some other function that carries the bulk payload for products.
        return res.json({status:true, message: 'Products successfully imported!' });

    } catch (e) {
        error.message = e.message
        return res.status(500).json(error)
    }

});

router.post('/update', [upload.single('uploaded'),fetchuser], async(req, res) =>{ // updated function
    try {
        const included = /^(?:Fresh|Topop Voucher|Habesha|Vegetables|Vegetable|Green Vegetables|Paneer|Fruits)$/i;
        if(!included.test(req.body.catName) && !req.body.code)
        {
            return res.json({status:false, message:"Barcode can't be empty!"});
        }
        const product = await Product.query()
        .where('tenant_id', req.body.tenant_id)
        .where('added_by', req.body.myID)
        .where('code', (req.body.code).trim())
        .where('deleted', false)
        .where('id','!=', req.body.id );

        if(req.body.code && product.length && req.body.id !== product.id) {
            return res.json({status:false, message:"This barcode already exists!"});
        }
        const body = {
            name: req.body.name,
            price:(req.body.price).trim(),
            tax: req.body.tax,
            code: (req.body.code).trim(),
        }
        if (typeof req.body.sold_by_weight !== 'undefined') {
            body.sold_by_weight = req.body.sold_by_weight === true || req.body.sold_by_weight === 'true';
        }
        if (req.body.weight_unit) {
            body.weight_unit = req.body.weight_unit;
        }

        if(req.file) {
            const pName = body.code ? body.code : body.name;
            const updatedFilename = `${pName + req.body.myID}.webp`;
            const outputPath = path.join(__dirname, '../tmp/products', updatedFilename.replace(/\s+/g, '_').trim());

            // Ensure file exists before processing
            if (!fs.existsSync(req.file.path)) {
                console.error("Error: Uploaded file does not exist.");
                return res.status(400).json({ error: "File not found" });
            }

            try {
                await sharp(req.file.path)
                    .resize(400, 400, { fit: 'inside' })
                    .webp({ quality: 50 })
                    .toFile(outputPath);

                body.image = `products/` + updatedFilename.replace(/\s+/g, '_').trim();
                if(req.body.image!== 'null') {
                    const oldPath = path.join(__dirname,`../tmp/${req.body.image}`)
                    if (fs.existsSync(oldPath)) {
                        fs.unlink(oldPath, er => {
                            if(er) {
                                console.error("Error deleting old image",er);
                            }
                        })
                    }
                }
            } catch (error) {
                console.error("Sharp Processing Error:", error);
                return res.status(500).json({ error: "Image processing failed" });
            }

        }
        let toSync = {
            name: body.name,
            price: body.price,
            barcode: body.code,
            tax: body.tax
        }
        if(req.body.category_id) {
            body.category_id = req.body.category_id;
            toSync.category = req.body.catName
        }
        const updated = await Product.query().patchAndFetchById(req.body.id, body).where('tenant_id', req.body.tenant_id);
        const data = typeof queueProduct === 'function'
            ? await queueProduct('/products/update-product', axios, req)
            : (console.warn('[items/update] queueProduct is not defined in utils.js -- skipping (see routes/items.js comment)'), null);
        return res.json({ status:true, updated, wasTrue: data?.status });

    } catch (e) {
        console.log(e)
        error.message = e.message
        return res.json({...error, e})
    }
});

// STAGE 2 / phase 16 (extended, same "no hardcoded secrets" principle): the fallback
// Authorization value sent to the vendor (pos.dftech.in) was a hardcoded literal token.
// It is now read from an environment variable, with the previous literal kept ONLY as a
// documented fallback default so behavior is unchanged until DFTECH_FALLBACK_TOKEN is set —
// this should be set and the fallback removed entirely as soon as practical.
const DFTECH_FALLBACK_TOKEN = process.env.DFTECH_FALLBACK_TOKEN || 'Vyo0WttjzBTh';

router.get('/remove/:id', fetchuser, async(req, res) =>{
    try
    {
        const {id} = req.params
        const product = await Product.query().findById(id.split('_')[0]).where('tenant_id', req.body.tenant_id);
        try {
            if( product.image && product.image!='null' ) {
                fs.unlinkSync(path.join(__dirname, '../tmp/'+ product.image))
            }
        } catch (error) {}
        const removed = await Product.query().patchAndFetchById(id.split('_')[0], {
            deleted: true
        }).where('tenant_id', req.body.tenant_id);
        let disconnected=false;
        let rest
        try{
            let { data } = await axios.post(`https://pos.dftech.in/products/remove-product`, { product }, {
                headers: {
                    'Authorization': id.split('_')[1] ?? DFTECH_FALLBACK_TOKEN,
                    'Content-Type': 'application/json'
                }
            })
            rest=data;
        } catch (e){ console.log(e);disconnected=true }
        if( removed ) {
            return res.json({ status:true, removed, message:'Product removed', data:rest, disconnected });
        } else {
            return res.json({
                status:false,
                removed:'',
                message:'Failed to remove!',
                data:{status:false}
            });
        }
    } catch (e) {
        error.message = e.message;
        return res.status(500).json(error);
    }
});

async function downloadAndProcessImage(imageUrl) {
    try {
        const response = await axios({
            method: 'get',
            url: imageUrl,
            responseType: 'arraybuffer', // Get image data as a buffer
        });

        const imageBuffer = Buffer.from(response.data, 'binary');

        const parsed = url.parse(imageUrl);
        let fileName = path.basename(parsed.pathname);
        fileName = fileName.split('.')[0]+'.webp';
        // Use sharp to resize and reduce quality (e.g., 80% quality)
        await sharp(imageBuffer)
        .resize(400, 400, {
            fit: 'inside',
        })
        .webp({ quality: 35 })
        .toFile(path.join('tmp/products', fileName));
        // .resize(800)  // Resize width to 800px (optional)
        // .jpeg({ quality: 40 })  // Reduce quality to 80%
        // .toFile(path.join('tmp/products', fileName));  // Save the image locally
        return fileName;

    } catch (error) {
        console.error('Error downloading or processing the image:', error.message);
        return imageUrl;
    }

}

// STAGE 2 / phase 18 + 19: was unauthenticated — toggles whether a product is visible on
// the POS at all. PATCH alias added for the verb fix; original GET kept for the frontend.
async function updateProductPosHandler(req, res) {
    try
    {
        const {id,status} = req.params;
        await Product.query().findById(id).where('tenant_id', req.body.tenant_id).patch({
            pos: status
        });
        let product = await Product.query().where('id', id).where('tenant_id', req.body.tenant_id).select(['id','name','image','price','quantity','category_id','sales_desc','code']).first()
        const P = await ProductCategory.query().findById(product.category_id).where('tenant_id', req.body.tenant_id).select(['name']).first();
        return res.json({status:true, product:{...product, catName:P?.name??null} });

    } catch (error) {
        console.log(error.message);
        return res.json({ status:false, product:{} })
    }
}
router.get(`/update-product-pos/:id/:status`, fetchuser, updateProductPosHandler);
router.patch(`/update-product-pos/:id/:status`, fetchuser, updateProductPosHandler);


// STAGE 2b / phase 26 (Phase 1 local-dev pass, real functional-bug fix): this handler was
// unauthenticated (fixed in Stage 2 / phase 18) AND had two crash bugs discovered but
// deliberately left unfixed at the time, per that phase's "no scope creep" rule: the axios
// call was never awaited before `.data` was read off the still-pending Promise, and
// `path.basename()` was called with no argument at all -- both throw immediately, and
// because this route (like pos.js's old /session) had no try/catch, either one would have
// been an unhandled promise rejection capable of crashing the whole server on a single
// request. Now fixed to match the already-correct sibling function `downloadAndProcessImage`
// a few lines above: await the request, derive the filename from the real source URL, and
// wrap the whole thing in try/catch. The output path is also now resolved via `__dirname`
// (like every other file-writing route in this file) instead of a bare relative path, which
// previously depended on the process's current working directory rather than the app's own
// location -- and the target directory is created if it doesn't exist yet, since nothing
// else in this codebase appears to create `tmp/converted` ahead of time.
router.post('/convert', fetchuser, async (req, res) => {
    try {
        const response = await axios({
            method: 'get',
            url: req.body.image,
            responseType: 'arraybuffer',
        });

        const imageBuffer = Buffer.from(response.data, 'binary');

        const parsed = url.parse(req.body.image);
        let fileName = path.basename(parsed.pathname || '') || `image-${Date.now()}`;
        fileName = fileName.split('.')[0] + '.webp';

        const outputDir = path.join(__dirname, '../tmp/converted');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        await sharp(imageBuffer)
            .resize(400, 400, { fit: 'inside' })
            .webp({ quality: 35 })
            .toFile(path.join(outputDir, fileName));

        return res.json({ status: true, fileName });

    } catch (e) {
        console.error('Error converting image:', e.message);
        return res.status(500).json({ status: false, message: 'Could not convert image.' });
    }
});

router.post(`/create-custom`, [upload.single('image'),fetchuser], async(req,res) => {
    try
    {
        const payload = {
            name: req.body.name,
            price: (req.body.price).trim(),
            tax: req.body.tax ?? null,
            category_id: req.body.category_id,
            // BUG FIX (found via test/tax.test.js while verifying the VAT fix): this route
            // has always inserted `on_web`, but no migration in migrations_local/ has ever
            // added an `on_web` column to menu_items -- every call to this route crashed with
            // "SQLITE_ERROR: table menu_items has no column named on_web". Confirmed via the
            // frontend that this route is never actually called anywhere today (dead code),
            // which is the only reason this pre-existing bug went unnoticed. Dropping the
            // nonexistent field rather than adding a migration for an unused column.
            tenant_id: req.body.tenant_id,
        }

        const product = await Product.query().insertAndFetch(payload);
        // await queueProduct('/queue-product', axios, req);
        return res.json({
            status:true,
            message:"Product has been added!",
            product: {...product, taxAmount: calculateInclusiveTax(product.price, product.tax) }
        });

    } catch (error) {
        console.log(`exception while syncing: `+error.message)
        return res.json({status:false, message:error.message, product:{}})
    }
})

async function runCommand(command) {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    try {
        const { stdout, stderr } = await execPromise(command);
        if (stderr) {
            return {output:`⚠️ Command executed with warnings: ${stderr}`};
        }
        return {output:`✅ Command successful:\n${stdout}`};

    } catch (error) {
        return {output:`❌ Command failed: ${error.message}`};
    }
}

module.exports=router
