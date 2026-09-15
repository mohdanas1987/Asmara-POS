'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useOrders } from '@/lib/hooks/useOrders';
import { OrderRow } from '@/lib/types';

const STATUS_BADGE: Record<string, string> = {
  ongoing: 'bg-neutral-100 text-neutral-700',
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
    <main className="flex h-screen flex-col p-4">
      <h1 className="mb-4 text-xl font-semibold text-neutral-900">Orders</h1>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search by order id, table, or cashier…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        {(['all', 'ongoing', 'in-kitchen', 'completed'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={clsx(
              'rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors',
              statusFilter === s ? 'bg-brand text-white' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && <p className="text-neutral-400">Loading orders…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="flex-1 overflow-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2">Table</th>
                <th className="px-4 py-2">Cashier</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Payment</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Placed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                  <td className="px-4 py-2 font-mono text-xs text-neutral-500">{o.id.slice(0, 8)}</td>
                  <td className="px-4 py-2">{o.tables ?? '—'}</td>
                  <td className="px-4 py-2">{o.cashier?.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_BADGE[o.status] ?? 'bg-neutral-100 text-neutral-700')}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium capitalize', PAYMENT_BADGE[o.payment_status] ?? 'bg-neutral-100 text-neutral-700')}>
                      {o.payment_status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {o.total != null ? `€${Number(o.total).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-neutral-500">{formatDate(o.created_at)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-neutral-400">
                    No orders match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
