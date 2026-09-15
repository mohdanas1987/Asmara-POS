/**
 * LOCAL DEV SEED — Phase 1. Populates the reconstructed local SQLite schema with enough
 * realistic test data to actually exercise login, the POS screen, and the table-transfer
 * feature end to end. Not used by the real app in any way.
 */
const bcrypt = require('bcrypt');

exports.seed = async function (knex) {
    // Clean slate, in FK-safe-ish order (no real FK constraints in this schema, but tidy)
    await knex('orders').del();
    await knex('menu_items').del();
    await knex('menu_categories').del();
    await knex('taxes').del();
    await knex('tables').del();
    await knex('cash_register').del();
    await knex('users').del();

    const salt = await bcrypt.genSalt(8);
    const password = await bcrypt.hash('Test1234!', salt);

    const [userId] = await knex('users').insert({
        name: 'Test Admin',
        email: 'admin@test.local',
        password,
        type: 'admin',
        status: true
    });

    await knex('tables').insert([
        { table_number: '1', status: 'free', x: 0, y: 0, length: 80, width: 80 },
        { table_number: '2', status: 'free', x: 100, y: 0, length: 80, width: 80 },
        { table_number: '3', status: 'occupied', x: 200, y: 0, length: 80, width: 80 }
    ]);

    const [taxId] = await knex('taxes').insert({ name: 'VAT 9%', amount: '9', status: true, user_id: userId });

    const [catId] = await knex('menu_categories').insert({ name: 'Starters', color: '#e07a5f', status: true, sq_pos: 1 });

    await knex('menu_items').insert([
        { name: 'Sambusa', price: '4.50', category_id: catId, tax: String(taxId), stock: 50, quantity: 50, pos: true, deleted: false, code: 'SAM001', seq: 1 },
        { name: 'Injera Platter', price: '9.00', category_id: catId, tax: String(taxId), stock: 30, quantity: 30, pos: true, deleted: false, code: 'INJ001', seq: 2 }
    ]);

    // An "active order" on table 3, matching the shape routes/tables.js's /transfer expects
    // (Order.id is a nanoid string, normally set by the model's $beforeInsert -- inserted
    // directly here for the seed instead of importing the Objection model).
    await knex('orders').insert({
        id: 'seed_order_001',
        tables: '3',
        status: 'ongoing',
        payment_status: 'pending',
        data: JSON.stringify({ quantity: {} }),
        total: 13.50,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    console.log('Seed complete. Login with admin@test.local / Test1234!');
};
