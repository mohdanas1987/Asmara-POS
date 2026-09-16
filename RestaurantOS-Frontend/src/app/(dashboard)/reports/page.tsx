'use client';

import { useEffect, useState } from 'react';
import { ReportRow, SalesReportData, TablePerformanceData } from '@/lib/types';
import {
  generateXReport,
  generateZReport,
  getReportHistory,
  removeReport,
  getSalesReport,
  getTablePerformanceReport,
} from '@/lib/api';
import { Button } from '@/components/ui/Button';

/**
 * X report = a snapshot of the current register session so far (session stays open).
 * Z report = closes out the current register session (see routes/orders.js's /z-report,
 * which also frees every table once it succeeds) -- so it's gated behind a confirmation,
 * not a plain click, since it's a real end-of-day action with real consequences.
 *
 * "Sales & Tables" tab (task #38) is a separate, date-range business dashboard backed by
 * GET /reports/sales and /reports/table-performance -- it never touches cash registers or
 * frees tables, unlike the X/Z tab, so it's safe to load and re-load freely.
 */
export default function ReportsPage() {
  const [tab, setTab] = useState<'register' | 'sales'>('register');
  const [history, setHistory] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState<'x' | 'z' | null>(null);
  const [confirmZ, setConfirmZ] = useState(false);

  function loadHistory() {
    getReportHistory()
      .then((res) => setHistory(res.reports))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load report history'))
      .finally(() => setLoading(false));
  }

  useEffect(loadHistory, []);

  async function handleX() {
    setBusy('x');
    setError(null);
    try {
      const res = await generateXReport();
      if (!res.status) throw new Error(res.message || 'Could not generate X report.');
      setReportHtml(res.html);
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate X report.');
    } finally {
      setBusy(null);
    }
  }

  async function handleZ() {
    setBusy('z');
    setError(null);
    try {
      const res = await generateZReport();
      if (!res.status) throw new Error(res.message || 'Could not generate Z report.');
      setReportHtml(res.html);
      setConfirmZ(false);
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate Z report.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: number) {
    try {
      await removeReport(id);
      setHistory((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete report.');
    }
  }

  return (
    <main className="flex h-screen flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Reports</h1>
        <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
          <button
            onClick={() => setTab('register')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === 'register' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
            }`}
          >
            Register (X/Z)
          </button>
          <button
            onClick={() => setTab('sales')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === 'sales' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
            }`}
          >
            Sales &amp; Tables
          </button>
        </div>
      </div>

      {tab === 'register' && (
        <>
          {error && <p className="text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleX} disabled={busy !== null}>
              {busy === 'x' ? 'Generating…' : 'X Report (session snapshot)'}
            </Button>
            {!confirmZ ? (
              <Button variant="danger" onClick={() => setConfirmZ(true)} disabled={busy !== null}>
                Z Report (close register)
              </Button>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
                <span className="text-red-700">This closes the register session and frees every table. Sure?</span>
                <Button variant="danger" onClick={handleZ} disabled={busy !== null}>
                  {busy === 'z' ? 'Closing…' : 'Yes, close'}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmZ(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>

          {reportHtml && (
            <section className="rounded-xl border border-neutral-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Latest report</h2>
              {/* Report HTML is generated server-side by this app's own generateReport() (utils.js)
                  from real order data -- not third-party or user-supplied content. */}
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: reportHtml }} />
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Report history</h2>
            {loading && <p className="text-neutral-400">Loading…</p>}
            {!loading && (
              <div className="overflow-auto rounded-xl border border-neutral-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((r) => (
                      <tr key={r.id} className="border-t border-neutral-100">
                        <td className="px-4 py-2">{r.date || r.created_at}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => setReportHtml(r.html)} className="mr-3 text-sm text-brand hover:underline">
                            View
                          </button>
                          <button onClick={() => handleDelete(r.id)} className="text-sm text-neutral-400 hover:text-red-600">
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {history.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-4 py-12 text-center text-neutral-400">
                          No reports generated yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'sales' && <SalesAndTablesTab />}
    </main>
  );
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function SalesAndTablesTab() {
  const [from, setFrom] = useState(todayISO(-29));
  const [to, setTo] = useState(todayISO());
  const [sales, setSales] = useState<SalesReportData | null>(null);
  const [tables, setTables] = useState<TablePerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([getSalesReport({ from, to }), getTablePerformanceReport({ from, to })])
      .then(([salesRes, tableRes]) => {
        if (!salesRes.status) throw new Error(salesRes.message || 'Could not load sales report.');
        if (!tableRes.status) throw new Error(tableRes.message || 'Could not load table performance report.');
        setSales(salesRes);
        setTables(tableRes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load reports.'))
      .finally(() => setLoading(false));
  }

  // Reload once on mount only -- further loads happen when the user presses "Apply", not on
  // every keystroke while picking a date.
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-3">
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          To
          <input
            type="date"
            value={to}
            min={from}
            max={todayISO()}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>
        <Button onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Apply'}
        </Button>
      </div>

      {error && <p className="text-red-600">{error}</p>}

      {sales && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Revenue" value={`€${sales.totals.revenue.toFixed(2)}`} />
          <StatCard label="Paid orders" value={String(sales.totals.orders)} />
          <StatCard label="Avg order value" value={`€${sales.totals.avgOrderValue.toFixed(2)}`} />
          <StatCard
            label="Partial payments"
            value={String(sales.totals.partialOrders)}
            hint={sales.totals.partialOrders > 0 ? 'not counted in revenue above' : undefined}
          />
        </section>
      )}

      {sales && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Revenue by day</h2>
            {sales.byDay.length === 0 && <p className="text-sm text-neutral-400">No paid orders in range.</p>}
            <div className="flex flex-col gap-1">
              {sales.byDay.map((d) => {
                const max = Math.max(...sales.byDay.map((x) => x.revenue), 1);
                return (
                  <div key={d.date} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 text-neutral-500">{d.date}</span>
                    <div className="h-2 flex-1 rounded bg-neutral-100">
                      <div className="h-2 rounded bg-brand" style={{ width: `${(d.revenue / max) * 100}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right font-medium text-neutral-700">€{d.revenue.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">By category</h2>
            {sales.byCategory.length === 0 && <p className="text-sm text-neutral-400">No paid orders in range.</p>}
            <div className="flex flex-col gap-2">
              {sales.byCategory
                .sort((a, b) => b.revenue - a.revenue)
                .map((c) => (
                  <div key={c.category} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-700">{c.category}</span>
                    <span className="font-medium text-neutral-900">€{c.revenue.toFixed(2)}</span>
                  </div>
                ))}
            </div>
            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">Payment methods</h3>
            <div className="flex gap-4 text-sm text-neutral-700">
              <span>Cash: €{sales.byPaymentMethod.cash.toFixed(2)}</span>
              <span>Card: €{sales.byPaymentMethod.card.toFixed(2)}</span>
              <span>Account: €{sales.byPaymentMethod.account.toFixed(2)}</span>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4 lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Top items</h2>
            {sales.topItems.length === 0 && <p className="text-sm text-neutral-400">No paid orders in range.</p>}
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="py-1">Item</th>
                  <th className="py-1 text-right">Qty sold</th>
                  <th className="py-1 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {sales.topItems.map((i) => (
                  <tr key={i.id} className="border-t border-neutral-100">
                    <td className="py-1.5">{i.name}</td>
                    <td className="py-1.5 text-right">{i.quantity}</td>
                    <td className="py-1.5 text-right font-medium">€{i.revenue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tables && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Table performance</h2>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="py-1">Table</th>
                  <th className="py-1">Section</th>
                  <th className="py-1 text-right">Orders</th>
                  <th className="py-1 text-right">Revenue</th>
                  <th className="py-1 text-right">Avg order</th>
                  <th className="py-1 text-right">Avg turnover</th>
                </tr>
              </thead>
              <tbody>
                {tables.tables.map((t) => (
                  <tr key={t.table} className={`border-t border-neutral-100 ${t.orders === 0 ? 'text-neutral-400' : ''}`}>
                    <td className="py-1.5 font-medium">{t.table}</td>
                    <td className="py-1.5">{t.section || '—'}</td>
                    <td className="py-1.5 text-right">{t.orders}</td>
                    <td className="py-1.5 text-right">€{t.revenue.toFixed(2)}</td>
                    <td className="py-1.5 text-right">{t.orders ? `€${t.avgOrderValue.toFixed(2)}` : '—'}</td>
                    <td className="py-1.5 text-right">
                      {t.avgTurnoverMinutes != null ? `${Math.round(t.avgTurnoverMinutes)} min` : '—'}
                    </td>
                  </tr>
                ))}
                {tables.tables.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-neutral-400">
                      No tables found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
    </div>
  );
}
