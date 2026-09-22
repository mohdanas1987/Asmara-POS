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

// Glossy, saturated gradient fills per status (not flat pastel) so the floor reads as
// colorful/attractive at a glance from across the room, plus a matching glow shadow for a
// touch of 3D depth -- each table looks like a little polished tile, not a bordered box.
const STATUS_STYLES: Record<string, string> = {
  success: 'text-white border-emerald-300/70',
  primary: 'text-white border-sky-300/70',
  warning: 'text-white border-amber-300/70',
  danger: 'text-white border-rose-300/70',
};
const STATUS_GRADIENT: Record<string, string> = {
  success: 'linear-gradient(155deg, #34D399 0%, #059669 60%, #047857 100%)',
  primary: 'linear-gradient(155deg, #60A5FA 0%, #2563EB 60%, #1D4ED8 100%)',
  warning: 'linear-gradient(155deg, #FBBF24 0%, #F59E0B 60%, #D97706 100%)',
  danger: 'linear-gradient(155deg, #FB7185 0%, #E11D48 60%, #BE123C 100%)',
};
const STATUS_GLOW: Record<string, string> = {
  success: '0 6px 16px -4px rgba(5,150,105,0.55)',
  primary: '0 6px 16px -4px rgba(37,99,235,0.55)',
  warning: '0 6px 16px -4px rgba(217,119,6,0.55)',
  danger: '0 6px 16px -4px rgba(190,18,60,0.55)',
};

export function TableBox({
  table,
  order,
  onMove,
  onClick,
  onTransferClick,
  onAssignServerClick,
  serverName,
  selected,
  selectionMode,
  busy,
}: {
  table: TableRow;
  order?: TableOrderInfo;
  onMove: (x: number, y: number) => void;
  onClick: () => void;
  onTransferClick?: () => void;
  // Seat / server assignment (CTO forensic audit 2026-09-21, P1): who's serving this table
  // right now. Both optional so callers that don't care (e.g. a future read-only floor
  // view) don't need to wire anything.
  onAssignServerClick?: () => void;
  serverName?: string | null;
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
        backgroundImage: STATUS_GRADIENT[table.className] ?? STATUS_GRADIENT.danger,
        boxShadow: STATUS_GLOW[table.className] ?? STATUS_GLOW.danger,
      }}
      className={clsx(
        'touch-target relative flex select-none flex-col items-center justify-center gap-0.5 rounded-xl border-2 p-1 text-sm font-semibold transition-transform hover:-translate-y-0.5 hover:scale-[1.02]',
        selectionMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        STATUS_STYLES[table.className] ?? STATUS_STYLES.danger,
        selected && 'ring-2 ring-white ring-offset-2 ring-offset-transparent',
        busy && 'opacity-60'
      )}
    >
      {/* Glossy top highlight -- a soft light streak across the upper third, the classic
          "polished tile" 3D cue, purely decorative so it never interferes with drag/click. */}
      <div
        className="pointer-events-none absolute inset-x-1 top-1 h-1/3 rounded-lg bg-white/25 blur-[2px]"
        aria-hidden="true"
      />
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

      {serverName && (
        <span className="text-[9px] font-normal italic opacity-70">👤 {serverName}</span>
      )}

      {onAssignServerClick && !selectionMode && (
        <button
          type="button"
          title={serverName ? `Serving: ${serverName} (tap to change)` : 'Assign a server to this table'}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onAssignServerClick();
          }}
          className="touch-target absolute -left-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-xs shadow-sm hover:border-brand hover:text-brand"
        >
          {serverName ? '🧑\u200d🍳' : '👤'}
        </button>
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
