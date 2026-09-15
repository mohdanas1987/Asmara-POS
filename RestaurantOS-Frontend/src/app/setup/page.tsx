'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDesktopBridge, PrinterInfo } from '@/lib/desktop';
import { WizardShell } from './components/WizardShell';
import Link from 'next/link';

type Mode = 'standalone' | 'cloud';

const STEPS = ['mode', 'printers', 'second-screen', 'scanner', 'payment', 'kitchen', 'review'] as const;
type Step = (typeof STEPS)[number];

export default function SetupWizard() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const step: Step = STEPS[stepIndex];

  const [mode, setMode] = useState<Mode>('standalone');
  const [branchName, setBranchName] = useState('');
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printersChecked, setPrintersChecked] = useState(false);
  const [scannerTest, setScannerTest] = useState('');
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [kitchenDisplayEnabled, setKitchenDisplayEnabled] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(!!getDesktopBridge());
  }, []);

  async function scanForPrinters() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setPrinters([{ id: 'browser', type: 'info', label: 'Printer detection needs the desktop app — not available in a browser preview.' }]);
      setPrintersChecked(true);
      return;
    }
    const found = await bridge.listPrinters();
    setPrinters(found);
    setPrintersChecked(true);
  }

  async function finish() {
    const bridge = getDesktopBridge();
    const config = { mode, branchName, paymentEnabled, kitchenDisplayEnabled };
    if (bridge) {
      await bridge.setConfig('mode', mode);
      await bridge.setConfig('branchName', branchName);
      await bridge.setConfig('paymentEnabled', paymentEnabled);
      await bridge.setConfig('kitchenDisplayEnabled', kitchenDisplayEnabled);
      await bridge.setConfig('setupComplete', true);
    } else {
      window.localStorage.setItem('restaurantos_setup', JSON.stringify(config));
    }
    router.push('/pos');
  }

  function next() {
    if (stepIndex < STEPS.length - 1) setStepIndex(stepIndex + 1);
    else finish();
  }
  function back() {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }

  if (step === 'mode') {
    return (
      <WizardShell step={1} totalSteps={STEPS.length} title="How will this location run?" onNext={next}>
        <div className="space-y-3">
          {(
            [
              { value: 'standalone', label: 'Standalone — this location only', hint: 'No cloud account needed. Works fully offline, forever.' },
              { value: 'cloud', label: 'Connected — part of a multi-branch account', hint: 'Syncs sales/menu with a central account when online. Still works fully offline in between.' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setMode(opt.value)}
              className={`w-full rounded-xl border-2 p-4 text-left transition-colors ${
                mode === opt.value ? 'border-brand bg-brand/5' : 'border-neutral-200'
              }`}
            >
              <p className="font-medium text-neutral-900">{opt.label}</p>
              <p className="mt-1 text-sm text-neutral-500">{opt.hint}</p>
            </button>
          ))}
          {mode === 'cloud' && (
            <input
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="Branch name (e.g. Eindhoven - Grote Berg)"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          )}
        </div>
      </WizardShell>
    );
  }

  if (step === 'printers') {
    return (
      <WizardShell step={2} totalSteps={STEPS.length} title="Connect your printers" description="USB, Bluetooth, or WiFi/network receipt and kitchen printers." onBack={back} onNext={next}>
        <button onClick={scanForPrinters} className="mb-3 rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:border-brand hover:text-brand">
          Scan for printers
        </button>
        {printersChecked && (
          <ul className="space-y-2">
            {printers.map((p) => (
              <li key={p.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                {p.label}
              </li>
            ))}
          </ul>
        )}
        {!isDesktop && <p className="mt-3 text-xs text-neutral-400">You can also skip this in a browser preview and set it up later in the desktop app.</p>}
      </WizardShell>
    );
  }

  if (step === 'second-screen') {
    return (
      <WizardShell step={3} totalSteps={STEPS.length} title="Customer-facing display" description="Connect a second monitor and it's used automatically — nothing to configure here." onBack={back} onNext={next}>
        <p className="text-sm text-neutral-600">
          {isDesktop
            ? 'If a second monitor is connected, the desktop app already opened it. If not, plug one in any time — no restart needed.'
            : 'This is set up automatically by the desktop app when a second monitor is connected.'}
        </p>
      </WizardShell>
    );
  }

  if (step === 'scanner') {
    return (
      <WizardShell step={4} totalSteps={STEPS.length} title="Test your barcode scanner" description="Most scanners need no setup — they just type. Click the box below and scan anything to confirm." onBack={back} onNext={next}>
        <input
          autoFocus
          value={scannerTest}
          onChange={(e) => setScannerTest(e.target.value)}
          placeholder="Scan a barcode here…"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        {scannerTest && <p className="mt-2 text-sm text-emerald-600">Received: {scannerTest}</p>}
      </WizardShell>
    );
  }

  if (step === 'payment') {
    return (
      <WizardShell step={5} totalSteps={STEPS.length} title="Card payment terminal" description="Optional — you can take cash-only and set this up later." onBack={back} onNext={next}>
        <label className="mb-3 flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={paymentEnabled} onChange={(e) => setPaymentEnabled(e.target.checked)} />
          Enable card payment terminal support
        </label>
        {paymentEnabled && (
          <p className="text-sm text-neutral-600">
            Connect a provider (Stripe Terminal, Adyen, SumUp, or Mollie) in{' '}
            <Link href="/settings/payments" className="font-medium text-brand hover:underline">
              Settings → Payment terminal
            </Link>{' '}
            — you can do that now or after finishing this wizard.
          </p>
        )}
      </WizardShell>
    );
  }

  if (step === 'kitchen') {
    return (
      <WizardShell step={6} totalSteps={STEPS.length} title="Kitchen display" description="A screen in the kitchen showing incoming orders instead of (or alongside) printed tickets." onBack={back} onNext={next}>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={kitchenDisplayEnabled} onChange={(e) => setKitchenDisplayEnabled(e.target.checked)} />
          Enable a kitchen display screen
        </label>
      </WizardShell>
    );
  }

  return (
    <WizardShell step={7} totalSteps={STEPS.length} title="Review & finish" onBack={back} onNext={next} nextLabel="Finish setup">
      <ul className="space-y-1 text-sm text-neutral-700">
        <li>Mode: <span className="font-medium">{mode === 'standalone' ? 'Standalone' : `Connected — ${branchName || 'unnamed branch'}`}</span></li>
        <li>Printers found: <span className="font-medium">{printers.filter((p) => p.type !== 'info').length}</span></li>
        <li>Card payments: <span className="font-medium">{paymentEnabled ? 'Enabled' : 'Off'}</span></li>
        <li>Kitchen display: <span className="font-medium">{kitchenDisplayEnabled ? 'Enabled' : 'Off'}</span></li>
      </ul>
    </WizardShell>
  );
}
