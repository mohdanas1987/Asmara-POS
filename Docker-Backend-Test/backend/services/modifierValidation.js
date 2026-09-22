'use strict';
/**
 * Server-side modifier validation (CTO forensic audit 2026-09-21, "Modifier authorization/
 * validation is client-heavy"). Until this file existed, `ItemModifierPicker.tsx` enforced
 * required/min/max/single-vs-multiple client-side, and price_delta came straight from
 * whatever the browser sent -- a buggy or malicious client could submit a modifier that
 * doesn't belong to the item, doesn't belong to this tenant, or an inflated/zeroed
 * price_delta, and the backend would happily store and print it. Frontend validation is UX;
 * this is the actual business-rule enforcement, run once here so every caller of
 * POST /orders/to-kitchen (direct sale and table order alike) gets it for free.
 */
const ModifierGroup = require('../models/ModifierGroup');

class ModifierValidationError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

/**
 * Validates and re-prices `lines` (the POS's own `data.lines` detail -- see lib/api.ts's
 * OrderLineDetail) against this tenant's real modifier configuration. Returns a NEW array
 * with each line's `modifiers` replaced by server-trusted {id, name, price_delta} objects --
 * price_delta is always taken from the database, never from the client, so a tampered value
 * in the request can never reach the order, the kitchen ticket, or the receipt.
 *
 * Throws ModifierValidationError (statusCode 400) on any line that:
 *  - references a modifier id that doesn't exist, or doesn't belong to this item/tenant
 *  - selects more than one option in a 'single' group
 *  - selects fewer than a group's min_select, or more than its max_select
 *  - leaves a `required` group with zero selections
 *
 * A line with no `modifiers` at all is untouched and always valid -- this only ever
 * activates for lines that actually carry a selection, so a plain item's request shape is
 * byte-for-byte unaffected by this validation existing.
 */
async function validateAndPriceLines({ tenantId, lines }) {
  if (!Array.isArray(lines) || lines.length === 0) return lines;

  const itemIds = [...new Set(lines.map((l) => l && l.itemId).filter((id) => id !== undefined && id !== null))];
  const groupsByItemId = new Map();
  for (const itemId of itemIds) {
    // eslint-disable-next-line no-await-in-loop
    const groups = await ModifierGroup.forTenant(tenantId)
      .where('menu_item_id', itemId)
      .withGraphFetched('modifiers');
    groupsByItemId.set(String(itemId), groups);
  }

  return lines.map((line) => {
    if (!line || !Array.isArray(line.modifiers) || line.modifiers.length === 0) return line;

    const groups = groupsByItemId.get(String(line.itemId)) || [];
    const modifierById = new Map();
    for (const group of groups) {
      for (const modifier of group.modifiers || []) {
        modifierById.set(String(modifier.id), { modifier, group });
      }
    }

    const selectedByGroup = new Map(); // groupId -> count
    const repriced = [];
    for (const submitted of line.modifiers) {
      const found = submitted && modifierById.get(String(submitted.id));
      if (!found) {
        throw new ModifierValidationError(
          `Modifier id ${submitted && submitted.id} does not belong to item ${line.itemId} for this tenant.`
        );
      }
      const { modifier, group } = found;
      selectedByGroup.set(group.id, (selectedByGroup.get(group.id) || 0) + 1);
      // Server truth, always -- the client's own name/price_delta is discarded entirely,
      // not merely double-checked, so there is no path by which a tampered price survives.
      repriced.push({ id: modifier.id, name: modifier.name, price_delta: Number(modifier.price_delta) || 0 });
    }

    for (const group of groups) {
      const selectedCount = selectedByGroup.get(group.id) || 0;
      if (group.selection_type === 'single' && selectedCount > 1) {
        throw new ModifierValidationError(`Group "${group.name}" only allows one selection.`);
      }
      if (group.max_select != null && selectedCount > group.max_select) {
        throw new ModifierValidationError(`Group "${group.name}" allows at most ${group.max_select} selection(s).`);
      }
      if (group.min_select && selectedCount > 0 && selectedCount < group.min_select) {
        throw new ModifierValidationError(`Group "${group.name}" requires at least ${group.min_select} selection(s).`);
      }
      if (group.required && selectedCount < Math.max(1, group.min_select || 1)) {
        throw new ModifierValidationError(`Group "${group.name}" is required.`);
      }
    }

    return { ...line, modifiers: repriced };
  });
}

module.exports = { validateAndPriceLines, ModifierValidationError };
