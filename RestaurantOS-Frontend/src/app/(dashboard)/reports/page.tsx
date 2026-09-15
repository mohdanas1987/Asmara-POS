'use client';

import { useEffect, useState } from 'react';
import { ReportRow } from '@/lib/types';
import { generateXReport, generateZReport, getReportHistory, removeReport } from '@/lib/api';
import { Button } from '@/components/ui/Button';

/**
 * X report = a snapshot of the current register session so far (session stays open).
 * Z report = closes out the current register session (see routes/orders.js's /z-report,
 * which also frees every table once it succeeds) -- so it's gated behind a confirmation,
 * not a plain click, since it's a real end-of-day action with real consequences.
 */
export default function ReportsPage() {
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
      <h1 className="text-xl font-semibold text-neutral-900">Reports</h1>

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
    </main>
  );
}
