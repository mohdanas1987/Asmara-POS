'use client';

import { useState } from 'react';
import { usePaymentStatus } from '@/lib/hooks/usePaymentStatus';
import { PaymentProvider } from '@/lib/types';
import { Button } from '@/components/ui/Button';

const PROVIDERS: { value: PaymentProvider; label: string; needsTerminalId: boolean }[] = [
  { value: 'stripe', label: 'Stripe Terminal', needsTerminalId: false },
  { value: 'adyen', label: 'Adyen', needsTerminalId: true },
  { value: 'sumup', label: 'SumUp', needsTerminalId: true },
  { value: 'mollie', label: 'Mollie', needsTerminalId: true },
];

export default function PaymentsSettingsPage() {
  const { data, loading, error, connect, disconnect } = usePaymentStatus();
  const [provider, setProvider] = useState<PaymentProvider>('stripe');
  const [apiKey, setApiKey] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedMeta = PROVIDERS.find((p) => p.value === provider)!;

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await connect(provider, apiKey, terminalId);
      setApiKey('');
      setTerminalId('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">Payment terminal</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Connect a card payment provider. Supported: Stripe Terminal, Adyen, SumUp, Mollie.
      </p>

      {loading && <p className="text-neutral-400">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && data && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${data.connected ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
            <span className="font-medium text-neutral-900">
              {data.connected ? `Connected — ${data.provider}` : 'Not connected'}
            </span>
          </div>

          {data.connected ? (
            <>
              <p className="text-sm text-neutral-600">API key: <span className="font-mono">{data.api_key_masked}</span></p>
              {data.terminal_id && <p className="text-sm text-neutral-600">Terminal id: <span className="font-mono">{data.terminal_id}</span></p>}
              <Button variant="danger" className="mt-4" onClick={disconnect} disabled={busy}>
                Disconnect
              </Button>
            </>
          ) : (
            <form onSubmit={handleConnect} className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setProvider(p.value)}
                    className={`rounded-lg border-2 py-2 text-sm font-medium transition-colors ${
                      provider === p.value ? 'border-brand bg-brand/5 text-brand' : 'border-neutral-200 text-neutral-600'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`${selectedMeta.label} API key`}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              {selectedMeta.needsTerminalId && (
                <input
                  value={terminalId}
                  onChange={(e) => setTerminalId(e.target.value)}
                  placeholder="Terminal / reader id"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              )}
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <Button type="submit" disabled={busy || !apiKey}>
                {busy ? 'Connecting…' : 'Connect'}
              </Button>
            </form>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-neutral-400">
        Note: none of these four integrations have been tested against a real account or a
        real physical terminal in this environment — the code follows each provider&apos;s
        real API, but that last step needs real credentials and real hardware to prove out.
      </p>
    </main>
  );
}
