'use client';

/**
 * Printer configuration (task #46, PrinterService abstraction -- the missing piece after
 * lib/printing.ts and hardware.js were wired up: something has to let the user say WHICH
 * scanned printer is "the receipt printer" vs "the kitchen printer" and remember that
 * choice). The setup wizard's "Connect your printers" step only ever scanned and displayed
 * a list -- it never let anyone select or save one. Persists per-machine via the desktop
 * bridge's config store (same electron-store already used for setup's other settings),
 * since this is a hardware fact about THIS terminal, not tenant data that belongs on the
 * server.
 */
import { useEffect, useState } from 'react';
import { getDesktopBridge, PrinterInfo } from '@/lib/desktop';
import { ConfiguredPrinter, PrinterRole, getConfiguredPrinter, setConfiguredPrinter } from '@/lib/printing';
import { Button } from '@/components/ui/Button';

const ROLES: { role: PrinterRole; label: string; hint: string }[] = [
  { role: 'receipt', label: 'Receipt printer', hint: 'Prints the customer receipt when a sale is charged.' },
  { role: 'kitchen', label: 'Kitchen printer', hint: 'Prints a ticket in the kitchen whenever an order is sent there.' },
];

export default function PrintersSettingsPage() {
  const isDesktop = typeof window !== 'undefined' && Boolean(getDesktopBridge());
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Record<PrinterRole, ConfiguredPrinter | null>>({ receipt: null, kitchen: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([getConfiguredPrinter('receipt'), getConfiguredPrinter('kitchen')]).then(([receipt, kitchen]) => {
      setSelected({ receipt, kitchen });
      setLoaded(true);
    });
  }, []);

  async function scan() {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setScanning(true);
    try {
      const found = await bridge.listPrinters();
      setPrinters(found.filter((p) => p.type !== 'info'));
    } finally {
      setScanning(false);
    }
  }

  async function assign(role: PrinterRole, printer: PrinterInfo | null) {
    const configured: ConfiguredPrinter | null = printer
      ? { id: printer.id, type: printer.type as ConfiguredPrinter['type'], label: printer.label }
      : null;
    setSelected((prev) => ({ ...prev, [role]: configured }));
    await setConfiguredPrinter(role, configured);
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-neutral-900">🖨️ Printers</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Choose which connected printer handles receipts and which handles kitchen tickets.
        Printing falls back to your computer's normal print dialog for anything not assigned here.
      </p>

      {!isDesktop && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Printer hardware is only reachable from the desktop app -- this browser preview can't
          scan for or assign a physical printer. Every receipt and kitchen ticket will use your
          computer's normal print dialog until this is opened in the desktop app.
        </div>
      )}

      {isDesktop && (
        <Button onClick={scan} disabled={scanning} className="mb-4">
          {scanning ? 'Scanning…' : 'Scan for printers'}
        </Button>
      )}

      {loaded && (
        <div className="space-y-4">
          {ROLES.map(({ role, label, hint }) => (
            <div key={role} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <p className="font-semibold text-neutral-900">{label}</p>
              <p className="mb-3 text-xs text-neutral-500">{hint}</p>

              <select
                disabled={!isDesktop}
                value={selected[role]?.id ?? ''}
                onChange={(e) => {
                  const printer = printers.find((p) => p.id === e.target.value) ?? null;
                  assign(role, printer);
                }}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50 disabled:text-neutral-400"
              >
                <option value="">Not set -- use browser print dialog</option>
                {selected[role] && !printers.some((p) => p.id === selected[role]!.id) && (
                  <option value={selected[role]!.id}>{selected[role]!.label} (saved, scan again to refresh)</option>
                )}
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
