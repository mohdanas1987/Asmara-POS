const { Model } = require('objection');

class Application extends Model {
  static get tableName() {
    return 'applications'; // Corresponds to the table name in your database
  }
  static get relationMappings() {
        const User = require('./User');
        return {
            application: {
                relation: Model.HasOneRelation,
                modelClass: User,
                join: {
                    from: 'applications.phone',
                    to: 'users.phone',
                },
            },
        };
    }
}

module.exports = Application;
