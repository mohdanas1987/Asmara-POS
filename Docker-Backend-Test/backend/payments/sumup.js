/**
 * SumUp. Unlike Stripe/Adyen, SumUp has no widely-used official Node.js SDK -- integration is
 * a plain REST API call (OAuth token + HTTPS requests), so this talks to it directly rather
 * than wrapping a library. SumUp's reader-checkout flow works by creating a checkout and
 * sending it to a specific paired reader id, which then confirms/declines asynchronously.
 *
 * CAVEAT, stated plainly rather than glossed over: SumUp's exact endpoint paths/fields can
 * and do change, and there is no SumUp account or reader available to confirm this against
 * their current live API. This follows their documented REST shape as of this project's
 * knowledge, but it MUST be checked against SumUp's current developer docs before relying on
 * it with a real reader -- this is the one adapter of the four with the least certainty.
 */
function requireConfig(settings) {
    if (!settings?.api_key || !settings?.terminal_id) {
        throw new Error('SumUp is not configured: missing an API key (OAuth token) or a paired reader id.');
    }
}

function isConfigured(settings) {
    return !!(settings?.provider === 'sumup' && settings?.api_key && settings?.terminal_id);
}

async function createTerminalPayment(settings, { amount, currency = 'EUR' }) {
    requireConfig(settings);
    const res = await fetch(`https://api.sumup.com/v0.1/merchants/readers/${settings.terminal_id}/checkout`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${settings.api_key}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            total_amount: { value: Math.round(amount * 100), currency, minor_unit: 2 },
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`SumUp reader checkout failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return { id: data.data?.client_transaction_id ?? data.id, status: data.status ?? 'pending' };
}

async function checkStatus(settings, paymentId) {
    requireConfig(settings);
    const res = await fetch(`https://api.sumup.com/v0.1/me/transactions?id=${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Bearer ${settings.api_key}` },
    });
    if (!res.ok) throw new Error(`SumUp status check failed (${res.status})`);
    const data = await res.json();
    return { id: paymentId, status: data.status ?? 'unknown' };
}

module.exports = { isConfigured, createTerminalPayment, checkStatus };
