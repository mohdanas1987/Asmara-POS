'use client';

import { useEffect, useState } from 'react';
import { Customer } from '@/lib/types';
import { getCustomers, createCustomer } from '@/lib/api';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/Button';
import { CustomerLoyaltyDialog } from '@/components/customers/CustomerLoyaltyDialog';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loyaltyCustomerId, setLoyaltyCustomerId] = useState<number | null>(null);

  useEffect(() => {
    getCustomers()
      .then(setCustomers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load customers'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !phone.trim()) {
      setFormError('First name and phone are required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await createCustomer({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
      });
      if (!res.status) throw new Error(res.message || 'Could not add customer.');
      setCustomers(res.customers);
      setShowForm(false);
      setFirstName('');
      setLastName('');
      setPhone('');
      setEmail('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add customer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex h-screen flex-col">
      <TopBar title="👥 Customers" />
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">Everyone who has ordered, and their loyalty balance.</p>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : '+ New customer'}</Button>
      </div>

      {loading && <p className="text-ink-muted">Loading customers…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="max-w-lg rounded-xl border border-border bg-surface p-4">
          {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
            <input
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
            <input
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
            <input
              placeholder="Email (optional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" className="mt-3" disabled={saving}>
            {saving ? 'Saving…' : 'Add customer'}
          </Button>
        </form>
      )}

      {!loading && !error && (
        <div className="overflow-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Loyalty code</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-neutral-100">
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2 text-ink-muted">{c.phone}</td>
                  <td className="px-4 py-2 text-ink-muted">{c.email || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted">{c.customer_code || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setLoyaltyCustomerId(c.id)}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-brand/10"
                    >
                      Loyalty card
                    </button>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-ink-muted">
                    No customers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <CustomerLoyaltyDialog customerId={loyaltyCustomerId} onClose={() => setLoyaltyCustomerId(null)} />
      </div>
    </main>
  );
}
