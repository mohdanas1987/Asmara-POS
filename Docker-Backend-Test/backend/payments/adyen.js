/**
 * Adyen. Real integration shape: local card-present payments go through Adyen's Terminal API
 * (a nexo/JSON protocol sent either over the local network directly to the terminal, or
 * relayed through Adyen's cloud "Terminal API - Cloud" using the terminal's POI id). The
 * cloud path is what's implemented here -- it needs no local network discovery of the
 * terminal's IP, just its configured POI id, which is simpler and more reliable for a
 * restaurant network than raw local nexo sockets.
 */
function getClient(settings) {
    let Adyen;
    try {
        Adyen = require('@adyen/api-library');
    } catch {
        throw new Error('The "@adyen/api-library" package is not installed. Run `npm install @adyen/api-library` to enable Adyen.');
    }
    if (!settings?.api_key || !settings?.terminal_id) {
        throw new Error('Adyen is not configured: missing an API key or a terminal (POI) id.');
    }
    const client = new Adyen.Client({ apiKey: settings.api_key, environment: 'TEST' });
    return new Adyen.TerminalCloudAPI(client);
}

function isConfigured(settings) {
    return !!(settings?.provider === 'adyen' && settings?.api_key && settings?.terminal_id);
}

async function createTerminalPayment(settings, { amount, currency = 'EUR', orderId }) {
    const terminalApi = getClient(settings);
    const request = {
        SaleToPOIRequest: {
            MessageHeader: {
                MessageType: 'Request',
                MessageClass: 'Service',
                MessageCategory: 'Payment',
                SaleID: 'RestaurantOS',
                ServiceID: String(Date.now()),
                POIID: settings.terminal_id,
            },
            PaymentRequest: {
                SaleData: { SaleTransactionID: { TransactionID: orderId, TimeStamp: new Date().toISOString() } },
                PaymentTransaction: { AmountsReq: { Currency: currency, RequestedAmount: amount } },
            },
        },
    };
    const response = await terminalApi.sync(request);
    return { id: orderId, status: response?.SaleToPOIResponse?.PaymentResponse?.Response?.Result ?? 'unknown' };
}

async function checkStatus() {
    // Adyen's Terminal API is synchronous request/response (the sync() call above already
    // returns the outcome) -- there is no separate polling endpoint the way Stripe/Mollie have.
    throw new Error('Adyen Terminal API payments resolve synchronously; there is no separate status check.');
}

module.exports = { isConfigured, createTerminalPayment, checkStatus };
