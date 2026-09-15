const TenantModel = require('./TenantModel');

class WebsiteConnection extends TenantModel {
    static get tableName() {
        return 'website_connections';
    }
}

module.exports = WebsiteConnection;
