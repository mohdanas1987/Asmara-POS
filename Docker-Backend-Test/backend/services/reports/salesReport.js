'use strict';
/**
 * Sales report (task #38 -- "Reporting: X/Z, VAT, sales, table performance"). X/Z reports
 * (utils.js's generateReport) are scoped to one cash-register SESSION -- they answer "how
 * much did this shift take." This answers a different question the plan also calls for and
 * nothing in the app answered before: "how is the business doing over a date range" --
 * regardless of how many register sessions fall inside it. Deliberately a read-only report:
 * unlike a Z-report it never deletes/frees anything, so it's safe to run as often as wanted
 * (e.g. every page load of a sales dashboard) without side effects.
 *
 * Revenue is counted the same way the X/Z report and the rest of the app already do --
 * `payment_status = 'paid'` orders only (see services/payments/paymentLedger.js's
 * deriveStatus) -- so a genuinely partial payment is surfaced separately, not folded into
 * "revenue" and overstating it.
 */
const Order = require('../../models/Order');
const Item = require('../../models/Item');
const { keys } = require('../../utils');

function toDateOnly(d) {
    return d.toISOString().slice(0, 10);
}

/**
 * @param {number} tenantId
 * @param {{from?: string, to?: string}} range - inclusive date-only bounds (YYYY-MM-DD). If
 *   omitted, defaults to the trailing 30 days ending today, since an unbounded "all sales
 *   ever" query is rarely what a dashboard actually wants and would only get slower over the
 *   restaurant's lifetime.
 */
async function generateSalesReport(tenantId, range = {}) {
    const today = new Date();
    const defaultTo = toDateOnly(today);
    const defaultFrom = toDateOnly(new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000));

    const from = range.from || defaultFrom;
    const to = range.to || defaultTo;
    // Half-open on the END so a same-day order made at 23:59 is included -- created_at is a
    // full ISO timestamp, and `<= '2026-09-16'` would string-compare as before midnight only.
    const toExclusiveBound = `${to}T23:59:59.999Z`;
    const fromInclusiveBound = `${from}T00:00:00.000Z`;

    const paidOrders = await Order.query()
        .where('tenant_id', tenantId)
        .where('payment_status', 'paid')
        .where('created_at', '>=', fromInclusiveBound)
        .where('created_at', '<=', toExclusiveBound)
        .select(['id', 'data', 'total', 'payment_mode', 'created_at']);

    const partialCount = await Order.query()
        .where('tenant_id', tenantId)
        .where('payment_status', 'partial')
        .where('created_at', '>=', fromInclusiveBound)
        .where('created_at', '<=', toExclusiveBound)
        .resultSize();

    const byDay = {};
    const byPaymentMethod = { cash: 0, card: 0, account: 0 };
    const itemTotals = {}; // id -> { quantity, revenue }
    const productIds = new Set();
    let revenue = 0;

    for (const order of paidOrders) {
        const total = Number(order.total) || 0;
        revenue += total;

        const day = String(order.created_at).slice(0, 10);
        if (!byDay[day]) byDay[day] = { date: day, revenue: 0, orders: 0 };
        byDay[day].revenue += total;
        byDay[day].orders += 1;

        let data = null;
        try { data = order.data ? JSON.parse(order.data) : null; } catch { data = null; }
        if (!data) continue;

        if (data.modes) {
            const { Cash = 0, Card = 0, Account = 0, ogCash } = data.modes;
            byPaymentMethod.cash += (ogCash && Number(ogCash) < Number(Cash)) ? Number(ogCash) : Number(Cash);
            byPaymentMethod.card += Number(Card);
            byPaymentMethod.account += Number(Account);
        } else if (order.payment_mode === 'Cash') byPaymentMethod.cash += total;
        else if (order.payment_mode === 'Card') byPaymentMethod.card += total;
        else if (order.payment_mode === 'Account') byPaymentMethod.account += total;

        for (const [id, qty] of Object.entries(data.quantity || {})) {
            if (String(id).indexOf('quick') !== -1) continue; // ad-hoc line items, not a real menu item
            productIds.add(id);
            if (!itemTotals[id]) itemTotals[id] = { quantity: 0, revenue: 0 };
            itemTotals[id].quantity += Number(qty) || 0;
        }
    }

    const products = productIds.size
        ? await Item.query()
            .withGraphFetched('category(selectName)')
            .modifiers({ selectName(build) { build.select('name'); } })
            .whereIn('id', Array.from(productIds))
            .select(['id', 'name', 'price'])
        : [];
    const productMap = {};
    products.forEach((p) => { productMap[p.id] = p; });

    const byCategory = {};
    for (const order of paidOrders) {
        let data = null;
        try { data = order.data ? JSON.parse(order.data) : null; } catch { data = null; }
        if (!data) continue;
        for (const [id, qty] of Object.entries(data.quantity || {})) {
            const product = productMap[id];
            const lineRevenue = data.price?.[id] ?? (product ? product.price * qty : 0);
            if (String(id).indexOf('quick') !== -1) {
                byCategory.Others = (byCategory.Others || 0) + Number(data.otherAmount || lineRevenue || 0);
                continue;
            }
            if (!product) continue;
            const categoryName = product.category?.name || 'Uncategorized';
            byCategory[categoryName] = (byCategory[categoryName] || 0) + Number(lineRevenue || 0);
            if (itemTotals[id]) itemTotals[id].revenue += Number(lineRevenue || 0);
        }
    }

    const topItems = Object.entries(itemTotals)
        .map(([id, v]) => ({ id, name: productMap[id]?.name || `#${id}`, quantity: v.quantity, revenue: v.revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

    return {
        range: { from, to },
        totals: {
            revenue,
            orders: paidOrders.length,
            avgOrderValue: paidOrders.length ? revenue / paidOrders.length : 0,
            partialOrders: partialCount,
        },
        byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
        byCategory: Object.entries(byCategory).map(([category, amount]) => ({ category, revenue: amount })),
        byPaymentMethod,
        topItems,
    };
}

module.exports = { generateSalesReport };
