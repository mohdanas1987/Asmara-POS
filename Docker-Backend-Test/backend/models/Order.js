const { Model } = require('objection');
const TenantModel = require('./TenantModel');
const CashRegister = require('./CashRegister');
const { nanoid }= require('nanoid');

class Order extends TenantModel {

    static get tableName() {
        return 'orders'; // Corresponds to the table name in your database
    }

    async $beforeInsert() {
        this.id = nanoid(12); // generate UUID
        this.created_at = new Date().toISOString();
        this.updated_at = new Date().toISOString();
    }

    async $beforeUpdate() { 
        this.updated_at = new Date().toISOString();
    }
  
    static get relationMappings() {
        
        const Customer = require('./Customer');
        const User = require('./User');

        return {
            customer: {
                relation: Model.BelongsToOneRelation,
                modelClass: Customer,
                join: {
                    from: 'orders.customer_id',
                    to: 'customers.id',
                },
            },
            cashier: {
                relation: Model.BelongsToOneRelation,
                modelClass: User,
                join: {
                    from: 'orders.user_id',
                    to: 'users.id'
                }
            },
            register: {
                relation : Model.BelongsToOneRelation,
                modelClass: CashRegister,
                join: {
                    from: 'orders.cash_register_id',
                    to: "cash_register.id"
                }
            }
        };
    }
}

module.exports = Order;

