'use strict';
/**
 * Server-authoritative financial totals (CTO doc "Asmara POS -- Remaining Work Only", Phase 24
 * -- "the backend currently trusts client-provided totals too much... SERVER CALCULATES
 * TOTAL", with client total used only for comparison").
 *
 * GROUND TRUTH established before writing this (see routes/orders.js's POST /orders/create,
 * before this file existed): the charge endpoint took `req.body.total` and the `charges`/
 * `data` payload completely at face value -- there was zero server-side recomputation from
 * the order's actual line items, current product prices, or modifier configuration. A
 * tampered `total` in the checkout request was recorded into the payment ledger exactly as
 * sent. That is a real-money gap, not a cosmetic one.
 *
 * This module recomputes an order's authoritative total the SAME way the frontend cart
 * (RestaurantOS-Frontend/src/lib/hooks/useCart.ts's `subtotal`/`total`) computes it, but from
 * server-trusted inputs only: current DB product price (never the client's) multiplied by
 * quantity, plus each line's already-server-validated modifier price deltas (see the trust-
 * boundary note on computeAuthoritativeTotal below for why those are read as-stored rather
 * than re-derived a second time here), summed across lines. Prices in this app are already
 * VAT-inclusive (utils/tax.js's own header comment, confirmed
 * against the actual checkout code, which never adds a tax amount on top) so nothing is added
 * for tax here either -- the line total IS the charge amount. There is no discount mechanism
 * anywhere in this codebase (confirmed by search: no `discount` field is read or written by
 * any order route), so none is modeled here -- if one is added later, it must be added here
 * too, deliberately, not silently bypassed.
 *
 * KNOWN, DELIBERATE, DOCUMENTED LIMITATION -- read before "fixing" this to be stricter:
 * weight-sold items (`menu_items.sold_by_weight`, migration 0006) are pricable only from a
 * weight READING (grams/kg the item was weighed at), and that reading is not reliably
 * available here. The table-order "send to kitchen" flow (pos/page.tsx's handleSendToKitchen)
 * never sends a weight map to the backend AT ALL -- only the direct-sale flow does
 * (sendDirectSaleToKitchen's `weights` param), and even there it is stored on `order.data`
 * purely for receipt display, never in a form this module can safely trust as the actual
 * charged quantity for a specific line. Rather than guess (and risk rejecting, or worse
 * silently under/over-charging, a legitimate weighed sale), this module marks the order as
 * NOT VERIFIABLE when it contains any weight-sold item and the caller must treat that as
 * "cannot confirm, don't reject" -- exactly the same posture the existing
 * `/orders/:order/bill-split/preview` route already takes for its own known-legitimate
 * mismatch case (a manual adjustment/tip on an already-charged order), never a silent pass
 * dressed up as a real check. Closing this gap for real requires the weight reading to travel
 * through `data.lines` as a first-class field end-to-end (frontend cart -> outbox -> backend),
 * which is a bigger frontend contract change than this slice -- tracked, not hidden.
 */
const Item = require('../models/Item');
const { parsePrice } = require('../utils/tax');

const ROUNDING_TOLERANCE_CENTS = 2; // guards against float noise across many summed lines

function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

/**
 * @param {object} opts
 * @param {number|string} opts.tenantId
 * @param {Array<{itemId?: number|string, qty?: number, modifiers?: Array<{id:number|string}>}>} [opts.lines]
 *   The order's per-line modifier detail -- see snapshotOrderLines's own header comment for the
 *   shape. Today the frontend only populates this for lines that actually carry a modifier
 *   selection (pos/page.tsx's buildLineDetail) -- every OTHER item's quantity lives only in
 *   `quantity` below, which is why both are required to get a complete, non-double-counted
 *   picture of the order.
 * @param {Record<string, number>} [opts.quantity] The order's flat {productId: totalQty} map
 *   (order.data's `quantity`, exactly as stored by /orders/to-kitchen) -- includes the
 *   quantity of items that ALSO appear in `lines` (a modifier selection never removes an item
 *   from this aggregate map), so callers must not sum both directly.
 * @returns {Promise<{ verifiable: true, total: number } | { verifiable: false, reason: string }>}
 */
async function computeAuthoritativeTotal({ tenantId, lines, quantity }) {
  const safeLines = Array.isArray(lines) ? lines.filter((l) => l && l.itemId !== undefined && l.itemId !== null) : [];
  const safeQuantity = quantity && typeof quantity === 'object' ? quantity : {};

  const allItemIds = new Set([
    ...safeLines.map((l) => String(l.itemId)),
    ...Object.keys(safeQuantity),
  ]);
  if (allItemIds.size === 0) {
    return { verifiable: false, reason: 'no line or quantity detail to recompute from' };
  }

  const products = await Item.query().where('tenant_id', tenantId).whereIn('id', [...allItemIds]);
  const productById = new Map(products.map((p) => [String(p.id), p]));

  for (const id of allItemIds) {
    if (!productById.has(String(id))) {
      // A product referenced by the order no longer exists (deleted after the order was
      // rung up) -- nothing trustworthy to recompute against; do not guess.
      return { verifiable: false, reason: `product ${id} referenced by this order no longer exists` };
    }
  }

  for (const id of allItemIds) {
    if (productById.get(String(id)).sold_by_weight) {
      return { verifiable: false, reason: 'order contains one or more weight-sold items; see this module\'s header comment' };
    }
  }

  // NOTE on trust boundary: `safeLines` is NOT the client's /create request body -- it is
  // `preChargeLines`, read back from THIS order's own `orders.data` column exactly as it was
  // already persisted by POST /orders/to-kitchen. That route runs every submitted line's
  // modifiers through validateAndPriceLines(...) BEFORE ever saving them (see
  // modifierValidation.js), so a tampered price_delta can never have reached the database in
  // the first place -- re-validating it again here would just be re-deriving the same trusted
  // number a second time, and would additionally require a modifier `id` on every stored line
  // that some callers (older data, tests seeding orders directly) never populated. The actual
  // thing THIS function defends against -- a tampered `total` in the /create request itself,
  // or a stale/incorrect PRODUCT price -- is handled below by always re-fetching the product
  // price from the database, never from anything the client just sent.
  let totalCents = 0;
  const qtyAccountedForByLines = new Map(); // itemId -> qty already priced via `lines`

  for (const line of safeLines) {
    const product = productById.get(String(line.itemId));
    const qty = Number(line.qty ?? 1);
    const unitPrice = parsePrice(product.price);
    const modifierDelta = (line.modifiers || []).reduce((sum, m) => sum + (Number(m.price_delta) || 0), 0);
    totalCents += toCents((unitPrice + modifierDelta) * qty);
    qtyAccountedForByLines.set(String(line.itemId), (qtyAccountedForByLines.get(String(line.itemId)) || 0) + qty);
  }

  for (const [itemId, rawQty] of Object.entries(safeQuantity)) {
    const product = productById.get(String(itemId));
    if (!product) continue; // already validated above; defensive only
    const qty = Number(rawQty) || 0;
    const remainingQty = qty - (qtyAccountedForByLines.get(String(itemId)) || 0);
    if (remainingQty <= 0) continue; // fully accounted for by a modifier-priced line already
    totalCents += toCents(parsePrice(product.price) * remainingQty);
  }

  return { verifiable: true, total: totalCents / 100 };
}

module.exports = { computeAuthoritativeTotal, ROUNDING_TOLERANCE_CENTS, toCents };
