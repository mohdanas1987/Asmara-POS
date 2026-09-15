'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getAdminPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getAdminPaymentProviders,
  createPaymentProvider,
  updatePaymentProvider,
  deletePaymentProvider,
} from '@/lib/api';
import { Plan, BillingPaymentProvider } from '@/lib/types';

/**
 * Dynamic billing management -- built per explicit instruction: the platform admin adds,
 * edits, prices, and deactivates as many plans and payment partners as they want here.
 * Nothing is hardcoded on this screen or the routes behind it (routes/billing-admin.js);
 * this is deliberately sandbox/mock-mode only -- no route here processes a real charge, and
 * `mode` on a payment partner defaults to 'sandbox' until a real go-live decision is made.
 */

function emptyPlanForm() {
  return { name: '', slug: '', description: '', price_cents: 0, currency: 'EUR', billing_interval: 'monthly', features: '', is_default: false };
}

function emptyProviderForm() {
  return { name: '', provider_key: '', mode: 'sandbox' as 'sandbox' | 'live' };
}

export default function BillingAdminPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [providers, setProviders] = useState<BillingPaymentProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [planForm, setPlanForm] = useState(emptyPlanForm());
  const [editingPlanId, setEditingPlanId] = useState<number | null>(null);
  const [providerForm, setProviderForm] = useState(emptyProviderForm());
  const [editingProviderId, setEditingProviderId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([getAdminPlans(), getAdminPaymentProviders()])
      .then(([planRes, providerRes]) => {
        setPlans(planRes.plans || []);
        setProviders(providerRes.payment_providers || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load billing config'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startEditPlan(plan: Plan) {
    setEditingPlanId(plan.id);
    setPlanForm({
      name: plan.name,
      slug: plan.slug,
      description: plan.description || '',
      price_cents: plan.price_cents,
      currency: plan.currency,
      billing_interval: plan.billing_interval,
      features: (() => {
        try {
          const parsed = plan.features ? JSON.parse(plan.features) : [];
          return Array.isArray(parsed) ? parsed.join(', ') : '';
        } catch {
          return '';
        }
      })(),
      is_default: Boolean(plan.is_default),
    });
  }

  async function submitPlan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const features = planForm.features
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
      const payload = {
        name: planForm.name,
        slug: planForm.slug,
        description: planForm.description || null,
        price_cents: Number(planForm.price_cents) || 0,
        currency: planForm.currency,
        billing_interval: planForm.billing_interval,
        features,
        is_default: planForm.is_default,
      };
      if (editingPlanId) {
        await updatePlan(editingPlanId, payload);
      } else {
        await createPlan(payload);
      }
      setPlanForm(emptyPlanForm());
      setEditingPlanId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save plan');
    } finally {
      setBusy(false);
    }
  }

  async function togglePlanActive(plan: Plan) {
    setBusy(true);
    try {
      await updatePlan(plan.id, { is_active: !Boolean(plan.is_active) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update plan');
    } finally {
      setBusy(false);
    }
  }

  async function removePlan(plan: Plan) {
    setBusy(true);
    try {
      await deletePlan(plan.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete plan');
    } finally {
      setBusy(false);
    }
  }

  function startEditProvider(p: BillingPaymentProvider) {
    setEditingProviderId(p.id);
    setProviderForm({ name: p.name, provider_key: p.provider_key, mode: p.mode });
  }

  async function submitProvider(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (editingProviderId) {
        await updatePaymentProvider(editingProviderId, providerForm);
      } else {
        await createPaymentProvider(providerForm);
      }
      setProviderForm(emptyProviderForm());
      setEditingProviderId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save payment partner');
    } finally {
      setBusy(false);
    }
  }

  async function toggleProviderActive(p: BillingPaymentProvider) {
    setBusy(true);
    try {
      await updatePaymentProvider(p.id, { is_active: !Boolean(p.is_active) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update payment partner');
    } finally {
      setBusy(false);
    }
  }

  async function removeProvider(p: BillingPaymentProvider) {
    setBusy(true);
    try {
      await deletePaymentProvider(p.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete payment partner');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-neutral-900">Billing</h1>
          <p className="text-sm text-neutral-500">
            Plans and payment partners are fully dynamic — add, price, and retire as many as you want. Sandbox/mock mode: no route here processes a real charge yet.
          </p>
        </div>
        <Link href="/admin" className="text-sm text-brand hover:underline">
          ← Back to tenants
        </Link>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="text-neutral-400">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Plans */}
          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <h2 className="mb-3 text-lg font-medium text-neutral-800">Plans</h2>

            <form onSubmit={submitPlan} className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-neutral-50 p-3 text-sm">
              <input placeholder="Name" required value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} className="col-span-1 rounded border border-neutral-300 px-2 py-1" />
              <input placeholder="Slug" required value={planForm.slug} onChange={(e) => setPlanForm({ ...planForm, slug: e.target.value })} className="col-span-1 rounded border border-neutral-300 px-2 py-1" />
              <input placeholder="Description" value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} className="col-span-2 rounded border border-neutral-300 px-2 py-1" />
              <input type="number" placeholder="Price (cents)" value={planForm.price_cents} onChange={(e) => setPlanForm({ ...planForm, price_cents: Number(e.target.value) })} className="rounded border border-neutral-300 px-2 py-1" />
              <select value={planForm.currency} onChange={(e) => setPlanForm({ ...planForm, currency: e.target.value })} className="rounded border border-neutral-300 px-2 py-1">
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
              </select>
              <select value={planForm.billing_interval} onChange={(e) => setPlanForm({ ...planForm, billing_interval: e.target.value })} className="rounded border border-neutral-300 px-2 py-1">
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="custom">Custom</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                <input type="checkbox" checked={planForm.is_default} onChange={(e) => setPlanForm({ ...planForm, is_default: e.target.checked })} />
                Default at signup
              </label>
              <input placeholder="Features, comma separated" value={planForm.features} onChange={(e) => setPlanForm({ ...planForm, features: e.target.value })} className="col-span-2 rounded border border-neutral-300 px-2 py-1" />
              <div className="col-span-2 flex gap-2">
                <button type="submit" disabled={busy} className="rounded bg-brand px-3 py-1.5 text-white disabled:opacity-50">
                  {editingPlanId ? 'Save changes' : 'Add plan'}
                </button>
                {editingPlanId && (
                  <button type="button" onClick={() => { setEditingPlanId(null); setPlanForm(emptyPlanForm()); }} className="rounded border border-neutral-300 px-3 py-1.5">
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <div className="divide-y divide-neutral-100">
              {plans.map((plan) => (
                <div key={plan.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-medium text-neutral-800">{plan.name}</span>{' '}
                    <span className="text-neutral-400">({plan.slug})</span>{' '}
                    <span className="text-neutral-500">— {(plan.price_cents / 100).toFixed(2)} {plan.currency}/{plan.billing_interval === 'monthly' ? 'mo' : plan.billing_interval === 'yearly' ? 'yr' : plan.billing_interval}</span>
                    {Boolean(plan.is_default) && <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">Default</span>}
                    {!Boolean(plan.is_active) && <span className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">Inactive</span>}
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => startEditPlan(plan)} className="text-brand hover:underline">Edit</button>
                    <button onClick={() => togglePlanActive(plan)} className="text-neutral-500 hover:underline">
                      {Boolean(plan.is_active) ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => removePlan(plan)} className="text-red-500 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
              {plans.length === 0 && <p className="py-4 text-center text-neutral-400">No plans yet — add one above.</p>}
            </div>
          </section>

          {/* Payment partners */}
          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <h2 className="mb-3 text-lg font-medium text-neutral-800">Payment partners</h2>
            <p className="mb-3 text-xs text-neutral-400">
              Platform billing partners (who charges restaurants for RestaurantOS itself) — separate from the in-restaurant payment terminals already configured per tenant.
            </p>

            <form onSubmit={submitProvider} className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-neutral-50 p-3 text-sm">
              <input placeholder="Name (e.g. Mollie)" required value={providerForm.name} onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })} className="rounded border border-neutral-300 px-2 py-1" />
              <input placeholder="Key (e.g. mollie)" required value={providerForm.provider_key} onChange={(e) => setProviderForm({ ...providerForm, provider_key: e.target.value })} className="rounded border border-neutral-300 px-2 py-1" />
              <select value={providerForm.mode} onChange={(e) => setProviderForm({ ...providerForm, mode: e.target.value as 'sandbox' | 'live' })} className="col-span-2 rounded border border-neutral-300 px-2 py-1">
                <option value="sandbox">Sandbox</option>
                <option value="live">Live</option>
              </select>
              <div className="col-span-2 flex gap-2">
                <button type="submit" disabled={busy} className="rounded bg-brand px-3 py-1.5 text-white disabled:opacity-50">
                  {editingProviderId ? 'Save changes' : 'Add partner'}
                </button>
                {editingProviderId && (
                  <button type="button" onClick={() => { setEditingProviderId(null); setProviderForm(emptyProviderForm()); }} className="rounded border border-neutral-300 px-3 py-1.5">
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <div className="divide-y divide-neutral-100">
              {providers.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-medium text-neutral-800">{p.name}</span>{' '}
                    <span className="text-neutral-400">({p.provider_key})</span>{' '}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${p.mode === 'live' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {p.mode}
                    </span>
                    {!Boolean(p.is_active) && <span className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">Inactive</span>}
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => startEditProvider(p)} className="text-brand hover:underline">Edit</button>
                    <button onClick={() => toggleProviderActive(p)} className="text-neutral-500 hover:underline">
                      {Boolean(p.is_active) ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => removeProvider(p)} className="text-red-500 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
              {providers.length === 0 && <p className="py-4 text-center text-neutral-400">No payment partners yet — add one above.</p>}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
