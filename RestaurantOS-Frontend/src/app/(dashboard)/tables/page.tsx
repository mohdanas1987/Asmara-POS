'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTables } from '@/lib/hooks/useTables';
import { Button } from '@/components/ui/Button';
import { TableBox } from './components/TableBox';
import { TableRow } from '@/lib/types';

export default function TablesPage() {
  const router = useRouter();
  const { tables, loading, error, moveTable, transfer, freeAll, openTable } = useTables();
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const transferFromTable = tables.find((t) => t.table_number === transferFrom) ?? null;
  const freeTables = tables.filter((t) => t.status === 'free' && t.table_number !== transferFrom);

  async function handleOpenTable(table: TableRow) {
    setOpenError(null);
    setBusy(true);
    try {
      const { tableNumber, orderId } = await openTable(table);
      router.push(`/pos?table=${encodeURIComponent(tableNumber)}&order=${orderId}`);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Could not open this table.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTransfer(toTable: string) {
    if (!transferFrom) return;
    setBusy(true);
    setTransferError(null);
    try {
      await transfer(transferFrom, toTable);
      setTransferFrom(null);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-screen flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Tables</h1>
          <p className="text-xs text-neutral-400">
            Tap a green table to start an order · tap an amber/red table to open its current order · use ⇄ to move an order to another table.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            if (confirm('Free every table? Use this at end of service.')) freeAll();
          }}
        >
          Free all tables
        </Button>
      </div>

      {loading && <p className="text-neutral-400">Loading tables…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {openError && <p className="mb-2 text-sm text-red-600">{openError}</p>}

      {!loading && !error && (
        <div className="relative flex-1 overflow-auto rounded-xl border border-neutral-200 bg-neutral-50">
          <div className="relative" style={{ width: 1000, height: 700 }}>
            {tables.map((t) => (
              <TableBox
                key={t.id}
                table={t}
                selected={transferFrom === t.table_number}
                busy={busy}
                onMove={(x, y) => moveTable(t.table_number, x, y)}
                onClick={() => handleOpenTable(t)}
                onTransferClick={
                  t.status !== 'free'
                    ? () => {
                        setTransferError(null);
                        setTransferFrom(transferFrom === t.table_number ? null : t.table_number);
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {transferFromTable && (
        <div className="fixed bottom-4 left-1/2 w-full max-w-md -translate-x-1/2 rounded-xl border border-neutral-200 bg-white p-4 shadow-lg">
          <p className="mb-2 text-sm font-medium text-neutral-900">
            Move order from table #{transferFromTable.table_number} to a free table:
          </p>
          <div className="flex flex-wrap gap-2">
            {freeTables.length === 0 && <p className="text-sm text-neutral-400">No free tables right now.</p>}
            {freeTables.map((t) => (
              <button
                key={t.id}
                disabled={busy}
                onClick={() => handleTransfer(t.table_number)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-brand hover:text-brand disabled:opacity-50"
              >
                #{t.table_number}
              </button>
            ))}
          </div>
          {transferError && <p className="mt-2 text-sm text-red-600">{transferError}</p>}
          <button onClick={() => setTransferFrom(null)} className="mt-3 text-sm text-neutral-400 hover:text-neutral-600">
            Cancel
          </button>
        </div>
      )}
    </main>
  );
}
