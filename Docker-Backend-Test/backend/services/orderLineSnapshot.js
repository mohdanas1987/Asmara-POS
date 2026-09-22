'use strict';
/**
 * Order line normalization, phase 1 (production-completion spec, section 7 + section 9).
 * See the file-header comment on migrations_local/0019_order_line_snapshots.js for the full
 * rationale: this writes an IMMUTABLE relational snapshot of an order's lines (and their
 * modifiers) into order_items/order_item_modifiers at the moment the order is actually
 * charged -- product name, SKU, unit price, VAT breakdown and modifier price deltas are all
 * captured as they were AT THAT MOMENT, so a later menu-price or modifier-price change can
 * never retroactively change what a historical receipt/report shows.
 *
 * Best-effort, exactly like this codebase's other non-critical side-effects (loyalty
 * earning, offline-sync recordChange, audit logging): a failure here must never stop a
 * payment from completing. The caller wraps this in try/catch.
 *
 * Idempotent per order: if this order already has snapshot rows (e.g. /create is called
 * more than once for the same order across a split/partial-payment flow), this is a no-op --
 * the FIRST charge is what "locks in" the immutable line snapshot, matching the real-world
 * moment the order's contents became a finalized sale rather than a still-editable draft.
 */
const Model = require('objection').Model;
function knex() {
  return Model.knex(); // same pattern as services/offline/syncLog.js and outbox.js
}
const { calculateInclusiveTax, calculateNetPrice, parsePrice } = require('../utils/tax');
const Item = require('../models/Item');

/**
 * @param {object} opts
 * @param {number|string} opts.tenantId
 * @param {string} opts.orderId
 * @param {Array<{itemId?: number|string, qty?: number, quantity?: number, modifiers?: Array<{name: string, price_delta?: number}>, course?: string, note?: string}>} opts.lines
 *   The order's per-line detail, i.e. the same `data.lines` shape the frontend already sends
 *   to /orders/to-kitchen (see RestaurantOS-Frontend/src/lib/api.ts's OrderLineDetail).
 * @param {Record<string, number>} [opts.fallbackQuantities]
 *   Used only when `lines` has no usable detail (older callers, or online/website orders
 *   that only ever populate the aggregate {productId: qty} map) -- still snapshots real
 *   rows, just without per-line modifier/course detail, which is strictly better than no
 *   normalized record at all.
 */
async function snapshotOrderLines({ tenantId, orderId, lines, fallbackQuantities }) {
  if (!tenantId || !orderId) return { skipped: true, reason: 'missing tenantId/orderId' };

  const db = knex();
  const existing = await db('order_items').where({ tenant_id: tenantId, order_id: orderId }).first();
  if (existing) return { skipped: true, reason: 'already snapshotted' };

  let normalizedLines = [];
  if (Array.isArray(lines) && lines.length > 0) {
    normalizedLines = lines
      .filter((l) => l && (l.itemId !== undefined && l.itemId !== null))
      .map((l) => ({
        productId: l.itemId,
        quantity: Number(l.qty ?? l.quantity ?? 1),
        modifiers: Array.isArray(l.modifiers) ? l.modifiers : [],
        course: l.course || null,
        note: l.note || null,
      }));
  } else if (fallbackQuantities && typeof fallbackQuantities === 'object') {
    normalizedLines = Object.entries(fallbackQuantities)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([productId, qty]) => ({ productId, quantity: Number(qty), modifiers: [], course: null, note: null }));
  }

  if (normalizedLines.length === 0) return { skipped: true, reason: 'no line detail to snapshot' };

  const productIds = [...new Set(normalizedLines.map((l) => l.productId).filter((id) => id !== undefined && id !== null))];
  const products = productIds.length > 0
    ? await Item.query().where('tenant_id', tenantId).whereIn('id', productIds)
    : [];
  const productById = new Map(products.map((p) => [String(p.id), p]));

  const now = new Date().toISOString();
  const rows = [];
  const modifierRowsByLineIndex = [];

  normalizedLines.forEach((line, index) => {
    const product = productById.get(String(line.productId));
    const unitPriceGross = product ? parsePrice(product.price) : 0;
    const vatRateRaw = product ? product.tax : null;
    const modifierDelta = (line.modifiers || []).reduce((sum, m) => sum + (Number(m && m.price_delta) || 0), 0);
    const effectiveUnitPriceGross = unitPriceGross + modifierDelta;
    const quantity = line.quantity;
    const grossAmount = effectiveUnitPriceGross * quantity;
    const vatAmount = product ? calculateInclusiveTax(effectiveUnitPriceGross, vatRateRaw) * quantity : 0;
    const netAmount = grossAmount - vatAmount;

    rows.push({
      tenant_id: tenantId,
      order_id: orderId,
      line_index: index,
      product_id: product ? product.id : null,
      product_name: product ? product.name : `Item #${line.productId ?? 'unknown'}`,
      sku: product ? (product.code || null) : null,
      quantity,
      unit_price_gross: effectiveUnitPriceGross,
      vat_rate: product ? (parseFloat(String(vatRateRaw).match(/[\d.]+/)?.[0] || '0') || null) : null,
      net_amount: netAmount,
      vat_amount: vatAmount,
      gross_amount: grossAmount,
      course: line.course,
      note: line.note,
      created_at: now,
    });
    modifierRowsByLineIndex.push(line.modifiers || []);
  });

  const insertedIds = await db('order_items').insert(rows).returning('id');
  // sqlite/mysql don't all support RETURNING the same way -- fall back to re-querying the
  // rows we just inserted by (tenant_id, order_id, line_index), which is a stable enough key
  // for this immediately-after-insert lookup.
  let orderItemIdByLineIndex;
  if (Array.isArray(insertedIds) && insertedIds.length === rows.length && typeof insertedIds[0] !== 'object') {
    orderItemIdByLineIndex = rows.map((_, i) => insertedIds[0] + i);
  } else {
    const justInserted = await db('order_items').where({ tenant_id: tenantId, order_id: orderId }).orderBy('line_index', 'asc');
    orderItemIdByLineIndex = justInserted.map((r) => r.id);
  }

  const modifierRows = [];
  modifierRowsByLineIndex.forEach((mods, index) => {
    const orderItemId = orderItemIdByLineIndex[index];
    if (!orderItemId) return;
    mods.forEach((m) => {
      if (!m || !m.name) return;
      modifierRows.push({
        order_item_id: orderItemId,
        modifier_name: m.name,
        price_delta: Number(m.price_delta) || 0,
        created_at: now,
      });
    });
  });
  if (modifierRows.length > 0) {
    await db('order_item_modifiers').insert(modifierRows);
  }

  return { skipped: false, lineCount: rows.length, modifierCount: modifierRows.length };
}

module.exports = { snapshotOrderLines };
