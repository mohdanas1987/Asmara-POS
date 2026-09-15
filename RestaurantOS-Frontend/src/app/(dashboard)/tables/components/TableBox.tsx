'use client';

import { useRef } from 'react';
import clsx from 'clsx';
import { TableRow } from '@/lib/types';

const STATUS_STYLES: Record<string, string> = {
  success: 'bg-emerald-100 border-emerald-400 text-emerald-900',
  primary: 'bg-blue-100 border-blue-400 text-blue-900',
  warning: 'bg-amber-100 border-amber-400 text-amber-900',
  danger: 'bg-rose-100 border-rose-400 text-rose-900',
};

export function TableBox({
  table,
  onMove,
  onClick,
  onTransferClick,
  selected,
  busy,
}: {
  table: TableRow;
  onMove: (x: number, y: number) => void;
  onClick: () => void;
  onTransferClick?: () => void;
  selected: boolean;
  busy?: boolean;
}) {
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const moved = useRef(false);

  function handlePointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: table.x, origY: table.y };
    moved.current = false;
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragState.current) return;
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
        width: table.length,
        height: table.width,
      }}
      className={clsx(
        'relative flex cursor-grab select-none flex-col items-center justify-center rounded-lg border-2 text-sm font-semibold shadow-sm active:cursor-grabbing',
        STATUS_STYLES[table.className] ?? STATUS_STYLES.danger,
        selected && 'ring-2 ring-brand ring-offset-2',
        busy && 'opacity-60'
      )}
    >
      <span>#{table.table_number}</span>
      <span className="text-[10px] font-normal capitalize opacity-70">{table.status}</span>

      {onTransferClick && (
        <button
          type="button"
          title="Move this order to another table"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onTransferClick();
          }}
          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs shadow-sm hover:border-brand hover:text-brand"
        >
          ⇄
        </button>
      )}
    </div>
  );
}
