const { Model } = require('objection');

// One row per tenant's platform subscription. Deliberately a plain Model, not a TenantModel:
// super-admin routes read/write these across every tenant by design (that's the whole point
// of a platform billing view), so an opt-in `.forTenant()` helper would be unused dead code
// here -- every access already filters by `tenant_id` explicitly where it matters (a
// restaurant's own settings screen, if one is later added, would do that filtering itself).
class Subscription extends Model {
    static get tableName() {
        return 'subscriptions';
    }

    static get relationMappings() {
        // Lazy require to avoid circular require issues at module-load time.
        const Plan = require('./Plan');
        const PaymentProvider = require('./PaymentProvider');
        return {
            plan: {
                relation: Model.BelongsToOneRelation,
                modelClass: Plan,
                join: { from: 'subscriptions.plan_id', to: 'plans.id' },
            },
            paymentProvider: {
                relation: Model.BelongsToOneRelation,
                modelClass: PaymentProvider,
                join: { from: 'subscriptions.payment_provider_id', to: 'payment_providers.id' },
            },
        };
    }
}

module.exports = Subscription;
