const { Model } = require('objection');
const TenantModel = require('./TenantModel');

// STAGE 2b / phase 26 (Phase 1 local-dev pass): this model previously pointed at the
// 'reports' table (an apparent copy-paste of models/Report.js -- even its internal class
// name was left as `Report`) with a relation join missing its `to` column entirely
// (`join.to: ""`), which Objection can't resolve. In practice this meant
// `GET /tables/reservations` silently returned report rows mislabeled as reservations, and
// the relation itself would throw if anything ever tried to actually use it. Now points at
// a real `reservations` table (see migrations_local/0002_reservations_table.js -- and its
// equivalent still needs to be run against the live database once Phase 2 has access) with
// a correctly-qualified relation.
class Reservation extends TenantModel {
  static get tableName() {
    return 'reservations';
  }

  static get relationMappings() {
    const Table = require('./Table');
    return {
        table: {
            relation: Model.BelongsToOneRelation,
            modelClass: Table,
            join: {
                from: 'reservations.table_id',
                to: 'tables.id'
            }
        }
    };
  }
}

module.exports = Reservation;
