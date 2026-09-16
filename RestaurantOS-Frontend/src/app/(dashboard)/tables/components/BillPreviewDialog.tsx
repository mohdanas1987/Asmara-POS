'use client';

/**
 * Table/Floor management redesign (project audit 2026-09-15, task "Table/Floor management
 * redesign"): "view bill / print bill" for an occupied table without leaving the floor
 * plan to open the full POS screen. Resolves the order's {productId: qty} map against the
 * menu items already loaded elsewhere in the dashboard (see useMenu()) for line-item names.
 */
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { TableOrderInfo, MenuItem } from '@/lib/types';
import { parsePrice } from '@/lib/tax';

export function BillPreviewDialog({
  open,
  onClose,
  tableNumber,
  order,
  menuItems,
}: {
  open: boolean;
  onClose: () => void;
  tableNumber: string;
  order: TableOrderInfo | null;
  menuItems: MenuItem[];
}) {
  const quantities = order?.data?.quantity ?? {};
  const lines = Object.entries(quantities)
    .map(([productId, qty]) => {
      const item = menuItems.find((m) => String(m.id) === String(productId));
      return { name: item?.name ?? `Item #${productId}`, price: parsePrice(item?.price), qty: Number(qty) };
    })
    .filter((line) => line.qty > 0);

  return (
    <Dialog open={open} onClose={onClose} title={`Bill — Table #${tableNumber}`}>
      <div id="bill-preview-printable">
        {lines.length === 0 && <p className="text-sm text-ink-muted">No items on this order yet.</p>}
        <ul className="divide-y divide-border">
          {lines.map((line) => (
            <li key={line.name} className="flex items-center justify-between py-2 text-sm">
              <span className="text-ink">{line.qty}× {line.name}</span>
              <span className="text-ink-muted">€{(line.price * line.qty).toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-base font-semibold text-ink">
          <span>Total</span>
          <span>€{order?.total != null ? parsePrice(order.total).toFixed(2) : '0.00'}</span>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={() => window.print()}>Print</Button>
      </div>
    </Dialog>
  );
}
