/**
 * Stripe Terminal. Real integration shape: the backend creates a "connection token" via the
 * `stripe` SDK, the terminal-facing client (renderer process, via @stripe/terminal-js) uses
 * that token to discover/connect to a physical reader and collect payment, then the backend
 * creates a PaymentIntent and confirms it against that reader. This module only covers the
 * backend half (connection tokens + PaymentIntents) -- the reader-discovery half belongs in
 * the desktop app's renderer, not here, since it needs direct access to the physical reader.
 */
function getClient(settings) {
    let Stripe;
    try {
        Stripe = require('stripe');
    } catch {
        throw new Error('The "stripe" package is not installed. Run `npm install stripe` to enable Stripe Terminal.');
    }
    if (!settings?.api_key) {
        throw new Error('Stripe is not configured: missing a secret API key.');
    }
    return new Stripe(settings.api_key);
}

function isConfigured(settings) {
    return !!(settings?.provider === 'stripe' && settings?.api_key);
}

async function createConnectionToken(settings) {
    const stripe = getClient(settings);
    const token = await stripe.terminal.connectionTokens.create();
    return token.secret;
}

async function createTerminalPayment(settings, { amount, currency = 'eur' }) {
    const stripe = getClient(settings);
    // Amount in the smallest currency unit (cents), per Stripe's convention.
    const intent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency,
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
    });
    return { id: intent.id, status: intent.status };
}

async function checkStatus(settings, paymentId) {
    const stripe = getClient(settings);
    const intent = await stripe.paymentIntents.retrieve(paymentId);
    return { id: intent.id, status: intent.status };
}

module.exports = { isConfigured, createConnectionToken, createTerminalPayment, checkStatus };
