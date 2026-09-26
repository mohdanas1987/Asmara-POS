'use client';

import { useCallback, useEffect, useState } from 'react';
import { getTables, updateTablePosition, transferTable, assignTableServer, freeAllTables, freeSelectedTables, mergeTables, splitTable, getOrders, initTableOrder } from '@/lib/api';
import { getTerminalId } from '@/lib/terminal';
import { TableRow, TableOrderInfo } from '@/lib/types';
import { loadWithCache } from '@/lib/offline/cache';
import { isNetworkError } from '@/lib/offline/network';
import { createOfflineOrder } from '@/lib/offline/offlineOrders';
import { enqueueAction } from '@/lib/offline/outbox';

export function useTables() {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [tableOrders, setTableOrders] = useState<Record<string, TableOrderInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  // Offline-first POS operation (CTO forensic audit 2026-09-21, P0 -- "menu/orders/tables are
  // unavailable if the network drops"): falls back to the last successfully-fetched floor
  // plan (IndexedDB, see lib/offline/cache.ts) so the Tables screen still shows something
  // useful during a network blip, instead of going blank. Mutating actions below
  // (moveTable/transfer/freeAll/merge/split/openTable) are deliberately NOT cache-backed --
  // they change server state (or, for openTable on a free table, create a brand-new order),
  // which needs a real network round trip and is out of this pass's offline scope.
  const refresh = useCallback(async () => {
    try {
      const [tablesResult, ordersResult] = await Promise.all([
        loadWithCache('tables.list', () => getTables()),
        loadWithCache('tables.orders', () => getOrders()),
      ]);
      setTables(tablesResult.value.tables);
      setTableOrders(ordersResult.value.tableOrders ?? {});
      setStale(tablesResult.stale || ordersResult.stale);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const moveTable = useCallback(
    async (tableNumber: string, x: number, y: number) => {
      // Optimistic update -- matches the "instant" feel this whole app is built for.
      setTables((prev) => prev.map((t) => (t.table_number === tableNumber ? { ...t, x, y } : t)));
      try {
        await updateTablePosition(tableNumber, x, y);
      } catch {
        refresh(); // roll back to server truth if the write failed
      }
    },
    [refresh]
  );

  const transfer = useCallback(
    async (fromTable: string, toTable: string) => {
      // terminal_id (task #47): lets the backend's sync log attribute this change to a real
      // terminal instead of falling back to 'unknown-terminal'.
      const terminalId = getTerminalId();
      // Optimistic update (offline-first requirement, item 6 -- "table transfers must
      // survive network loss"): move the order between tables in local state immediately so
      // the cashier isn't blocked staring at a spinner while genuinely offline, exactly the
      // same UX moveTable()/assignServer() above already give every OTHER table mutation.
      setTables((prev) =>
        prev.map((t) => {
          if (t.table_number === fromTable) return { ...t, status: 'free', className: 'success' };
          if (t.table_number === toTable) return { ...t, status: 'occupied', className: 'danger' };
          return t;
        })
      );
      setTableOrders((prev) => {
        const moving = prev[fromTable];
        if (!moving) return prev;
        const next = { ...prev };
        delete next[fromTable];
        next[toTable] = moving;
        return next;
      });
      try {
        await transferTable(fromTable, toTable, terminalId);
        await refresh();
      } catch (err) {
        if (!isNetworkError(err)) {
          refresh(); // a real server rejection -- roll back to server truth, don't keep a bad optimistic move
          throw err;
        }
        // Genuinely offline: queue the real transfer for the moment connectivity returns.
        // KNOWN LIMITATION (documented, not silently papered over): unlike orders.to-kitchen
        // /orders.create, this route has no backend idempotency key -- a blind retry after a
        // response was lost but the transfer actually succeeded is not automatically
        // deduplicated. It is, however, safe by construction rather than silently
        // duplicating anything: /tables/transfer's own precondition checks require the
        // destination to be free and the source to have an active, non-completed order, so a
        // retry of an already-succeeded transfer fails closed (a clear, visible sync error)
        // instead of moving the order a second time or corrupting table state.
        await enqueueAction({
          type: 'tables.transfer',
          path: '/tables/transfer',
          body: { fromTable, toTable, terminalId },
          label: `Transfer table ${fromTable} -> ${toTable}`,
        });
      }
    },
    [refresh]
  );

  // Seat / server assignment (CTO forensic audit 2026-09-21, P1 -- "who is serving this
  // table right now" is currently invisible). Optimistic update for the same instant feel as
  // moveTable, rolling back to server truth on failure.
  const assignServer = useCallback(
    async (tableNumber: string, serverId: number | null) => {
      setTables((prev) =>
        prev.map((t) => (t.table_number === tableNumber ? { ...t, assigned_server_id: serverId } : t))
      );
      try {
        await assignTableServer(tableNumber, serverId);
      } catch {
        refresh(); // roll back to server truth if the write failed
      }
    },
    [refresh]
  );

  const freeAll = useCallback(async () => {
    await freeAllTables();
    await refresh();
  }, [refresh]);

  // Table/Floor management redesign (project audit 2026-09-15): "free selected" (a manual
  // reset for specific stuck/incorrect tables) as opposed to freeAll's whole-floor reset.
  const freeSelected = useCallback(
    async (tableNumbers: string[]) => {
      await freeSelectedTables(tableNumbers);
      await refresh();
    },
    [refresh]
  );

  // Owner-reported bug: merging tables "did not work" -- mergeTables() alone only tags the
  // selected tables' `linked_to` metadata; it never actually started an order spanning them,
  // so nothing ever visibly changed after confirming a merge. GET /orders/init/:table already
  // supports a "+"-joined combo (routes/orders.js skips the single-table free-status check
  // for one and creates an order with `tables: "1+2"`) -- this just calls it the same way
  // openTable() does for a single free table, so merging behaves like tapping a free table:
  // it opens one shared order and hands back where to navigate.
  const merge = useCallback(
    async (tableNumbers: string[]): Promise<{ tableNumber: string; orderId: number }> => {
      await mergeTables(tableNumbers);
      const combined = tableNumbers.join('+');
      const res = await initTableOrder(combined);
      if (!res.status || !res.order) {
        throw new Error(res.message || 'Tables were linked, but the shared order could not be started.');
      }
      await refresh();
      return { tableNumber: combined, orderId: res.order.id };
    },
    [refresh]
  );

  // Table split (CTO forensic audit 2026-09-20): the real counterpart to merge() above --
  // unlinks a merged group and keeps its running order on `keepOn`, freeing the rest, rather
  // than the old backend behavior of deleting the order outright. `tableNumber` is any member
  // of the merged group (its own `linked_to` string carries the full group).
  const split = useCallback(
    async (tableNumber: string, keepOn?: string) => {
      await splitTable(tableNumber, keepOn);
      await refresh();
    },
    [refresh]
  );

  // Clicking a table: free -> starts a brand-new order there (real backend call, locks the
  // table amber immediately). Occupied/ongoing -> resumes whichever order is already open
  // on it (looked up from GET /orders/'s tableOrders map -- no guessing, no separate fetch).
  // Returns the table number + order id the caller should navigate the POS screen to.
  const openTable = useCallback(
    async (table: TableRow): Promise<{ tableNumber: string; orderId: number | string }> => {
      if (table.status === 'free') {
        try {
          const res = await initTableOrder(table.table_number);
          if (!res.status || !res.order) {
            throw new Error(res.message || 'Could not start an order on this table.');
          }
          await refresh();
          return { tableNumber: table.table_number, orderId: res.order.id };
        } catch (err) {
          // True offline-first new order creation (CTO remediation doc, Section 1): a genuine
          // network failure (not the server telling us the table isn't actually free -- see
          // lib/offline/network.ts) falls back to a LOCAL placeholder order instead of leaving
          // the cashier stuck with "table is offline, cannot be used." The local order is
          // queued for real sync the moment connectivity returns (offlineOrders.ts); every
          // downstream action (add items, send to kitchen, checkout) already queues offline
          // too, unchanged by this fallback. `refresh()` is skipped here on purpose -- there
          // is no network to refresh FROM, and the cached table list already shown is what
          // this whole fallback is trusting to still be accurate.
          if (!isNetworkError(err)) throw err;
          return createOfflineOrder({ tableNumber: table.table_number });
        }
      }
      const existing = tableOrders[table.table_number];
      if (!existing) {
        throw new Error(
          `Table #${table.table_number} shows "${table.status}" but has no open order -- try "Free all tables" to reset it.`
        );
      }
      return { tableNumber: table.table_number, orderId: existing.id };
    },
    [tableOrders, refresh]
  );

  return { tables, tableOrders, loading, error, stale, moveTable, transfer, assignServer, freeAll, freeSelected, merge, split, openTable, refresh };
}
