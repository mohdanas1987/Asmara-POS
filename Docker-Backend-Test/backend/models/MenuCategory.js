const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class MenuCategory extends TenantModel {
    static get tableName() {
        return 'menu_categories';
    }
    static get relationMappings() {
        const Item = require('./Item');
        return {
            products: {
                relation: Model.HasManyRelation,
                modelClass: Item,
                join: {
                    from: 'menu_categories.id',
                    to: 'menu_items.category_id',
                }
            }
        };
    }
}

module.exports = MenuCategory;
