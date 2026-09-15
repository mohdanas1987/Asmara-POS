'use client';

import { useState } from 'react';
import { useWebsiteStatus } from '@/lib/hooks/useWebsiteStatus';
import { Button } from '@/components/ui/Button';

// Dev-only: in Phase 1 this is always localhost, since nothing here is deployed yet. Once
// the POS actually runs somewhere reachable from the internet, this becomes that real
// address -- the code doesn't change, only where it's pointed.
const API_BASE = 'http://localhost:5102';

export default function WebsiteSyncPage() {
  const { data, loading, error, connect, disconnect } = useWebsiteStatus();
  const [url, setUrl] = useState('');
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      const apiKey = await connect(url.trim());
      setNewApiKey(apiKey);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect the website? Online orders will stop being accepted until you reconnect.')) return;
    setBusy(true);
    try {
      await disconnect();
      setNewApiKey(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">Website sync</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Connect your restaurant&apos;s website so its menu always matches the POS, and online
        orders land here in real time.
      </p>

      {loading && <p className="text-neutral-400">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && data && (
        <>
          <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${data.connected ? 'bg-emerald-500' : 'bg-neutral-300'}`}
              />
              <span className="font-medium text-neutral-900">
                {data.connected ? 'Connected' : 'Not connected'}
              </span>
            </div>

            {data.connected ? (
              <>
                <p className="text-sm text-neutral-600">
                  Website: <span className="font-medium">{data.website_url}</span>
                </p>
                <p className="text-sm text-neutral-600">
                  API key: <span className="font-mono">{data.api_key_masked}</span>
                </p>
                <Button variant="danger" className="mt-4" onClick={handleDisconnect} disabled={busy}>
                  Disconnect
                </Button>
              </>
            ) : (
              <form onSubmit={handleConnect} className="flex gap-2">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://asmara-eindhoven.nl"
                  className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <Button type="submit" disabled={busy}>
                  {busy ? 'Connecting…' : 'Connect'}
                </Button>
              </form>
            )}
            {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
          </div>

          {newApiKey && (
            <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">
                Your API key (shown once — copy it now):
              </p>
              <code className="mt-1 block break-all rounded bg-white px-3 py-2 text-sm">{newApiKey}</code>
            </div>
          )}

          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <h2 className="mb-3 font-medium text-neutral-900">How to connect your website</h2>
            <ol className="list-decimal space-y-3 pl-5 text-sm text-neutral-700">
              <li>
                Enter your website&apos;s address above and click Connect. This generates an API
                key — copy it somewhere safe, it&apos;s only shown once.
              </li>
              <li>
                In your website&apos;s ordering plugin/settings, add these two things: a{' '}
                <span className="font-medium">menu feed URL</span> it should read the menu from,
                and an <span className="font-medium">order webhook URL</span> it should send new
                orders to. Both need the API key sent as an <code>x-api-key</code> header.
                <div className="mt-2 space-y-1 rounded-lg bg-neutral-50 p-3 font-mono text-xs">
                  <p>Menu feed: {API_BASE}/website/menu-feed</p>
                  <p>Order webhook: {API_BASE}/website/orders</p>
                </div>
              </li>
              <li>
                That&apos;s it — the POS never contacts your website. Your website reads the menu
                from the feed on whatever schedule it&apos;s set to, and pushes each new order to
                the webhook the moment a customer places it. Menu and price changes you make here
                show up on the website the next time it reads the feed.
              </li>
              <li>
                Online orders then appear on the <span className="font-medium">Online Orders</span>{' '}
                page (in the sidebar) the instant they arrive, clearly marked apart from table
                orders.
              </li>
            </ol>
            <p className="mt-4 text-xs text-neutral-400">
              Note: the address above points at this local dev backend. Once the POS is actually
              deployed somewhere reachable from the internet, use that real address instead — the
              connection itself doesn&apos;t change.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
