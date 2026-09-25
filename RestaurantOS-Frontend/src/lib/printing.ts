'use client';

/**
 * Real receipt / kitchen-ticket printing (task #46, PrinterService abstraction). Ties
 * together three pieces that already existed separately but were never connected:
 *   1. hardware.js's ESC/POS bridge (Electron main process) -- real, protocol-correct, but
 *      UNVERIFIED against physical hardware (no printer attached to this dev environment).
 *   2. desktop.ts's typed IPC wrapper around it.
 *   3. Nothing, until now, ever called it for an actual receipt or kitchen ticket -- every
 *      checkout/kitchen flow only ever used the browser's native window.print().
 *
 * This file is the missing middle layer: it builds a plain, serializable "ticket" (see
 * PrintInstruction in desktop.ts -- IPC can't carry functions, so the ticket is data, not
 * code) from real order data, and tries to send it to whichever printer the user configured
 * in Settings > Printers or the setup wizard. If there's no desktop bridge (browser preview
 * or a still-unconfigured machine), no printer configured, or the print call itself fails
 * (e.g. hardware.js's honest "escpos isn't installed" error), it falls back to a plain HTML
 * ticket through the browser's native print dialog -- so printing always does SOMETHING
 * useful today, and silently gets better once real hardware is verified and configured.
 */
import { getDesktopBridge, PrintInstruction } from './desktop';
import { parsePrice } from './tax';
import { CartLine } from './types';

export type PrinterRole = 'receipt' | 'kitchen';

export interface ConfiguredPrinter {
  id: string;
  type: 'usb' | 'network' | 'bluetooth';
  address?: string;
  label: string;
}

const CONFIG_KEY: Record<PrinterRole, string> = {
  receipt: 'printer:receipt',
  kitchen: 'printer:kitchen',
};

export async function getConfiguredPrinter(role: PrinterRole): Promise<ConfiguredPrinter | null> {
  const bridge = getDesktopBridge();
  if (!bridge) return null;
  const value = await bridge.getConfig(CONFIG_KEY[role]);
  return (value as ConfiguredPrinter | undefined) ?? null;
}

export async function setConfiguredPrinter(role: PrinterRole, printer: ConfiguredPrinter | null): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  await bridge.setConfig(CONFIG_KEY[role], printer);
}

export type CashDrawerResult = 'kicked' | 'no-printer-configured' | 'no-bridge';

/**
 * Real cash-drawer kick (SaaS design pass, 2026-09-25 -- PosHeader's "Drawer Kick" quick
 * action). Most restaurant cash drawers aren't network devices at all -- they're wired
 * through the receipt printer's kick-out port, and ESC/POS already has a standard "pulse the
 * drawer pin" command for exactly this. That command has existed in this codebase's ticket
 * vocabulary since printing.ts was first built (see `PrintInstruction`'s `{ op: 'cashdraw' }`
 * variant and hardware.js's ESC/POS bridge) but nothing ever actually sent one -- every
 * checkout flow only ever printed a receipt, never kicked the drawer on its own. This reuses
 * the SAME bridge.openCashDrawer(printerId) the preload.js/hardware.js pair already expose,
 * targeting whichever printer is configured for receipts (the drawer is normally daisy-chained
 * off that one). Same honesty caveat as the rest of this file: protocol-correct, unverified
 * against physical hardware in this dev environment.
 */
export async function openCashDrawer(): Promise<CashDrawerResult> {
  const bridge = getDesktopBridge();
  if (!bridge) return 'no-bridge';
  const printer = await getConfiguredPrinter('receipt');
  if (!printer) return 'no-printer-configured';
  await bridge.openCashDrawer(printer.id);
  return 'kicked';
}

export interface TicketLine {
  name: string;
  qty: number;
  weight?: number;
  weightUnit?: string;
  linePrice: number;
  // Modifiers (CTO forensic audit 2026-09-20): plain display strings (e.g. "Extra cheese
  // (+€1.50)"), already formatted -- receipts/tickets just need to print them, not recompute
  // anything from them. This is the one place in the whole modifier feature that is fully,
  // certifiably accurate end-to-end, since it reads straight from the client-side cart lines
  // that were actually charged, with no lossy flat-map round trip in between.
  modifiers?: string[];
  // Per-line note ("no onions", "extra crispy") -- OrderSidebar's note drawer (SaaS design
  // pass, 2026-09-25). Only meaningful for kitchen tickets (a customer receipt doesn't need
  // a prep instruction repeated on it), so only buildKitchenTicket/kitchenTicketHtml read it.
  note?: string;
}

export interface ReceiptData {
  tableNumber?: string | null;
  orderId?: string | number | null;
  lines: TicketLine[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod?: string;
}

export interface KitchenTicketData {
  tableNumber?: string | null;
  orderId?: string | number | null;
  lines: TicketLine[];
  note?: string;
}

export function cartLinesToTicketLines(lines: CartLine[]): TicketLine[] {
  return lines.map((l) => {
    const modifiersTotal = (l.modifiers ?? []).reduce((sum, m) => sum + (Number(m.price_delta) || 0), 0);
    const unitPrice = parsePrice(l.item.price) + modifiersTotal;
    return {
      name: l.item.name,
      qty: l.qty,
      weight: l.weight,
      weightUnit: l.item.weight_unit,
      linePrice: unitPrice * (l.weight ?? l.qty),
      modifiers: (l.modifiers ?? []).map((m) =>
        m.price_delta ? `${m.name} (+€${m.price_delta.toFixed(2)})` : m.name
      ),
      note: l.note,
    };
  });
}

function lineQtyLabel(line: TicketLine): string {
  return typeof line.weight === 'number' ? `${line.weight.toFixed(3)}${line.weightUnit || 'kg'}` : `${line.qty}x`;
}

function buildReceiptTicket(data: ReceiptData): PrintInstruction[] {
  const ticket: PrintInstruction[] = [
    { op: 'align', value: 'ct' },
    { op: 'style', bold: true, size: [2, 2] },
    { op: 'text', value: 'Asmara' },
    { op: 'style', bold: false, size: [1, 1] },
    { op: 'feed', lines: 1 },
    { op: 'text', value: new Date().toLocaleString() },
  ];
  if (data.tableNumber) ticket.push({ op: 'text', value: `Table #${data.tableNumber}` });
  if (data.orderId) ticket.push({ op: 'text', value: `Order #${data.orderId}` });
  ticket.push({ op: 'feed', lines: 1 }, { op: 'rule' }, { op: 'align', value: 'lt' });

  for (const line of data.lines) {
    ticket.push({ op: 'text', value: `${lineQtyLabel(line)}  ${line.name}` });
    if (line.modifiers && line.modifiers.length > 0) {
      ticket.push({ op: 'text', value: `   ${line.modifiers.join(', ')}` });
    }
    ticket.push({ op: 'align', value: 'rt' }, { op: 'text', value: `EUR ${line.linePrice.toFixed(2)}` }, { op: 'align', value: 'lt' });
  }

  ticket.push(
    { op: 'rule' },
    { op: 'align', value: 'rt' },
    { op: 'text', value: `Subtotal  EUR ${data.subtotal.toFixed(2)}` },
    { op: 'text', value: `VAT       EUR ${data.tax.toFixed(2)}` },
    { op: 'style', bold: true },
    { op: 'text', value: `TOTAL     EUR ${data.total.toFixed(2)}` },
    { op: 'style', bold: false },
    { op: 'align', value: 'ct' },
    { op: 'feed', lines: 1 },
  );
  if (data.paymentMethod) ticket.push({ op: 'text', value: `Paid by ${data.paymentMethod}` });
  ticket.push({ op: 'text', value: 'Thank you!' }, { op: 'feed', lines: 3 });
  return ticket;
}

function buildKitchenTicket(data: KitchenTicketData): PrintInstruction[] {
  const ticket: PrintInstruction[] = [
    { op: 'align', value: 'ct' },
    { op: 'style', bold: true, size: [2, 2] },
    { op: 'text', value: data.tableNumber ? `TABLE ${data.tableNumber}` : 'DIRECT SALE' },
    { op: 'style', bold: false, size: [1, 1] },
    { op: 'text', value: new Date().toLocaleTimeString() },
    { op: 'feed', lines: 1 },
    { op: 'rule' },
    { op: 'align', value: 'lt' },
    { op: 'style', size: [2, 2] },
  ];
  for (const line of data.lines) {
    ticket.push({ op: 'text', value: `${lineQtyLabel(line)}  ${line.name}` }, { op: 'feed', lines: 1 });
    if (line.modifiers && line.modifiers.length > 0) {
      ticket.push({ op: 'style', size: [1, 1] }, { op: 'text', value: `   ${line.modifiers.join(', ')}` }, { op: 'style', size: [2, 2] }, { op: 'feed', lines: 1 });
    }
    if (line.note) {
      ticket.push({ op: 'style', size: [1, 1] }, { op: 'text', value: `   * ${line.note}` }, { op: 'style', size: [2, 2] }, { op: 'feed', lines: 1 });
    }
  }
  ticket.push({ op: 'style', size: [1, 1] });
  if (data.note) ticket.push({ op: 'rule' }, { op: 'text', value: `Note: ${data.note}` });
  ticket.push({ op: 'feed', lines: 3 });
  return ticket;
}

function receiptHtml(data: ReceiptData): string {
  const rows = data.lines
    .map((l) => {
      const modLine =
        l.modifiers && l.modifiers.length > 0
          ? `<tr><td colspan="2" style="color:#666;font-size:11px;padding-left:10px">${escapeHtml(l.modifiers.join(', '))}</td></tr>`
          : '';
      return `<tr><td>${lineQtyLabel(l)} ${escapeHtml(l.name)}</td><td style="text-align:right">€${l.linePrice.toFixed(2)}</td></tr>${modLine}`;
    })
    .join('');
  return `<!doctype html><html><head><title>Receipt</title><style>
    body{font-family:monospace;width:280px;margin:0 auto;padding:12px;font-size:13px}
    h1{text-align:center;font-size:18px;margin:0 0 4px}
    .meta{text-align:center;color:#555;margin-bottom:8px}
    table{width:100%;border-collapse:collapse}
    td{padding:2px 0}
    .rule{border-top:1px dashed #000;margin:6px 0}
    .total{font-weight:bold;font-size:15px}
    .center{text-align:center}
  </style></head><body>
    <h1>Asmara</h1>
    <div class="meta">${new Date().toLocaleString()}${data.tableNumber ? ` · Table #${escapeHtml(String(data.tableNumber))}` : ''}${data.orderId ? ` · #${escapeHtml(String(data.orderId))}` : ''}</div>
    <div class="rule"></div>
    <table>${rows}</table>
    <div class="rule"></div>
    <table>
      <tr><td>Subtotal</td><td style="text-align:right">€${data.subtotal.toFixed(2)}</td></tr>
      <tr><td>VAT</td><td style="text-align:right">€${data.tax.toFixed(2)}</td></tr>
      <tr class="total"><td>Total</td><td style="text-align:right">€${data.total.toFixed(2)}</td></tr>
    </table>
    <p class="center">${data.paymentMethod ? `Paid by ${escapeHtml(data.paymentMethod)}<br/>` : ''}Thank you!</p>
  </body></html>`;
}

function kitchenTicketHtml(data: KitchenTicketData): string {
  const rows = data.lines
    .map((l) => {
      const modLine =
        l.modifiers && l.modifiers.length > 0
          ? `<div class="line" style="font-size:12px;font-weight:normal;padding-left:14px">${escapeHtml(l.modifiers.join(', '))}</div>`
          : '';
      const noteLine = l.note
        ? `<div class="line" style="font-size:12px;font-weight:normal;font-style:italic;padding-left:14px">* ${escapeHtml(l.note)}</div>`
        : '';
      return `<div class="line">${lineQtyLabel(l)} ${escapeHtml(l.name)}</div>${modLine}${noteLine}`;
    })
    .join('');
  return `<!doctype html><html><head><title>Kitchen ticket</title><style>
    body{font-family:monospace;width:280px;margin:0 auto;padding:12px}
    h1{text-align:center;font-size:20px;margin:0}
    .meta{text-align:center;color:#555;margin-bottom:8px}
    .rule{border-top:1px dashed #000;margin:6px 0}
    .line{font-size:18px;font-weight:bold;padding:2px 0}
    .note{margin-top:8px;font-style:italic}
  </style></head><body>
    <h1>${data.tableNumber ? `TABLE ${escapeHtml(String(data.tableNumber))}` : 'DIRECT SALE'}</h1>
    <div class="meta">${new Date().toLocaleTimeString()}</div>
    <div class="rule"></div>
    ${rows}
    ${data.note ? `<div class="rule"></div><div class="note">Note: ${escapeHtml(data.note)}</div>` : ''}
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// Opens a small popup window with the given HTML and triggers the browser's native print
// dialog -- the same fallback pattern used everywhere else in this app that already prints
// (BillPreviewDialog, CustomerLoyaltyDialog), just reusable for content that isn't already
// on screen. If the popup is blocked, this silently does nothing rather than throwing --
// printing is a convenience here, never something that should crash a checkout that already
// succeeded.
function printHtmlFallback(html: string) {
  try {
    const win = window.open('', '_blank', 'width=380,height=600');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    win.onafterprint = () => win.close();
  } catch {
    // Popup blocked or print() unavailable in this context -- nothing more to do.
  }
}

async function tryHardwarePrint(role: PrinterRole, ticket: PrintInstruction[]): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge) return false;
  const printer = await getConfiguredPrinter(role);
  if (!printer) return false;
  try {
    await bridge.print({ printerId: printer.id, type: printer.type, address: printer.address, ticket });
    return true;
  } catch (err) {
    console.warn(`[printing] hardware print failed for ${role} printer, falling back to browser print:`, err);
    return false;
  }
}

/** Called right after a sale is charged successfully. */
export async function printReceipt(data: ReceiptData): Promise<void> {
  const printed = await tryHardwarePrint('receipt', buildReceiptTicket(data));
  if (!printed) printHtmlFallback(receiptHtml(data));
}

/** Called right after an order is sent to the kitchen. */
export async function printKitchenTicket(data: KitchenTicketData): Promise<void> {
  const printed = await tryHardwarePrint('kitchen', buildKitchenTicket(data));
  if (!printed) printHtmlFallback(kitchenTicketHtml(data));
}

// Decoupling "view/print bill" from "close table" (CTO forensic audit 2026-09-20): a waiter
// needs to hand a customer a running total mid-meal without that action being anywhere near
// charging the order or freeing the table -- the existing printReceipt/chargeOrder/
// finishOrder flow only ever runs together, at actual checkout. This is a clearly-labeled
// "BILL -- not yet paid" ticket that only ever reads data, calling neither chargeOrder nor
// finishOrder, and prints through the exact same hardware/fallback path as a real receipt.
function buildBillTicket(data: ReceiptData): PrintInstruction[] {
  const ticket: PrintInstruction[] = [
    { op: 'align', value: 'ct' },
    { op: 'style', bold: true, size: [2, 2] },
    { op: 'text', value: 'Asmara' },
    { op: 'style', bold: false, size: [1, 1] },
    { op: 'text', value: 'BILL -- not a receipt' },
    { op: 'feed', lines: 1 },
    { op: 'text', value: new Date().toLocaleString() },
  ];
  if (data.tableNumber) ticket.push({ op: 'text', value: `Table #${data.tableNumber}` });
  if (data.orderId) ticket.push({ op: 'text', value: `Order #${data.orderId}` });
  ticket.push({ op: 'feed', lines: 1 }, { op: 'rule' }, { op: 'align', value: 'lt' });

  for (const line of data.lines) {
    ticket.push({ op: 'text', value: `${lineQtyLabel(line)}  ${line.name}` });
    if (line.modifiers && line.modifiers.length > 0) {
      ticket.push({ op: 'text', value: `   ${line.modifiers.join(', ')}` });
    }
    ticket.push({ op: 'align', value: 'rt' }, { op: 'text', value: `EUR ${line.linePrice.toFixed(2)}` }, { op: 'align', value: 'lt' });
  }

  ticket.push(
    { op: 'rule' },
    { op: 'align', value: 'rt' },
    { op: 'text', value: `Subtotal  EUR ${data.subtotal.toFixed(2)}` },
    { op: 'text', value: `VAT       EUR ${data.tax.toFixed(2)}` },
    { op: 'style', bold: true },
    { op: 'text', value: `TOTAL DUE EUR ${data.total.toFixed(2)}` },
    { op: 'style', bold: false },
    { op: 'align', value: 'ct' },
    { op: 'feed', lines: 3 },
  );
  return ticket;
}

function billHtml(data: ReceiptData): string {
  const rows = data.lines
    .map((l) => {
      const modLine =
        l.modifiers && l.modifiers.length > 0
          ? `<tr><td colspan="2" style="color:#666;font-size:11px;padding-left:10px">${escapeHtml(l.modifiers.join(', '))}</td></tr>`
          : '';
      return `<tr><td>${lineQtyLabel(l)} ${escapeHtml(l.name)}</td><td style="text-align:right">€${l.linePrice.toFixed(2)}</td></tr>${modLine}`;
    })
    .join('');
  return `<!doctype html><html><head><title>Bill</title><style>
    body{font-family:monospace;width:280px;margin:0 auto;padding:12px;font-size:13px}
    h1{text-align:center;font-size:18px;margin:0 0 4px}
    .meta{text-align:center;color:#555;margin-bottom:8px}
    .badge{text-align:center;font-weight:bold;color:#b45309;margin-bottom:4px}
    table{width:100%;border-collapse:collapse}
    td{padding:2px 0}
    .rule{border-top:1px dashed #000;margin:6px 0}
    .total{font-weight:bold;font-size:15px}
  </style></head><body>
    <h1>Asmara</h1>
    <div class="badge">BILL -- not a receipt</div>
    <div class="meta">${new Date().toLocaleString()}${data.tableNumber ? ` · Table #${escapeHtml(String(data.tableNumber))}` : ''}${data.orderId ? ` · #${escapeHtml(String(data.orderId))}` : ''}</div>
    <div class="rule"></div>
    <table>${rows}</table>
    <div class="rule"></div>
    <table>
      <tr><td>Subtotal</td><td style="text-align:right">€${data.subtotal.toFixed(2)}</td></tr>
      <tr><td>VAT</td><td style="text-align:right">€${data.tax.toFixed(2)}</td></tr>
      <tr class="total"><td>Total due</td><td style="text-align:right">€${data.total.toFixed(2)}</td></tr>
    </table>
  </body></html>`;
}

/**
 * Prints a running bill for the table's CURRENT order state -- purely informational, never
 * charges anything and never touches the table's status. Safe to call as many times as a
 * customer asks to see the total again mid-meal.
 */
export async function printBillPreview(data: ReceiptData): Promise<void> {
  const printed = await tryHardwarePrint('receipt', buildBillTicket(data));
  if (!printed) printHtmlFallback(billHtml(data));
}
