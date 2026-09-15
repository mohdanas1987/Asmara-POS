const CashRegister = require('./models/CashRegister');
const Table = require('./models/Table');

const normalizeSpaces = (str) => {
    return str.replace(/\s+/g, ' ').trim();
}

const getCurrentDate = (format = 'dmy') => {
    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0'); // Add leading zero if needed
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    if (format === 'dmy') return `${day}-${month}-${year}`;
    if (format === 'hours') return `${day}-${month}-${year} ${hours}:${minutes}`;
    return `${year}-${month}-${day}`;
};

async function generatePdf(data) {

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            @page {
                size:auto;
                margin:-2mm 3mm 3mm 0mm;
            }
            *{
                font-weight:400!important;
                text-transform:uppercase;
                font-size:0.85rem!important;
                font-family:system-ui!important;
            }
            small {font-size:0.65rem!important}
            .head { 
                border-bottom: 2px solid black;
                display:grid;
                width:100%;
                text-align:center;
                justify-content:center;
                place-content:center;
                padding-bottom:10px;
                margin-bottom:10px;
            }
            td:last-child {text-align:right!important}
            .head p:first-child {  text-align:center;border-bottom: 1px solid black; }
            td {padding: 0px 8px 0px 8px!important}
        </style>
    </head>
    <body style="width:32vw!important;margin:0px!important;padding:0px!important;">

        <div style="padding-bottom:40px;border-radius:15px;border:2px dashed gray;">

            <div class="head" >
                <img src="[PNGLOGO]" alt="Logo" style="height:80px;object-fit:contain"/>
                <p>${data.Rtype} - Report</p>
            </div>
            <div class="row">
                <table style="width:100%;border-bottom:1px dashed gray;padding-bottom:20px">
                    <tbody>
                        ${data.register ?
            `<tr><td colspan="2"><b>Cash Register ID</b>:</td><td class="right">#${data.register.id}</td></tr>
                            <tr><td colspan="2"><b>Opening Cash</b>:</td><td class="right">${data.register.open}</td></tr>
                            <tr><td colspan="2"><b>Closing Cash</b>:</td><td class="right">${data.register.close}</td></tr>`
            : `
                        <tr>
                            <td colspan="3" style="text-align:center!important">Report Month: ${data.monthName}</td>
                        </tr>`}
                        <tr><td colspan="2"><b>Report Date</b>:</td><td>${new Date().toLocaleDateString()}</td></tr>
                        <tr><td colspan="2"><b>Report Time</b>:</td><td>${new Date().toLocaleTimeString()}</td></tr>
                        <tr><td colspan="2"><b>Transactions</b>:</td><td>${data.number_of_transactions}</td></tr>
                        <tr><td colspan="2"><b>Total Products</b>:</td><td>${data.total_products}</td></tr>
                        <tr><td colspan="2"><b>Cash </b>:</td><td>€ ${data.cash.toFixed(2)}</td></tr>
                        <tr><td colspan="2"><b>Card </b>:</td><td>€ ${data.card.toFixed(2)}</td></tr>
                        <tr><td colspan="2"><b>Account </b>:</td><td>€ ${data.account.toFixed(2)}</td></tr>
                        <tr><td colspan="2"><b>Tax</b>:</td><td>${data.total_tax.toFixed(2)}</td></tr>
                        <tr style="border-top:1px dashed gray">
                            <td colspan="3"><small>Sale By Categories</small></td>
                        </tr>
                        ${Object.entries(data.categories).map(([cat, amount]) => `
                            <tr>
                                <td colspan="2"><b>${cat}</b>:</td>
                                <td>${amount}</td>
                            </tr>`).join('')}
                        <tr>
                        <tr style="border-top:1px dashed gray">
                            <td colspan="3"><small>Included Taxes</small></td>
                        </tr>
                        <tr>
                            <td>BTW</td>
                            <td>OVER</td>
                            <td class="right">EUR</td>
                        </tr>
                        ${Object.entries(data.taxes).map(([type, obj]) => `
                            <tr>
                                <td>${!obj.value.includes('%') ? obj.value + "%" : obj.value}</td>
                                <td>${parseFloat(obj.price - obj.applied).toFixed(2)}</td>
                                <td class="right">€ ${parseFloat(obj.applied).toFixed(2)}</td>
                            </tr>`).join('')
        }
                        <tr>
                            <td><b>TOTAL</b></td>
                            <td></td>
                            <td class="right"><b style="font-size:1.5rem!important">€ ${(data.total_amount).toFixed(2)}</b></td>
                        </tr>
                        <tr>
                            <td>Generated</td>
                            <td></td>
                            <td class="right">${getCurrentDate()}</td>
                        </tr>
                        <tr>
                            <td><b style="color:transparent">wsdhfk</b></td>
                            <td></td>
                            <td><b style="color:transparent"> ${new Date().toLocaleString()}</b></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </body>
    </html>`;
}

async function runCommand(command) {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    try {
        const { stdout, stderr } = await execPromise(command);
        if (stderr) {
            return { output: `⚠️ Command executed with warnings: ${stderr}` };
        }
        return { output: `✅ Command successful:\n${stdout}` };

    } catch (error) {
        return { output: `❌ Command failed: ${error.message}` };
    }
}

async function uploadFile(filePath, uploadUrl, clientName) {
    const axios = require('axios');
    const fs = require('fs')
    const FormData = require("form-data");
    const path = require('path')
    try {
        const fileStream = fs.createReadStream(filePath);
        const formData = new FormData();
        formData.append("file", fileStream);
        formData.append("client", clientName);
        formData.append("path", path.resolve(__dirname, './database/db.sqlite'));

        const headers = {
            ...formData.getHeaders()
        };
        const { data } = await axios.post(uploadUrl, formData, { headers });

        return data.status;

    } catch (error) {
        console.error("Error uploading file:", error.message);
        if (error.message.includes('column')) {
            await runCommand(`npm install form-data dotenv`);
            return { status: false, relaunch: true, message: "Module installed, please restart." };
        }
        return false
    }
}

function getRandomHexColor() {
    return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

function generateOrderId() {
    // Get current date in YYYYMMDD format
    const crypto = require('crypto');
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(now.getDate()).padStart(2, '0');

    // Generate a random 5-character alphanumeric string
    const randomStr = crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase();

    return `ORD-${year}${month}${day}-${randomStr}`;
}

const europeanDate = () => new Date().toISOString("en-US", { timeZone: "Europe/Amsterdam" })

const uploadToServer = async (formData, axios) => {

    try {
        const { data } = await axios.post(process.env.SERVER_URL, formData, {
            headers: {
                "Accept": "application/json",
                "Content-Type": "multipart/form-data",
            }
        });
        return data;

    } catch (error) {
        return {
            status: false,
            exception: error.message
        }
    }
}

const keys = obj => Object.keys(obj);

const generateReport = async (payload) => {

    const CashRegister = require('./models/CashRegister');
    const Product = require('./models/Item');
    const Report = require('./models/Report');
    const Order = require('./models/Order');
    const User = require('./models/User');
    const path = require('path');
    const pdf = require('html-pdf');
    const storage = require('./utils/storage');
    const fs = require('fs');
    const imgPath = path.join( __dirname, './tmp/logo-bw.png' );
    let b64 = fs.readFileSync(imgPath, 'base64');

    const { type: Rtype, register_id, currency } = payload;

    let totals = {
        totalProducts: 0,
        total: 0,
        returns: 0,
        tax: 0,
        cash: 0,
        card: 0,
        account: 0,
        discounts: 0
    };

    let customers = [];
    let categories = {};

    const taxes = {};
    const qt = {};
    let lastRegisterID = null;

    let ordersQuery = Order.query().select(['data', 'payment_mode']).where('payment_status', 'paid');
    if (payload.today) {

        const lastSession = await CashRegister.query().where('status', true).select('id').first().orderBy('id', 'DESC');
        if (lastSession) {
            lastRegisterID = lastSession.id
            ordersQuery
                .where('cash_register_id', lastSession.id);
        }

    } else {

        lastRegisterID = register_id;
        if (payload.month) {
            const start = `${payload.month}-01`;
            const end = `${payload.month}-31`;
            ordersQuery.where('created_at', '>=', start).where('created_at', '<=', end); // x-report always
        } else {
            ordersQuery.where('cash_register_id', register_id); // x-report always
        }

    }
    const orders = await ordersQuery;
    if (!orders.length) {
        return { status: true, html: '', message: 'No transactions found' };
    }
    const productIds = [];

    const parsedOrders = orders.map(o => {
        const data = JSON.parse(o.data);
        if (data === null) return { ...o };
        (keys(data.quantity) ?? []).forEach(id => {
            productIds.push(id);
        });
        return { ...o, parsed: data };
    });

    // 3️⃣ Fetch products ONCE
    const products = await Product.query()
        .withGraphFetched('category(selectName)')
        .modifiers({
            selectName(build) {
                build.select('name');
            }
        })
        .whereIn('id', productIds)
        .select(['id', 'price', 'tax']);

    const productMap = {};
    products.forEach(p => {
        productMap[p.id] = p;
    })

    for (const order of parsedOrders) {

        const { parsed: d, payment_mode } = order;
        if (order.data === null) continue; // ignore the ongoing orders

        totals.total += Number(d.total);

        Object.values(d.quantity || {}).forEach(q => {
            totals.totalProducts += parseInt(q);
        });

        if (payment_mode === 'Cash') totals.cash = totals.cash + Number(d.total);
        else if (payment_mode === 'Card') totals.card = totals.card + Number(d.total);
        else if (payment_mode === 'Account') totals.account = totals.account + Number(d.total);

        else if (d.modes) {

            const { Cash = 0, Card = 0, Account = 0, ogCash } = d.modes;
            totals.cash = totals.cash + ((ogCash && Number(ogCash) < Number(Cash)) ? Number(ogCash) : Number(Cash));
            totals.card = totals.card + Number(Card);
            totals.account = totals.account + Number(Account);

        }
        for (const [id, qty] of Object.entries(d.quantity || {})) {

            if (id.indexOf('quick') !== -1) {
                categories.Others = (categories.Others || 0) + Number(d.otherAmount || 0);
                qt.Others = (qt.Others || 0) + Number(qty);
                continue;
            }

            const product = productMap[id];
            if (!product) continue;
            if (product.tax) {
                const [value, type] = product.tax.split(' ');
                if (value === undefined || value == null || value === 'null') continue;
                const noNumberRegex = /^[^0-9]*$/
                let cal = noNumberRegex.test(value) ? parseFloat(type ?? 0) : parseFloat(value ?? 0);

                const applied = (cal / 100) * (d.price?.[id] ?? product.price);

                totals.tax += applied;
                const collection = taxes[type ?? 'VAT'];
                const box = {
                    applied: collection?.applied ? collection.applied + Number(applied) : Number(applied),
                    price: Number(d.price?.[id] ?? product.price)
                };

                if (type !== undefined && type.toUpperCase() !== 'VAT') {
                    taxes[type] = taxes[type] && Object(taxes[type]).hasOwnPropery("price") ?
                        { ...box, value, price: taxes[type].price + Number(box.price) }
                        : { ...box, value };
                } else {
                    taxes['VAT'] = taxes['VAT'] && taxes.VAT?.price ?
                        { ...box, value, price: taxes['VAT'].price + Number(box.price) }
                        : { ...box, value };
                }
            }

            if (product.category) {
                categories[product.category.name] = (categories[product.category.name] || 0) +
                    ((d.price?.[id] ?? (product.price * qty)));
                qt[product.category.name] = (qt[product.category.name] || 0) + Number(qty);
            }

            totals.discounts +=
                (d.price?.[id] ?? product.price) - product.price;

        }

    }

    let me = await User.query().where('id', payload.myID).first();
    let registerCash = await CashRegister.query().where('id', payload.register_id ?? lastRegisterID).first();

    // now we have the meta-data
    let data = {
        total_products: totals.totalProducts,
        total_customers: customers.length,
        return_amount: totals.returns,
        total_tax: totals.tax,
        total_amount: Number(totals.cash) + Number(totals.card) + Number(totals.account),
        cash: totals.cash,
        card: totals.card,
        account: totals.account,
        discounts: totals.discounts,
        number_of_transactions: orders.length,
        categories,
        taxes,
        qt,
        Rtype,
        print: false,
        currency,
        userName: me?.name,
        b64,
        monthName: payload.monthName
    };
    let tot = Number(totals.cash) + Number(totals.card) + Number(totals.account);
    if (registerCash) {
        data.register = {
            id: registerCash.id,
            open: registerCash?.opening_cash ?? 0,
            close: '€ ' + (tot + Number(registerCash.opening_cash.replace('€ ', ''))),
        }
    };
    let view = await generatePdf(data); // Pass data to a template renderer
    let toSave = view;
    view = view.replace('[PNGLOGO]', `data:image/png;base64,${data.b64}`);
    const options = { format: 'A4' };

    let pathName = `reports/${(registerCash?.date ?? payload.monthName) ?? Math.random(2000)}_${Rtype}_report.pdf`;
    if (Rtype === 'Z') {
        if (payload.today) { // more likely the current session

            await Order.query().where('cash_register_id', lastRegisterID).where('data', null).orWhere('payment_status', 'pending').delete();
            await Table.query().patch({
                status: 'free',
                linked_to: null
            });

            await Report.query().insert({
                path: pathName,
                date: europeanDate(),
                user_id: payload.myID,
                cash_register_id: lastRegisterID ?? 0,
                html: toSave.replace('display:grid;', 'display:flex')
            });

        } else {

            const exists = await Report.query().where('cash_register_id', lastRegisterID).first();
            if (!exists && lastRegisterID) {
                await Report.query().insert({
                    path: pathName,
                    date: europeanDate(),
                    user_id: payload.myID,
                    cash_register_id: lastRegisterID ?? 0,
                    // html: view
                    html: toSave.replace('display:grid;', 'display:flex')
                });
            }

        }

        pdf.create(view.replace('display:grid;', 'display:flex').replace('width:32vw','width:80mm'), options).toBuffer(async (err, fileBuffer) => {
            if (err) {
                console.error(err);
            } else {
                await storage.put(pathName, fileBuffer);
            }
        });

    } else {
        // for Testing purpose

        // pdf.create(view, options).toBuffer(async (err, fileBuffer) => {
        //     if (err) {
        //         console.error(err);
        //     } else {
        //         await storage.put(pathName, fileBuffer);
        //     }
        // });
    }

    return {
        status: true,
        message: Rtype === 'Z' ? 'Z-report generated!' + (payload.today ? ' Sessions are reset' : "") : "X-report generated!",
        html: view,
        register_id: lastRegisterID
    };

}

const generateZreport = async (cron = false) => {
    const lastSession = await CashRegister.query().where('status', true).select('id').first().orderBy('id', 'DESC');
    if (lastSession) {
        await generateReport({
            today: true,
            type: 'Z',
            currency: '€ ',
            register_id: null
        });
        if (cron) {
            await CashRegister.query().where('id', lastSession.id).patch({
                status: false
            });
            await Table.query().patch({
                status: "free"
            });
        }
    }
}


module.exports = {
    normalizeSpaces,
    getCurrentDate,
    generatePdf,
    uploadFile,
    getRandomHexColor,
    europeanDate,
    uploadToServer,
    generateOrderId,
    keys,
    generateZreport,
    generateReport
};
