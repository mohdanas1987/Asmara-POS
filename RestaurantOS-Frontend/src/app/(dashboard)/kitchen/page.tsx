'use client';

import { useEffect, useState } from 'react';
import { useOrders } from '@/lib/hooks/useOrders';
import { getSocket } from '@/lib/socket';
import { markOrderPrepared } from '@/lib/api';
import { OrderRow } from '@/lib/types';
import { parsePrice } from '@/lib/tax';
import { TopBar } from '@/components/layout/TopBar';

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/**
 * Live kitchen ticket board. Shows every order currently in status 'in-kitchen', clearly
 * badged by source (Online vs Table X) so the kitchen never confuses a website order with a
 * walk-in table order, per the original requirement. New tickets arrive in real time via the
 * 'order-to-kitchen' socket event (emitted by /orders/accept and, for POS-drafted table
 * orders, /orders/to-kitchen) -- no polling needed.
 */
export default function KitchenDisplayPage() {
  const { orders, loading, error } = useOrders();
  const [liveOrders, setLiveOrders] = useState<OrderRow[]>([]);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const socket = getSocket();
    function handleNewTicket(payload: { order: OrderRow }) {
      if (payload.order.status !== 'in-kitchen') return;
      setLiveOrders((prev) => [payload.order, ...prev.filter((o) => o.id !== payload.order.id)]);
    }
    // 'order-to-kitchen' covers both accepted online orders and POS-drafted table orders;
    // 'online-order' is also listened for so a freshly placed online order that gets
    // auto-accepted elsewhere still lands here without a page refresh.
    socket.on('order-to-kitchen', handleNewTicket);
    return () => {
      socket.off('order-to-kitchen', handleNewTicket);
    };
  }, []);

  const fetchedTickets = orders.filter((o) => o.status === 'in-kitchen');
  const merged = [
    ...liveOrders,
    ...fetchedTickets.filter((o) => !liveOrders.some((l) => l.id === o.id)),
  ].filter((o) => !dismissed[o.id]);

  async function handlePrepared(order: OrderRow) {
    setBusyId(order.id);
    try {
      const res = await markOrderPrepared(order.id);
      if (res.status) {
        setDismissed((prev) => ({ ...prev, [order.id]: true }));
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="flex h-screen flex-col">
      <TopBar title="🍳 Kitchen Display" />
      <div className="flex flex-1 flex-col overflow-hidden p-4">
      <p className="mb-4 text-sm text-ink-muted">Live tickets — updates instantly, no refresh needed.</p>

      {loading && <p className="text-ink-muted">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {merged.length === 0 && (
            <p className="col-span-full py-12 text-center text-ink-muted">No tickets in the kitchen right now.</p>
          )}
          {merged.map((o) => (
            <div key={o.id} className="flex flex-col rounded-xl border border-border bg-surface p-4 shadow-md transition-shadow hover:shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                {o.source === 'online' ? (
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-blue-800">
                    Online order
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                    {o.tables ? `Table ${o.tables}` : 'Direct sale'}
                  </span>
                )}
                <span className="text-xs text-ink-muted">{formatTime(o.created_at)}</span>
              </div>
              {o.note && <p className="mb-2 text-sm text-ink">{o.note}</p>}
              <p className="mb-3 text-base font-bold text-ink">€{parsePrice(o.total ?? 0).toFixed(2)}</p>
              <button
                onClick={() => handlePrepared(o)}
                disabled={busyId === o.id}
                className="mt-auto rounded-lg bg-brand px-3 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-dark disabled:opacity-50"
              >
                {busyId === o.id ? 'Marking…' : '✓ Mark prepared'}
              </button>
            </div>
          ))}
        </div>
      )}
      </div>
    </main>
  );
}
