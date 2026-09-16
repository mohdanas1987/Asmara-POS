'use strict';
/**
 * Table performance report (task #38). Never built anywhere in the app before -- answers
 * "which tables actually earn their keep": revenue and order volume per table, average
 * order value, and average turnover time (how long a table stays occupied per order, from
 * `created_at` to `updated_at` on a completed order).
 *
 * Orders group by the EXACT value of `orders.tables` (e.g. "3" or the merged-table combo
 * "1+2" written by routes/tables.js's merge action) rather than exploding a merged combo
 * across its member tables. Splitting a merged order's revenue across members would need an
 * arbitrary allocation rule (evenly? by capacity?) that isn't specified anywhere and would
 * silently invent numbers; showing "Table 1+2" as its own row is the honest representation
 * of what actually happened on the floor.
 */
const Order = require('../../models/Order');
const Table = require('../../models/Table');

function toDateOnly(d) {
    return d.toISOString().slice(0, 10);
}

/**
 * @param {number} tenantId
 * @param {{from?: string, to?: string}} range - inclusive date-only bounds (YYYY-MM-DD),
 *   defaulting to the trailing 30 days for the same reason salesReport.js does.
 */
async function generateTablePerformanceReport(tenantId, range = {}) {
    const today = new Date();
    const defaultTo = toDateOnly(today);
    const defaultFrom = toDateOnly(new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000));

    const from = range.from || defaultFrom;
    const to = range.to || defaultTo;
    const toExclusiveBound = `${to}T23:59:59.999Z`;
    const fromInclusiveBound = `${from}T00:00:00.000Z`;

    const orders = await Order.query()
        .where('tenant_id', tenantId)
        .where('payment_status', 'paid')
        .whereNotNull('tables')
        .where('created_at', '>=', fromInclusiveBound)
        .where('created_at', '<=', toExclusiveBound)
        .select(['tables', 'total', 'created_at', 'updated_at']);

    const groups = {}; // tables string -> stats
    for (const order of orders) {
        const key = order.tables;
        if (!key) continue;
        if (!groups[key]) {
            groups[key] = { tables: key, orders: 0, revenue: 0, totalDurationMinutes: 0, durationSamples: 0, lastUsed: null };
        }
        const g = groups[key];
        g.orders += 1;
        g.revenue += Number(order.total) || 0;

        const start = new Date(order.created_at).getTime();
        const end = new Date(order.updated_at).getTime();
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
            g.totalDurationMinutes += (end - start) / 60000;
            g.durationSamples += 1;
        }
        if (!g.lastUsed || order.created_at > g.lastUsed) g.lastUsed = order.created_at;
    }

    // Table metadata (capacity/section) for single, non-merged tables -- a merged combo like
    // "1+2" has no single row in `tables` to join against, so it's left without capacity/
    // section rather than guessing.
    const singleTableNumbers = Object.keys(groups).filter((k) => !String(k).includes('+'));
    const tableRows = singleTableNumbers.length
        ? await Table.query().where('tenant_id', tenantId).whereIn('table_number', singleTableNumbers)
            .select(['table_number', 'capacity', 'section'])
        : [];
    const tableMeta = {};
    tableRows.forEach((t) => { tableMeta[t.table_number] = { capacity: t.capacity, section: t.section }; });

    const performance = Object.values(groups).map((g) => ({
        table: g.tables,
        capacity: tableMeta[g.tables]?.capacity ?? null,
        section: tableMeta[g.tables]?.section ?? null,
        orders: g.orders,
        revenue: g.revenue,
        avgOrderValue: g.orders ? g.revenue / g.orders : 0,
        avgTurnoverMinutes: g.durationSamples ? g.totalDurationMinutes / g.durationSamples : null,
        lastUsed: g.lastUsed,
    })).sort((a, b) => b.revenue - a.revenue);

    // Tables that had zero paid orders in range are just as useful to see (an idle table is
    // a real signal), so list every known table for the tenant and merge in zeroes.
    const allTables = await Table.query().where('tenant_id', tenantId).select(['table_number', 'capacity', 'section']);
    const seen = new Set(performance.map((p) => p.table));
    for (const t of allTables) {
        if (seen.has(t.table_number)) continue;
        performance.push({
            table: t.table_number,
            capacity: t.capacity ?? null,
            section: t.section ?? null,
            orders: 0,
            revenue: 0,
            avgOrderValue: 0,
            avgTurnoverMinutes: null,
            lastUsed: null,
        });
    }

    return { range: { from, to }, tables: performance };
}

module.exports = { generateTablePerformanceReport };
