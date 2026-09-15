const { Model } = require('objection');

// Phase 1 / Task #10 (multi-tenant schema foundation): every model representing
// restaurant-scoped data (as opposed to a handful of tables that stay global -- see the
// 0003_multitenancy migration for exactly which) extends this instead of Objection's
// `Model` directly, so tenant-scoping a query is one call instead of a hand-typed
// `.where('tenant_id', ...)` that's easy to forget on any one route.
//
// This does NOT automatically scope every query -- Objection has no safe global hook for
// "always add this where clause" that also works correctly with relations, transactions and
// inserts, and a fake sense of automatic safety would be worse than an explicit one. Instead,
// every route that reads or writes tenant-scoped data is expected to call `.forTenant(id)`
// (for reads) or set `tenant_id` explicitly (for inserts) -- exactly like every route already
// explicitly filters on `user_id` for cashier-level scoping today. See routes/*.js.
class TenantModel extends Model {
    /**
     * Start a query already scoped to one tenant. Equivalent to
     * `Model.query().where('tenant_id', tenantId)`, but named for what it means.
     */
    static forTenant(tenantId) {
        return this.query().where(`${this.tableName}.tenant_id`, tenantId);
    }
}

module.exports = TenantModel;
