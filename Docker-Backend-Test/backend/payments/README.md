# Payment terminal adapters

Every adapter exports the same shape: `isConfigured(settings)`, `createTerminalPayment(settings, { amount, currency, orderId })`, `checkStatus(settings, paymentId)`. `routes/payments.js` picks the adapter by `settings.provider` and never talks to a provider SDK directly.

None of these have been exercised against a real account, a real terminal, or real
credentials — there are none available in this environment. Each is written against that
provider's real, documented integration shape, and each fails with a clear, specific error
(not a fake success) when the SDK package isn't installed or credentials aren't set. That's
the honest state until someone with a real account and a real terminal tests it.
