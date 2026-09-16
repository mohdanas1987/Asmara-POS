'use client';

import { useCallback, useEffect, useState } from 'react';
import { getTables, updateTablePosition, transferTable, freeAllTables, freeSelectedTables, mergeTables, getOrders, initTableOrder } from '@/lib/api';
import { getTerminalId } from '@/lib/terminal';
import { TableRow, TableOrderInfo } from '@/lib/types';

export function useTables() {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [tableOrders, setTableOrders] = useState<Record<string, TableOrderInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [tablesRes, ordersRes] = await Promise.all([getTables(), getOrders()]);
      setTables(tablesRes.tables);
      setTableOrders(ordersRes.tableOrders ?? {});
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
      await transferTable(fromTable, toTable, getTerminalId());
      await refresh();
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

  // Clicking a table: free -> starts a brand-new order there (real backend call, locks the
  // table amber immediately). Occupied/ongoing -> resumes whichever order is already open
  // on it (looked up from GET /orders/'s tableOrders map -- no guessing, no separate fetch).
  // Returns the table number + order id the caller should navigate the POS screen to.
  const openTable = useCallback(
    async (table: TableRow): Promise<{ tableNumber: string; orderId: number }> => {
      if (table.status === 'free') {
        const res = await initTableOrder(table.table_number);
        if (!res.status || !res.order) {
          throw new Error(res.message || 'Could not start an order on this table.');
        }
        await refresh();
        return { tableNumber: table.table_number, orderId: res.order.id };
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

  return { tables, tableOrders, loading, error, moveTable, transfer, freeAll, freeSelected, merge, openTable, refresh };
}
