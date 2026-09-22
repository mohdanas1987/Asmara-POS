'use client';

/**
 * Table/Floor management redesign (project audit 2026-09-15, task "Table/Floor management
 * redesign"): the floor plan now shows seats/section/amount/elapsed time on every table
 * (see TableBox), and adds the plan's "merge" and "free selected" requirements alongside
 * the transfer and free-all actions this screen already had. One `mode` state drives which
 * action tapping a table performs, rather than layering more one-off click handlers.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTables } from '@/lib/hooks/useTables';
import { useMenu } from '@/lib/hooks/useMenu';
import { Button } from '@/components/ui/Button';
import { TopBar } from '@/components/layout/TopBar';
import { TableBox } from './components/TableBox';
import { BillPreviewDialog } from './components/BillPreviewDialog';
import { TableRow, StaffMember } from '@/lib/types';
import { listStaff } from '@/lib/api';

type Mode = 'view' | 'transfer' | 'merge' | 'free-selected';

export default function TablesPage() {
  const router = useRouter();
  const { tables, tableOrders, loading, error, moveTable, transfer, assignServer, freeAll, freeSelected, merge, split, openTable } = useTables();
  const { items: menuItems } = useMenu();

  const [mode, setMode] = useState<Mode>('view');
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [billTable, setBillTable] = useState<TableRow | null>(null);
  // Table split (CTO forensic audit 2026-09-20): the table whose merged-group split is being
  // confirmed -- opens a small "which table keeps the bill" chooser rather than guessing.
  const [splitTableRow, setSplitTableRow] = useState<TableRow | null>(null);
  // Seat / server assignment (CTO forensic audit 2026-09-21, P1): the table currently being
  // assigned a server, and the staff list to pick from (loaded once -- this screen doesn't
  // need it to stay live-updated, just accurate enough to assign against).
  const [assignServerTable, setAssignServerTable] = useState<TableRow | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listStaff()
      .then((res) => {
        if (res.status) setStaff(res.staff);
      })
      .catch(() => {
        // Non-fatal: the assign-server picker just shows no names if this fails, same
        // "degrade, don't break the floor plan" approach as everything else on this screen.
      });
  }, []);

  function staffNameFor(serverId: number | null | undefined): string | null {
    if (serverId == null) return null;
    return staff.find((s) => s.id === serverId)?.name ?? null;
  }

  async function handleAssignServer(serverId: number | null) {
    if (!assignServerTable) return;
    setBusy(true);
    setActionError(null);
    try {
      await assignServer(assignServerTable.table_number, serverId);
      setAssignServerTable(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not assign server.');
    } finally {
      setBusy(false);
    }
  }

  const transferFromTable = tables.find((t) => t.table_number === transferFrom) ?? null;
  const freeTables = tables.filter((t) => t.status === 'free' && t.table_number !== transferFrom);
  const selectionMode = mode === 'merge' || mode === 'free-selected';

  function resetMode() {
    setMode('view');
    setTransferFrom(null);
    setSelectedTables([]);
    setActionError(null);
  }

  async function handleTableClick(table: TableRow) {
    setActionError(null);

    if (mode === 'merge' || mode === 'free-selected') {
      setSelectedTables((prev) =>
        prev.includes(table.table_number) ? prev.filter((n) => n !== table.table_number) : [...prev, table.table_number]
      );
      return;
    }

    // Owner-reported bug: the only way in was the small ⇄ icon, and a pointer-event
    // propagation bug in it (fixed in TableBox.tsx) let the tap fall through to the table's
    // own "open this order" click, dropping the person straight into the POS instead of the
    // move flow. Fixed the icon AND added this as a proper first-class step: the toolbar's
    // "Move table" button puts us in transfer mode with no source picked yet, and tapping an
    // occupied table here (first tap only -- transferFrom is still null) picks it as the
    // table being moved. Once a source is picked, taps on tables are ignored -- the
    // destination is chosen from the free-table list at the bottom, not by tapping a table.
    if (mode === 'transfer' && !transferFrom) {
      if (table.status === 'free') {
        setActionError('Pick the OCCUPIED table you want to move, not a free one.');
        return;
      }
      setTransferFrom(table.table_number);
      return;
    }
    if (mode === 'transfer') return; // source already picked -- destination comes from the list below

    // Plain tap in view mode: shift+click-equivalent long-press-free "view bill" for an
    // occupied table with a right-click-free touch UI would need a dedicated control -- for
    // now, tapping an occupied table still opens it in the POS (unchanged, high-frequency
    // action); the bill icon on the table itself (below) opens the preview without navigating.
    setBusy(true);
    try {
      const { tableNumber, orderId } = await openTable(table);
      router.push(`/pos?table=${encodeURIComponent(tableNumber)}&order=${orderId}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open this table.');
    } finally {
      setBusy(false);
    }
  }

  // A table is part of a merged group if its own `linked_to` carries the "+"-joined combo
  // (see routes/orders.js's linkTablesHandler) -- every table in the group gets the same
  // value, so any one of them is enough to recover the full member list.
  function mergedGroupOf(table: TableRow): string[] {
    const raw = table.linked_to;
    if (!raw) return [table.table_number];
    const parts = String(raw).split('+').filter(Boolean);
    return parts.length > 1 ? parts : [table.table_number];
  }

  async function handleSplit(tableNumber: string, keepOn: string) {
    setBusy(true);
    setActionError(null);
    try {
      await split(tableNumber, keepOn);
      setSplitTableRow(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not split this table.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTransfer(toTable: string) {
    if (!transferFrom) return;
    setBusy(true);
    setActionError(null);
    try {
      await transfer(transferFrom, toTable);
      resetMode();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmSelection() {
    if (selectedTables.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      if (mode === 'merge') {
        if (selectedTables.length < 2) throw new Error('Select at least two tables to merge.');
        // Merging combines these tables into ONE shared order (see useTables.ts's merge) --
        // that only makes sense before anyone's seated, so require every selected table to
        // still be free. Merging an already-occupied table would silently strand its existing
        // order (its own order row keeps pointing at just that table, while a brand new order
        // gets created for the combo) rather than actually combining anything.
        const notFree = selectedTables.filter((n) => tables.find((t) => t.table_number === n)?.status !== 'free');
        if (notFree.length > 0) {
          throw new Error(`Table${notFree.length > 1 ? 's' : ''} ${notFree.join(', ')} already ${notFree.length > 1 ? 'have' : 'has'} an order -- only free tables can be merged.`);
        }
        const { tableNumber, orderId } = await merge(selectedTables);
        resetMode();
        router.push(`/pos?table=${encodeURIComponent(tableNumber)}&order=${orderId}`);
        return;
      } else {
        await freeSelected(selectedTables);
      }
      resetMode();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-screen flex-col">
      <TopBar title="Tables" />

      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2">
        <p className="text-xs text-ink-muted">
          {mode === 'view' && 'Tap a green table to start an order · tap an amber/red table to open its current order · ⇄ to move an order.'}
          {mode === 'transfer' && !transferFrom && 'Tap the occupied table whose order you want to move.'}
          {mode === 'transfer' && transferFrom && `Moving table #${transferFrom}'s order — pick a free table below.`}
          {mode === 'merge' && `Selecting tables to merge (${selectedTables.length} selected) — tap tables, then Confirm.`}
          {mode === 'free-selected' && `Selecting tables to free (${selectedTables.length} selected) — tap tables, then Confirm.`}
        </p>
        <div className="flex gap-2">
          {mode === 'view' ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setMode('transfer')}>Move table</Button>
              <Button variant="secondary" size="sm" onClick={() => setMode('merge')}>Merge tables</Button>
              <Button variant="secondary" size="sm" onClick={() => setMode('free-selected')}>Free selected</Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (confirm('Free every table? Use this at end of service.')) freeAll();
                }}
              >
                Free all tables
              </Button>
            </>
          ) : (
            <>
              {selectionMode && (
                <Button variant="primary" size="sm" disabled={busy || selectedTables.length === 0} onClick={handleConfirmSelection}>
                  Confirm ({selectedTables.length})
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={resetMode}>Cancel</Button>
            </>
          )}
        </div>
      </div>

      {loading && <p className="p-4 text-ink-muted">Loading tables…</p>}
      {error && <p className="p-4 text-red-600">{error}</p>}
      {actionError && <p className="px-4 pt-2 text-sm text-red-600">{actionError}</p>}

      {/* Owner feedback ("looking very basic school project"): the floor was a flat gray
          rectangle with no sense of a real dining room. A faint dot-grid (the same visual
          language POS floor-plan editors like the current Windows POS use for a "floor")
          plus a touch more depth on each table (below) does most of the work without
          touching any of the drag/selection logic. */}
      {!loading && !error && (
        <div
          className="relative flex-1 overflow-auto"
          style={{
            // A warm herringbone/parquet-style restaurant floor instead of a flat gray
            // rectangle -- layered diagonal wood-tone stripes plus a faint dot grid (kept
            // for drag/snap reference) and a soft vignette for depth.
            backgroundColor: '#3b2a20',
            backgroundImage:
              'radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1px), ' +
              'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 26px), ' +
              'repeating-linear-gradient(-45deg, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 2px, transparent 2px, transparent 26px), ' +
              'linear-gradient(160deg, #5a3f2c 0%, #3b2a20 55%, #2a1d15 100%)',
            backgroundSize: '24px 24px, 52px 52px, 52px 52px, 100% 100%',
          }}
        >
          <div className="relative" style={{ width: 1000, height: 700 }}>
            {tables.map((t) => (
              <div key={t.id} className="group relative">
                <TableBox
                  table={t}
                  order={tableOrders[t.table_number]}
                  selected={mode === 'transfer' ? transferFrom === t.table_number : selectedTables.includes(t.table_number)}
                  selectionMode={selectionMode}
                  busy={busy}
                  serverName={staffNameFor(t.assigned_server_id)}
                  onMove={(x, y) => moveTable(t.table_number, x, y)}
                  onClick={() => (mode === 'transfer' && transferFrom ? undefined : handleTableClick(t))}
                  onTransferClick={
                    mode === 'view' && t.status !== 'free'
                      ? () => {
                          setActionError(null);
                          setMode('transfer');
                          setTransferFrom(t.table_number);
                        }
                      : undefined
                  }
                  onAssignServerClick={
                    mode === 'view'
                      ? () => {
                          setActionError(null);
                          setAssignServerTable(t);
                        }
                      : undefined
                  }
                />
                {mode === 'view' && t.status !== 'free' && tableOrders[t.table_number] && (
                  <button
                    type="button"
                    title="View bill"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBillTable(t);
                    }}
                    style={{ position: 'absolute', left: t.x + Math.max(t.length, 96) - 14, top: t.y + Math.max(t.width, 72) - 14 }}
                    className="touch-target flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-xs shadow-sm hover:border-brand hover:text-brand"
                  >
                    🧾
                  </button>
                )}
                {mode === 'view' && mergedGroupOf(t).length > 1 && (
                  <button
                    type="button"
                    title="Split this merged table"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionError(null);
                      setSplitTableRow(t);
                    }}
                    style={{ position: 'absolute', left: t.x - 12, top: t.y + Math.max(t.width, 72) - 14 }}
                    className="touch-target flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-xs shadow-sm hover:border-brand hover:text-brand"
                  >
                    ⑃
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'transfer' && transferFromTable && (
        <div className="fixed bottom-4 left-1/2 w-full max-w-md -translate-x-1/2 rounded-xl border border-border bg-surface-raised p-4 shadow-lg">
          <p className="mb-2 text-sm font-medium text-ink">
            Move order from table #{transferFromTable.table_number} to a free table:
          </p>
          <div className="flex flex-wrap gap-2">
            {freeTables.length === 0 && <p className="text-sm text-ink-muted">No free tables right now.</p>}
            {freeTables.map((t) => (
              <button
                key={t.id}
                disabled={busy}
                onClick={() => handleTransfer(t.table_number)}
                className="touch-target rounded-lg border border-border px-3 text-sm hover:border-brand hover:text-brand disabled:opacity-50"
              >
                #{t.table_number}
              </button>
            ))}
          </div>
        </div>
      )}

      {splitTableRow && (
        <div className="fixed bottom-4 left-1/2 w-full max-w-md -translate-x-1/2 rounded-xl border border-border bg-surface-raised p-4 shadow-lg">
          <p className="mb-2 text-sm font-medium text-ink">
            Split merged table {mergedGroupOf(splitTableRow).map((n) => `#${n}`).join(' + ')} — which table keeps the running bill?
          </p>
          <div className="flex flex-wrap gap-2">
            {mergedGroupOf(splitTableRow).map((n) => (
              <button
                key={n}
                disabled={busy}
                onClick={() => handleSplit(mergedGroupOf(splitTableRow).join('+'), n)}
                className="touch-target rounded-lg border border-border px-3 text-sm hover:border-brand hover:text-brand disabled:opacity-50"
              >
                Keep on #{n}
              </button>
            ))}
            <button
              disabled={busy}
              onClick={() => setSplitTableRow(null)}
              className="touch-target rounded-lg px-3 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {assignServerTable && (
        <div className="fixed bottom-4 left-1/2 w-full max-w-md -translate-x-1/2 rounded-xl border border-border bg-surface-raised p-4 shadow-lg">
          <p className="mb-2 text-sm font-medium text-ink">
            Assign a server to table #{assignServerTable.table_number}:
          </p>
          <div className="flex flex-wrap gap-2">
            {staff.length === 0 && <p className="text-sm text-ink-muted">No staff found.</p>}
            {staff.map((s) => (
              <button
                key={s.id}
                disabled={busy}
                onClick={() => handleAssignServer(s.id)}
                className="touch-target rounded-lg border border-border px-3 text-sm hover:border-brand hover:text-brand disabled:opacity-50"
              >
                {s.name}
              </button>
            ))}
            {assignServerTable.assigned_server_id != null && (
              <button
                disabled={busy}
                onClick={() => handleAssignServer(null)}
                className="touch-target rounded-lg px-3 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
              >
                Clear assignment
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => setAssignServerTable(null)}
              className="touch-target rounded-lg px-3 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <BillPreviewDialog
        open={billTable !== null}
        onClose={() => setBillTable(null)}
        tableNumber={billTable?.table_number ?? ''}
        order={billTable ? tableOrders[billTable.table_number] ?? null : null}
        menuItems={menuItems}
      />
    </main>
  );
}
