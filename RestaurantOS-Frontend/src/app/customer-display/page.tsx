'use client';

// Loaded by the desktop shell's second BrowserWindow when a second monitor is connected
// (see RestaurantOS-Desktop/main.js's openCustomerDisplay). Deliberately minimal for now --
// a real "what's in the current order" view needs the POS screen to broadcast its cart state
// (e.g. via the same Socket.IO layer already built for online orders), which is a follow-up,
// not guessed at here.
export default function CustomerDisplayPage() {
  return (
    <main className="flex h-screen flex-col items-center justify-center bg-neutral-900 text-white">
      <h1 className="text-3xl font-semibold text-brand-light">Welcome to Asmara</h1>
      <p className="mt-2 text-neutral-400">Your order will appear here.</p>
    </main>
  );
}
