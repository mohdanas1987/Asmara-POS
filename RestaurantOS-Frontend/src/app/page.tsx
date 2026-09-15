import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-semibold text-brand">RestaurantOS</h1>
      <p className="text-neutral-600">The fast, modern restaurant POS.</p>
      <Link
        href="/login"
        className="rounded-lg bg-brand px-5 py-2.5 text-white hover:bg-brand-dark transition-colors"
      >
        Sign in
      </Link>
    </main>
  );
}
