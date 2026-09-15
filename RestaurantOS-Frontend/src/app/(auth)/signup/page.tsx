'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signupTenant, setToken, getPublicPlans } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Plan } from '@/lib/types';

/**
 * Real tenant onboarding, wired to routes/auth.js's new POST /auth/signup-tenant. Creates a
 * brand-new restaurant + its first admin user in one transaction and logs them straight in,
 * landing on /setup to configure hardware, printers, and payment before their first order.
 *
 * Plan selection: fetches the live, platform-admin-managed plan list (GET /billing/plans --
 * public, unauthenticated) so a prospective restaurant can pick a plan right on this form.
 * Nothing here is hardcoded -- add/remove/reprice a plan from the Super Admin panel and it
 * shows up here immediately. If they don't pick one, the backend falls back to whichever
 * plan the platform admin flagged as the default; if none exists yet, the form still works
 * with no plan step shown at all.
 */
function formatPrice(plan: Plan) {
  if (plan.price_cents === 0) return 'Free';
  const amount = (plan.price_cents / 100).toLocaleString('en-IE', { style: 'currency', currency: plan.currency || 'EUR' });
  const interval = plan.billing_interval === 'yearly' ? '/yr' : plan.billing_interval === 'monthly' ? '/mo' : '';
  return `${amount}${interval}`;
}

function parseFeatures(plan: Plan): string[] {
  if (!plan.features) return [];
  try {
    const parsed = JSON.parse(plan.features);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function SignupPage() {
  const router = useRouter();
  const [restaurantName, setRestaurantName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

  useEffect(() => {
    getPublicPlans()
      .then((res) => {
        setPlans(res.plans || []);
        const def = (res.plans || []).find((p) => Boolean(p.is_default));
        setSelectedPlanId(def ? def.id : res.plans?.[0]?.id ?? null);
      })
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await signupTenant({
        restaurant_name: restaurantName,
        name,
        email,
        password,
        ...(selectedPlanId ? { plan_id: selectedPlanId } : {}),
      });
      if (!res.status || !res.authToken) {
        setError(res.message || 'Could not create your restaurant.');
        return;
      }
      setToken(res.authToken);
      router.push('/setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your restaurant.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 py-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <h1 className="mb-1 text-2xl font-semibold text-brand">Set up your restaurant</h1>
        <p className="mb-6 text-sm text-neutral-500">Takes a minute. No card required.</p>

        <label className="mb-1 block text-sm font-medium text-neutral-700">Restaurant name</label>
        <input
          required
          value={restaurantName}
          onChange={(e) => setRestaurantName(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />

        <label className="mb-1 block text-sm font-medium text-neutral-700">Your name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />

        <label className="mb-1 block text-sm font-medium text-neutral-700">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />

        <label className="mb-1 block text-sm font-medium text-neutral-700">Password</label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-6 w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />

        {!plansLoading && plans.length > 0 && (
          <div className="mb-6">
            <p className="mb-2 text-sm font-medium text-neutral-700">Choose a plan</p>
            <div className="grid gap-2">
              {plans.map((plan) => {
                const features = parseFeatures(plan);
                const selected = selectedPlanId === plan.id;
                return (
                  <label
                    key={plan.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      selected ? 'border-brand bg-brand/5' : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="plan"
                      className="mt-1"
                      checked={selected}
                      onChange={() => setSelectedPlanId(plan.id)}
                    />
                    <span className="flex-1">
                      <span className="flex items-center justify-between font-medium text-neutral-800">
                        <span>{plan.name}</span>
                        <span className="text-neutral-500">{formatPrice(plan)}</span>
                      </span>
                      {plan.description && <span className="mt-0.5 block text-xs text-neutral-500">{plan.description}</span>}
                      {features.length > 0 && (
                        <span className="mt-1 block text-xs text-neutral-400">{features.join(' · ')}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Creating your restaurant…' : 'Create restaurant'}
        </Button>

        <p className="mt-4 text-center text-sm text-neutral-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
