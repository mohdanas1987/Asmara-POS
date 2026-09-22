'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { login, setToken } from '@/lib/api';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { authToken } = await login(email, password);
      setToken(authToken);
      router.push('/pos');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#0B1220]">
      {/* Left banner panel -- a warm sunset-over-teal gradient (not flat brand teal) with a
          trio of glossy, tilted "glass" cards standing in for dish photography, since a
          pre-login screen can't safely depend on this tenant's own uploaded images. */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 120% at 15% 0%, #F59E0B22 0%, transparent 45%), radial-gradient(120% 120% at 100% 100%, #0F766E 0%, #0B4B46 55%, #071F1D 100%)',
          }}
        />
        {/* animated aurora blobs */}
        <div className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 animate-fadeIn rounded-full bg-amber-400/20 blur-[100px]" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-teal-300/25 blur-[90px]" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-emerald-400/15 blur-[90px]" />
        {/* subtle dot texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        />
        {/* sparkles */}
        <span className="pointer-events-none absolute left-[22%] top-[18%] h-1.5 w-1.5 animate-pulse rounded-full bg-white/80" />
        <span className="pointer-events-none absolute left-[68%] top-[28%] h-1 w-1 animate-pulse rounded-full bg-amber-200/90" style={{ animationDelay: '400ms' }} />
        <span className="pointer-events-none absolute left-[40%] top-[68%] h-1.5 w-1.5 animate-pulse rounded-full bg-white/70" style={{ animationDelay: '800ms' }} />

        <div className="relative z-10 flex animate-fadeIn items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 shadow-glow ring-1 ring-white/25 backdrop-blur-md">
            <Image src="/asmara-logo.png" alt="Asmara" width={28} height={28} className="rounded-md" />
          </div>
          <div>
            <div className="text-lg font-bold leading-tight">Asmara</div>
            <div className="text-xs text-white/70">Restaurant POS</div>
          </div>
        </div>

        {/* Glossy 3D card stack -- glassmorphism (blurred, translucent, ringed) with real
            drop shadows and slight rotation for depth, standing in for a dish-photo banner. */}
        <div className="relative z-10 my-8 flex h-56 items-center justify-center">
          <div className="absolute h-40 w-32 -rotate-12 rounded-2xl border border-white/20 bg-white/10 shadow-2xl backdrop-blur-md" style={{ left: '8%' }}>
            <div className="flex h-full w-full flex-col items-center justify-center gap-1">
              <span className="text-4xl drop-shadow-lg">🍕</span>
              <span className="text-[10px] font-medium text-white/70">Fresh daily</span>
            </div>
            <div className="absolute inset-x-3 top-2 h-8 rounded-full bg-white/20 blur-md" />
          </div>
          <div className="absolute h-48 w-36 rotate-3 rounded-2xl border border-white/25 bg-white/10 shadow-2xl backdrop-blur-md" style={{ zIndex: 2 }}>
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5">
              <span className="text-5xl drop-shadow-lg">🍽️</span>
              <span className="text-xs font-semibold text-white">Chef&apos;s picks</span>
            </div>
            <div className="absolute inset-x-4 top-3 h-10 rounded-full bg-white/25 blur-md" />
          </div>
          <div className="absolute h-40 w-32 rotate-[16deg] rounded-2xl border border-white/20 bg-white/10 shadow-2xl backdrop-blur-md" style={{ right: '6%' }}>
            <div className="flex h-full w-full flex-col items-center justify-center gap-1">
              <span className="text-4xl drop-shadow-lg">🍷</span>
              <span className="text-[10px] font-medium text-white/70">Table service</span>
            </div>
            <div className="absolute inset-x-3 top-2 h-8 rounded-full bg-white/20 blur-md" />
          </div>
        </div>

        <div className="relative z-10 max-w-md animate-fadeInUp" style={{ animationDelay: '80ms', animationFillMode: 'backwards' }}>
          <h1 className="mb-3 bg-gradient-to-r from-white via-amber-100 to-white bg-clip-text text-3xl font-bold leading-tight text-transparent">
            Run your restaurant,<br />beautifully.
          </h1>
          <p className="text-sm leading-relaxed text-white/80">
            Orders, tables, kitchen tickets, and payments — all in one fast,
            reliable point of sale built for busy floors.
          </p>
        </div>

        <div className="relative z-10 flex animate-fadeIn gap-6 text-xs text-white/70" style={{ animationDelay: '200ms', animationFillMode: 'backwards' }}>
          <div>
            <div className="text-lg font-bold text-white">Fast</div>
            Built for touch
          </div>
          <div>
            <div className="text-lg font-bold text-white">Reliable</div>
            Works under pressure
          </div>
          <div>
            <div className="text-lg font-bold text-white">Simple</div>
            No clutter
          </div>
        </div>
      </div>

      {/* Right form panel -- warm colorful backdrop instead of flat gray, glossy card */}
      <div className="relative flex w-full flex-col items-center justify-center overflow-hidden px-6 py-12 lg:w-1/2">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(90% 60% at 50% 0%, rgb(var(--brand-rgb) / 0.10) 0%, transparent 60%), radial-gradient(70% 50% at 100% 100%, #F59E0B14 0%, transparent 60%)',
          }}
        />
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand/10 blur-3xl lg:block hidden" />
        <div className="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl lg:block hidden" />

        <div className="relative z-10 w-full max-w-sm animate-fadeInUp">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
              <Image src="/asmara-logo.png" alt="Asmara" width={24} height={24} className="rounded-md" />
            </div>
            <div>
              <div className="text-base font-bold text-ink">Asmara</div>
              <div className="text-[11px] text-ink-muted">Restaurant POS</div>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="relative w-full overflow-hidden rounded-2xl border border-border bg-surface p-8 shadow-card-hover"
          >
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand via-amber-400 to-brand" />
            <h1 className="mb-1 text-2xl font-bold text-ink">Welcome back</h1>
            <p className="mb-6 text-sm text-ink-muted">Sign in to open the floor.</p>

            <label className="mb-1 block text-sm font-medium text-ink">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="touch-target mb-4 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink transition-shadow focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
            />

            <label className="mb-1 block text-sm font-medium text-ink">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="touch-target mb-6 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink transition-shadow focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
            />

            {error && (
              <p className="mb-4 animate-fadeIn rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
                {error}
              </p>
            )}

            <Button type="submit" disabled={loading} className="w-full shadow-glow">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>

            <p className="mt-5 text-center text-sm text-ink-muted">
              New restaurant?{' '}
              <Link href="/signup" className="font-medium text-brand hover:underline">
                Set up your account
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
