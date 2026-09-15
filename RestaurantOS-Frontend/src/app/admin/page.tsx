'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminTenant } from '@/lib/types';
import { getAdminTenants, toggleTenantStatus } from '@/lib/api';

/**
 * Super-admin panel. Deliberately OUTSIDE the (dashboard) route group -- this is a
 * cross-tenant, platform-operator view, not a restaurant's own screen, so it doesn't get the
 * tenant-scoped Sidebar (POS/Tables/Menu/etc). Gated server-side by requirePlatformAdmin
 * (see routes/superadmin.js); a non-platform-admin token gets a real 403 from every call
 * here, shown below rather than silently hidden, since there's no client-side way to know
 * someone isn't a platform admin before asking the server.
 */
function formatDate(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' });
  } catch {
    return iso;
  }
}

export default function SuperAdminPage() {
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function load() {
    setLoading(true);
    getAdminTenants()
      .then((res) => setTenants(res.tenants))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load tenants'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleToggle(id: number) {
    setBusyId(id);
    try {
      const res = await toggleTenantStatus(id);
      setTenants((prev) => prev.map((t) => (t.id === id ? res.tenant : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update tenant');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-neutral-900">Platform Admin</h1>
          <p className="text-sm text-neutral-500">
            Every restaurant on RestaurantOS — usage and subscription at a glance.
          </p>
        </div>
        <Link href="/admin/billing" className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          Manage plans & payment partners
        </Link>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          {error.includes('403') || error.toLowerCase().includes('platform admin') ? (
            <span className="block text-xs text-red-500">
              This account isn&apos;t a platform admin — that role has no public signup and is
              created directly by an operator.
            </span>
          ) : null}
        </p>
      )}

      {loading && <p className="text-neutral-400">Loading…</p>}

      {!loading && (
        <div className="overflow-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2">Restaurant</th>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Subscription</th>
                <th className="px-4 py-2 text-right">Users</th>
                <th className="px-4 py-2 text-right">Orders</th>
                <th className="px-4 py-2">Last order</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-t border-neutral-100">
                  <td className="px-4 py-2 font-medium">{t.name}</td>
                  <td className="px-4 py-2 text-neutral-500">{t.slug}</td>
                  <td className="px-4 py-2 text-neutral-700">{t.plan_name || '—'}</td>
                  <td className="px-4 py-2">
                    {t.subscription_status ? (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                        {t.subscription_status}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-400">none</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">{t.user_count}</td>
                  <td className="px-4 py-2 text-right">{t.order_count}</td>
                  <td className="px-4 py-2 text-neutral-500">{formatDate(t.last_order_at)}</td>
                  <td className="px-4 py-2 text-center">
                    {Boolean(t.status) ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span>
                    ) : (
                      <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600">Suspended</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleToggle(t.id)}
                      disabled={busyId === t.id}
                      className="text-sm text-brand hover:underline disabled:opacity-50"
                    >
                      {Boolean(t.status) ? 'Suspend' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-neutral-400">
                    No tenants yet.
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
