/**
 * Mollie. Mollie is primarily known for redirect-based online payments, but also offers a
 * Terminal API for physical card readers, aimed at exactly this use case (in-person POS).
 * Uses the official `@mollie/api-client` package. A payment is created with `method:
 * "pointofsale"` and a `terminalId`, and Mollie pushes the result to the terminal directly.
 */
function getClient(settings) {
    let createMollieClient;
    try {
        ({ createMollieClient } = require('@mollie/api-client'));
    } catch {
        throw new Error('The "@mollie/api-client" package is not installed. Run `npm install @mollie/api-client` to enable Mollie.');
    }
    if (!settings?.api_key || !settings?.terminal_id) {
        throw new Error('Mollie is not configured: missing an API key or a terminal id.');
    }
    return createMollieClient({ apiKey: settings.api_key });
}

function isConfigured(settings) {
    return !!(settings?.provider === 'mollie' && settings?.api_key && settings?.terminal_id);
}

async function createTerminalPayment(settings, { amount, currency = 'EUR', orderId }) {
    const mollie = getClient(settings);
    const payment = await mollie.payments.create({
        amount: { currency, value: amount.toFixed(2) },
        description: `RestaurantOS order ${orderId}`,
        method: 'pointofsale',
        terminalId: settings.terminal_id,
    });
    return { id: payment.id, status: payment.status };
}

async function checkStatus(settings, paymentId) {
    const mollie = getClient(settings);
    const payment = await mollie.payments.get(paymentId);
    return { id: payment.id, status: payment.status };
}

module.exports = { isConfigured, createTerminalPayment, checkStatus };
