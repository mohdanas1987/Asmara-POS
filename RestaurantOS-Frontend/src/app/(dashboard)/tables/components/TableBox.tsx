'use client';

/**
 * Table/Floor management redesign (project audit 2026-09-15, task "Table/Floor management
 * redesign"): now shows seat count, section, the order's running amount, and elapsed
 * seated time -- the old app's actual floor-plan richness the audit found this screen was
 * missing entirely. Uses design-system tokens (surface/border/ink) instead of hardcoded
 * neutral-* classes so it looks right in dark mode too.
 */
import { useRef } from 'react';
import clsx from 'clsx';
import { TableRow, TableOrderInfo } from '@/lib/types';
import { useElapsedMinutes } from '@/lib/hooks/useElapsedMinutes';

const STATUS_STYLES: Record<string, string> = {
  success: 'bg-emerald-100 border-emerald-400 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-100',
  primary: 'bg-blue-100 border-blue-400 text-blue-900 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-100',
  warning: 'bg-amber-100 border-amber-400 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100',
  danger: 'bg-rose-100 border-rose-400 text-rose-900 dark:bg-rose-950 dark:border-rose-700 dark:text-rose-100',
};

export function TableBox({
  table,
  order,
  onMove,
  onClick,
  onTransferClick,
  selected,
  selectionMode,
  busy,
}: {
  table: TableRow;
  order?: TableOrderInfo;
  onMove: (x: number, y: number) => void;
  onClick: () => void;
  onTransferClick?: () => void;
  selected: boolean;
  selectionMode?: boolean; // true while picking tables to merge/free-selected
  busy?: boolean;
}) {
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const moved = useRef(false);
  const elapsedMinutes = useElapsedMinutes(order?.created_at);

  function handlePointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: table.x, origY: table.y };
    moved.current = false;
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragState.current || selectionMode) return; // don't drag while picking tables
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;
    if (moved.current) {
      onMove(dragState.current.origX + dx, dragState.current.origY + dy);
    }
  }

  function handlePointerUp() {
    dragState.current = null;
    if (!moved.current && !busy) onClick();
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'absolute',
        left: table.x,
        top: table.y,
        width: Math.max(table.length, 96),
        height: Math.max(table.width, 72),
      }}
      className={clsx(
        'relative flex select-none flex-col items-center justify-center gap-0.5 rounded-xl border-2 p-1 text-sm font-semibold shadow-md transition-shadow hover:shadow-lg',
        selectionMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        STATUS_STYLES[table.className] ?? STATUS_STYLES.danger,
        selected && 'ring-2 ring-brand ring-offset-2',
        busy && 'opacity-60'
      )}
    >
      {table.section && (
        <span className="absolute -top-2 left-1 rounded bg-surface px-1 text-[9px] font-normal text-ink-muted shadow-sm">
          {table.section}
        </span>
      )}

      <span className="text-base font-bold tracking-tight">#{table.table_number}</span>

      <span className="flex items-center gap-1 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-medium capitalize opacity-90 dark:bg-white/10">
        {table.status}
        {typeof table.capacity === 'number' && (
          <span aria-label={`${table.capacity} seats`}>· 👥{table.capacity}</span>
        )}
      </span>

      {order && (
        <span className="text-[10px] font-normal opacity-80">
          {order.total != null && `€${Number(order.total).toFixed(2)}`}
          {elapsedMinutes != null && ` · ${elapsedMinutes}m`}
        </span>
      )}

      {onTransferClick && !selectionMode && (
        <button
          type="button"
          title="Move this order to another table"
          // Owner-reported bug: tapping this icon was landing the user inside the POS
          // product grid instead of the move flow. `onPointerDown`'s stopPropagation only
          // blocked the table's DRAG from starting -- the browser's native pointerup event
          // still bubbled up to the table box's own onPointerUp handler (a separate listener,
          // not stopped by stopping pointerdown or click), which then ran its "was this a
          // plain tap, not a drag?" check and fired the table's OWN onClick (open this
          // table's order) right along with this button's onClick. Stopping pointerup here
          // too closes that gap.
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onTransferClick();
          }}
          className="touch-target absolute -right-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-xs shadow-sm hover:border-brand hover:text-brand"
        >
          ⇄
        </button>
      )}

      {selectionMode && (
        <span
          className={clsx(
            'absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs',
            selected ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-ink-muted'
          )}
          aria-hidden="true"
        >
          {selected ? '✓' : ''}
        </span>
      )}
    </div>
  );
}
