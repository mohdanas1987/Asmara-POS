'use client';

/**
 * Staff management UI (CTO forensic audit 2026-09-20): the backend has had full staff CRUD
 * since RBAC was built (routes/users.js's GET/POST/PATCH /users) but nothing in the frontend
 * ever called it -- a manager had no way to create a staff account, change a role, or set up
 * quick-login (PIN / QR badge) without going straight to the database. This closes that gap.
 */
import { useEffect, useState } from 'react';
import { listStaff, createStaff, updateStaff, setStaffPin, issueQrBadge, revokeQrBadge } from '@/lib/api';
import { StaffMember } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { NumericKeypad } from '@/components/ui/NumericKeypad';
import { QRCodeSVG } from 'qrcode.react';

const ROLES = ['admin', 'manager', 'cashier', 'waiter', 'kitchen'];

export default function StaffSettingsPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('waiter');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [pinTarget, setPinTarget] = useState<StaffMember | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const [issuedBadge, setIssuedBadge] = useState<{ staff: StaffMember; token: string } | null>(null);

  function load() {
    setLoading(true);
    listStaff()
      .then((res) => {
        if (!res.status) throw new Error('Could not load staff.');
        setStaff(res.staff);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load staff.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || password.length < 6) {
      setFormError('Name, email, and a password of at least 6 characters are required.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await createStaff({ name: name.trim(), email: email.trim(), password, role });
      if (!res.status) throw new Error(res.message || 'Could not create staff account.');
      setName('');
      setEmail('');
      setPassword('');
      setRole('waiter');
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create staff account.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(member: StaffMember, newRole: string) {
    setBusy(true);
    setError(null);
    try {
      await updateStaff(member.id, { role: newRole });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update role.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleStatus(member: StaffMember) {
    setBusy(true);
    setError(null);
    try {
      await updateStaff(member.id, { status: !member.status });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPin() {
    if (!pinTarget || pinValue.length < 4) {
      setPinError('Enter at least 4 digits.');
      return;
    }
    try {
      await setStaffPin(pinTarget.id, pinValue);
      setPinTarget(null);
      setPinValue('');
      setPinError(null);
      load();
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Could not set PIN.');
    }
  }

  async function handleIssueBadge(member: StaffMember) {
    setBusy(true);
    setError(null);
    try {
      const res = await issueQrBadge(member.id);
      if (!res.status) throw new Error('Could not issue badge.');
      setIssuedBadge({ staff: member, token: res.qr_token });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not issue badge.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeBadge(member: StaffMember) {
    if (!confirm(`Revoke ${member.name}'s QR badge? Their printed badge will stop working immediately.`)) return;
    setBusy(true);
    setError(null);
    try {
      await revokeQrBadge(member.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke badge.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-neutral-900">🧑‍🍳 Staff</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Create staff accounts, set roles, and set up quick-login (PIN or a printable QR badge) so staff can switch
        who's active on a shared terminal without a full sign-out.
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <form onSubmit={handleCreate} className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-36 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1 w-48 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="mt-1 w-32 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col text-xs font-medium text-neutral-500">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm capitalize">
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={busy} className="font-semibold">
          {busy ? 'Adding…' : '+ Add staff'}
        </Button>
      </form>
      {formError && <p className="mb-3 -mt-3 text-sm text-red-600">{formError}</p>}

      {loading && <p className="text-neutral-400">Loading…</p>}

      {!loading && (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Quick-login</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.id} className="border-t border-neutral-100 align-top">
                  <td className="px-4 py-2 font-medium text-neutral-900">{member.name}</td>
                  <td className="px-4 py-2 text-neutral-600">{member.email}</td>
                  <td className="px-4 py-2">
                    <select
                      value={member.role}
                      onChange={(e) => handleRoleChange(member, e.target.value)}
                      disabled={busy}
                      className="rounded-lg border border-neutral-300 px-2 py-1 text-sm capitalize"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleToggleStatus(member)}
                      disabled={busy}
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        member.status ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                      }`}
                    >
                      {member.status ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-xs text-neutral-500">
                    <div>PIN: {member.has_pin ? '✅ set' : '— not set'}</div>
                    <div>Badge: {member.has_qr_badge ? '✅ issued' : '— not issued'}</div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setPinTarget(member)} className="mr-3 text-sm font-medium text-brand hover:underline">
                      Set PIN
                    </button>
                    <button onClick={() => handleIssueBadge(member)} className="mr-3 text-sm font-medium text-brand hover:underline">
                      {member.has_qr_badge ? 'Reissue badge' : 'Issue badge'}
                    </button>
                    {member.has_qr_badge && (
                      <button onClick={() => handleRevokeBadge(member)} className="text-sm text-neutral-400 hover:text-red-600">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-neutral-400">
                    No staff accounts yet -- add one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pinTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl">
            <h2 className="mb-3 text-lg font-semibold text-neutral-900">Set PIN for {pinTarget.name}</h2>
            <div className="mb-3 rounded-lg border border-neutral-300 px-3 py-2 text-center text-2xl tracking-[0.5em] text-neutral-900">
              {pinValue.padEnd(6, '·')}
            </div>
            {pinError && <p className="mb-2 text-sm text-red-600">{pinError}</p>}
            <NumericKeypad value={pinValue} onChange={setPinValue} allowDecimal={false} maxLength={6} />
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => { setPinTarget(null); setPinValue(''); setPinError(null); }}>
                Cancel
              </Button>
              <Button type="button" className="flex-1" onClick={handleSetPin}>
                Save PIN
              </Button>
            </div>
          </div>
        </div>
      )}

      {issuedBadge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-xl bg-white p-5 text-center shadow-xl">
            <h2 className="mb-1 text-lg font-semibold text-neutral-900">{issuedBadge.staff.name}'s badge</h2>
            <p className="mb-3 text-xs text-neutral-500">Print this and hand it to them -- scanning it at the POS logs them straight in.</p>
            <div className="mx-auto mb-3 flex w-fit items-center justify-center rounded-lg border border-neutral-200 p-3">
              <QRCodeSVG value={issuedBadge.token} size={180} level="M" marginSize={2} />
            </div>
            <Button type="button" className="w-full" onClick={() => setIssuedBadge(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
