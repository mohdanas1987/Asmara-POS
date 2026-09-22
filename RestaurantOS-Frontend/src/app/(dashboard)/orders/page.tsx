'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useOrders } from '@/lib/hooks/useOrders';
import { OrderRow } from '@/lib/types';
import { OrderPaymentsDialog } from '@/components/orders/OrderPaymentsDialog';
import { TopBar } from '@/components/layout/TopBar';
import { parsePrice } from '@/lib/tax';

const STATUS_BADGE: Record<string, string> = {
  ongoing: 'bg-surface-sunken text-ink',
  'in-kitchen': 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
};

const PAYMENT_BADGE: Record<string, string> = {
  pending: 'bg-rose-100 text-rose-700',
  paid: 'bg-emerald-100 text-emerald-800',
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function OrdersPage() {
  const { orders, loading, error } = useOrders();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderRow['status']>('all');
  const [paymentsOrderId, setPaymentsOrderId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
      const matchesQuery =
        !query ||
        o.id.toLowerCase().includes(query.toLowerCase()) ||
        (o.tables ?? '').toLowerCase().includes(query.toLowerCase()) ||
        (o.cashier?.name ?? '').toLowerCase().includes(query.toLowerCase());
      return matchesStatus && matchesQuery;
    });
  }, [orders, query, statusFilter]);

  return (
    <main className="flex h-screen flex-col">
      <TopBar title="📋 Orders" />
      <div className="flex-1 overflow-y-auto p-4">

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search by order id, table, or cashier…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64 rounded-lg border border-border px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        {(['all', 'ongoing', 'in-kitchen', 'completed'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={clsx(
              'rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors',
              statusFilter === s ? 'bg-brand text-white' : 'bg-neutral-200 text-ink hover:bg-neutral-300'
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && <p className="text-ink-muted">Loading orders…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="flex-1 overflow-auto rounded-2xl border border-border bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-sunken text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2">Table</th>
                <th className="px-4 py-2">Cashier</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Payment</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Placed</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="border-t border-neutral-100 transition-colors hover:bg-brand/5">
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted">{o.id.slice(0, 8)}</td>
                  <td className="px-4 py-2">{o.tables ?? '—'}</td>
                  <td className="px-4 py-2">{o.cashier?.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_BADGE[o.status] ?? 'bg-surface-sunken text-ink')}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium capitalize', PAYMENT_BADGE[o.payment_status] ?? 'bg-surface-sunken text-ink')}>
                      {o.payment_status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-ink">
                    {o.total != null ? `€${parsePrice(o.total).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-ink-muted">{formatDate(o.created_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setPaymentsOrderId(o.id)}
                      className="rounded-lg px-2.5 py-1 text-xs font-semibold text-brand transition-colors hover:bg-brand/10"
                    >
                      Payments
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-ink-muted">
                    No orders match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <OrderPaymentsDialog orderId={paymentsOrderId} onClose={() => setPaymentsOrderId(null)} />
      </div>
    </main>
  );
}
