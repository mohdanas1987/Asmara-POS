'use client';

/**
 * Staff quick-login: PIN + QR badge (CTO forensic audit 2026-09-20, task "QR staff login" --
 * flagged as never built, correctly). Lets whoever's using a shared terminal swap to a
 * different staff member's session without a full sign-out, either by PIN (NumericKeypad,
 * same component already used for cash amounts) or by scanning a printed QR badge -- a
 * barcode/QR scanner behaves like a keyboard typing fast + Enter, so the "scan" input is
 * just a normal text field that submits on Enter, exactly like the existing product-barcode
 * search on the POS screen.
 */
import { useState } from 'react';
import { NumericKeypad } from '@/components/ui/NumericKeypad';
import { Button } from '@/components/ui/Button';
import { pinLogin, qrLogin, setToken } from '@/lib/api';

export function SwitchUserModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'pin' | 'qr'>('pin');
  const [pin, setPin] = useState('');
  const [qrValue, setQrValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function afterSwitch(authToken: string) {
    setToken(authToken);
    onClose();
    // A full reload (not just a client-side nav) so every already-mounted component picks
    // up the new role from the new JWT -- Sidebar/TopBar/etc. read it once on mount via
    // lib/auth.ts, not reactively.
    window.location.reload();
  }

  async function handlePinSubmit() {
    if (pin.length < 4) {
      setError('Enter at least 4 digits.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await pinLogin(pin);
      if (!res.status) throw new Error(res.message || 'Incorrect PIN.');
      await afterSwitch(res.authToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect PIN.');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  async function handleQrSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!qrValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await qrLogin(qrValue.trim());
      if (!res.status) throw new Error(res.message || 'Unrecognized badge.');
      await afterSwitch(res.authToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unrecognized badge.');
      setQrValue('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">Switch user</h2>
          <button onClick={onClose} className="text-sm text-neutral-400 hover:text-neutral-600">
            ✕
          </button>
        </div>

        <div className="mb-3 flex gap-1 rounded-lg bg-neutral-100 p-1 text-sm">
          <button
            onClick={() => setMode('pin')}
            className={`flex-1 rounded-md py-1.5 font-medium ${mode === 'pin' ? 'bg-white shadow-sm' : 'text-neutral-500'}`}
          >
            PIN
          </button>
          <button
            onClick={() => setMode('qr')}
            className={`flex-1 rounded-md py-1.5 font-medium ${mode === 'qr' ? 'bg-white shadow-sm' : 'text-neutral-500'}`}
          >
            Scan badge
          </button>
        </div>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        {mode === 'pin' ? (
          <>
            <div className="mb-3 rounded-lg border border-neutral-300 px-3 py-2 text-center text-2xl tracking-[0.5em] text-neutral-900">
              {pin.padEnd(6, '·')}
            </div>
            <NumericKeypad value={pin} onChange={setPin} allowDecimal={false} maxLength={6} />
            <Button type="button" className="mt-3 w-full" disabled={busy} onClick={handlePinSubmit}>
              {busy ? 'Checking…' : 'Switch'}
            </Button>
          </>
        ) : (
          <form onSubmit={handleQrSubmit}>
            <input
              autoFocus
              value={qrValue}
              onChange={(e) => setQrValue(e.target.value)}
              placeholder="Scan a staff badge…"
              className="mb-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Checking…' : 'Switch'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
