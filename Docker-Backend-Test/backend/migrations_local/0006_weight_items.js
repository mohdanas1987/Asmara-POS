// Adds weight-based pricing support to menu_items, for products sold by weight (produce,
// deli, bulk items, etc.) rather than by unit count. When sold_by_weight is true, `price`
// is interpreted as price-per-unit (e.g. per kg) rather than price-per-item; the POS
// multiplies it by a weight reading from a connected weighing scale (or a manually typed
// weight when no scale is connected) to get the line total.
exports.up = async function (knex) {
    await knex.schema.alterTable('menu_items', (table) => {
        table.boolean('sold_by_weight').notNullable().defaultTo(false);
        table.string('weight_unit').nullable().defaultTo('kg'); // 'kg' | 'g' | 'lb'
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable('menu_items', (table) => {
        table.dropColumn('sold_by_weight');
        table.dropColumn('weight_unit');
    });
};
