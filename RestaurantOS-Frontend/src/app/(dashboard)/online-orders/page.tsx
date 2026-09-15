'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWebsiteStatus } from '@/lib/hooks/useWebsiteStatus';
import { useOrders } from '@/lib/hooks/useOrders';
import { getSocket } from '@/lib/socket';
import { acceptOrder } from '@/lib/api';
import { OrderRow } from '@/lib/types';

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function OnlineOrdersPage() {
  const { data: websiteStatus, loading: statusLoading } = useWebsiteStatus();
  const { orders, loading: ordersLoading, error } = useOrders();
  const [liveOrders, setLiveOrders] = useState<OrderRow[]>([]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Real-time: a new online order pushed by the website's webhook (routes/website.js) shows
  // up here the instant it arrives, no polling. Only subscribes once the website is actually
  // connected -- no point listening for an event that can never fire otherwise.
  useEffect(() => {
    if (!websiteStatus?.connected) return;
    const socket = getSocket();
    function handleOnlineOrder(payload: { order: OrderRow }) {
      setLiveOrders((prev) => [payload.order, ...prev]);
      setToast(`New online order — €${Number(payload.order.total).toFixed(2)}`);
    }
    socket.on('online-order', handleOnlineOrder);
    return () => {
      socket.off('online-order', handleOnlineOrder);
    };
  }, [websiteStatus?.connected]);

  if (statusLoading) return <p className="p-8 text-neutral-400">Checking website connection…</p>;

  if (!websiteStatus?.connected) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold text-neutral-900">Online Orders is disabled</h1>
        <p className="max-w-sm text-sm text-neutral-500">
          Connect your restaurant&apos;s website first — online orders only appear here once
          that connection is live.
        </p>
        <Link href="/settings/website" className="mt-2 text-sm font-medium text-brand hover:underline">
          Go to Website sync settings →
        </Link>
      </main>
    );
  }

  const fetchedOnline = orders.filter((o) => o.source === 'online');
  // Merge anything pushed live this session with what's already on the server, de-duplicated.
  const merged = [...liveOrders, ...fetchedOnline.filter((o) => !liveOrders.some((l) => l.id === o.id))];

  // Accepting sends the order to /orders/accept (see routes/orders.js), which flips status to
  // in-kitchen and pushes an 'order-to-kitchen' socket event -- the Kitchen Display screen
  // picks it up live, badged as "Online" so the kitchen can't confuse it with a table order.
  async function handleAccept(orderId: string) {
    setAcceptingId(orderId);
    try {
      const res = await acceptOrder(orderId);
      if (res.status) {
        setAccepted((prev) => ({ ...prev, [orderId]: true }));
        setToast('Order accepted — sent to kitchen.');
      } else {
        setToast(res.message || 'Could not accept order.');
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not accept order.');
    } finally {
      setAcceptingId(null);
    }
  }

  return (
    <main className="flex h-screen flex-col p-4">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">Online Orders</h1>
      <p className="mb-4 text-sm text-neutral-500">Orders placed through your website, live.</p>

      {ordersLoading && <p className="text-neutral-400">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!ordersLoading && !error && (
        <div className="flex-1 space-y-3 overflow-y-auto">
          {merged.length === 0 && <p className="py-12 text-center text-neutral-400">No online orders yet.</p>}
          {merged.map((o) => (
            <div key={o.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-blue-800">
                  Online
                </span>
                <span className="text-xs text-neutral-400">{formatDate(o.created_at)}</span>
              </div>
              <p className="text-sm text-neutral-700">{o.note}</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="font-semibold text-neutral-900">€{Number(o.total).toFixed(2)}</p>
                {accepted[o.id] || o.status !== 'ongoing' ? (
                  <span className="text-xs font-medium text-green-600">✓ Sent to kitchen</span>
                ) : (
                  <button
                    onClick={() => handleAccept(o.id)}
                    disabled={acceptingId === o.id}
                    className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                  >
                    {acceptingId === o.id ? 'Accepting…' : 'Accept order'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}
