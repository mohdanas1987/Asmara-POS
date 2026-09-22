/**
 * Mock terminal adapter -- a real, always-available provider (no external SDK, no network
 * call) for staff training, demoing the checkout flow, and automated testing of the payment
 * state machine (services/payments/paymentAttempts.js) without a real card reader. Connect it
 * from Settings the same way as any real provider (`provider: "mock"`), no api_key needed.
 *
 * Its behavior is controlled entirely by `settings.mock_behavior` so tests (and a trainer
 * demoing "what happens if a card gets declined") can force every state the real adapters can
 * end up in: 'succeed' (default) resolves immediately as captured; 'decline' throws a
 * provider-style decline; 'pending' returns a payment that only resolves to 'paid' on a
 * follow-up checkStatus() call, mirroring a provider whose physical tap/insert happens after
 * the initial API call returns; 'timeout' throws to simulate the request to the provider
 * itself failing outright (a real network drop), never even returning a payment id.
 */
function isConfigured(settings) {
    return settings?.provider === 'mock';
}

async function createTerminalPayment(settings, { amount, currency = 'eur', orderId }) {
    const behavior = settings?.mock_behavior || 'succeed';
    const id = `mock_${orderId}_${Date.now()}`;

    if (behavior === 'timeout') {
        throw new Error('Mock provider: simulated network failure -- no response from terminal.');
    }
    if (behavior === 'decline') {
        throw new Error('Mock provider: card declined.');
    }
    if (behavior === 'pending') {
        return { id, status: 'pending' };
    }
    return { id, status: 'succeeded' };
}

async function checkStatus(settings, paymentId) {
    const behavior = settings?.mock_behavior || 'succeed';
    if (behavior === 'pending') {
        // A reconcile check "resolves" a pending mock payment to captured -- lets tests (and
        // a trainer) exercise the full initiated -> pending -> reconciled -> succeeded path.
        return { id: paymentId, status: 'succeeded' };
    }
    return { id: paymentId, status: behavior === 'decline' ? 'failed' : 'succeeded' };
}

module.exports = { isConfigured, createTerminalPayment, checkStatus };
