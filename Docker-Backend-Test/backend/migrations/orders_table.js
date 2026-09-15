const knex = require('knex');

exports.up = async function (knex) {

    // 	id	table_id	customer_id	amount	order_number	payment_mode	cash_register_id	user_id	created_at	updated_at
    await knex.schema.createTable('orders', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('(UUID())'));        
        table.bigInteger('table_id'); 
        table.bigInteger('customer_id').defaultTo(0); 
        table.decimal('amount',2).nullable();
        table.json('data').nullable();
        table.string('cash_register_id').nullable();
        table.string('payment_mode').defaultTo('cash');
        table.timestamps(true,true);
    });

};

exports.down = async function (knex) {
    // Drop the `users` table
    await knex.schema.dropTableIfExists('orders');
};

 