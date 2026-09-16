const { Model } = require('objection');
const TenantModel = require('./TenantModel');

class ModifierGroup extends TenantModel {
    static get tableName() {
        return 'modifier_groups';
    }

    static get relationMappings() {
        const Modifier = require('./Modifier');
        return {
            modifiers: {
                relation: Model.HasManyRelation,
                modelClass: Modifier,
                join: {
                    from: 'modifier_groups.id',
                    to: 'modifiers.modifier_group_id',
                },
            },
        };
    }
}

module.exports = ModifierGroup;
