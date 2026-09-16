'use client';

// Loaded by the desktop shell's second BrowserWindow when a second monitor is connected
// (see RestaurantOS-Desktop/main.js's openCustomerDisplay). Was a static "Welcome to
// Asmara" stub with a comment that a real live-order view needed the POS to broadcast its
// cart state -- that's built now (see lib/customerDisplay.ts): the POS screen publishes
// its cart over a same-origin BroadcastChannel every time it changes, and this page just
// renders whatever it last received. Falls back to the welcome screen whenever there's no
// active order (nothing rung up yet, or the last sale just cleared).
import { useEffect, useState } from 'react';
import { CustomerDisplayPayload, subscribeCustomerDisplay } from '@/lib/customerDisplay';

export default function CustomerDisplayPage() {
  const [order, setOrder] = useState<CustomerDisplayPayload>(null);

  useEffect(() => subscribeCustomerDisplay(setOrder), []);

  if (!order || order.lines.length === 0) {
    return (
      <main className="flex h-screen flex-col items-center justify-center bg-neutral-900 text-white">
        <h1 className="text-4xl font-bold text-brand-light">Welcome to Asmara</h1>
        <p className="mt-3 text-lg text-neutral-400">Your order will appear here.</p>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-neutral-900 p-8 text-white">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-light">Your order</h1>
        {order.tableNumber && (
          <span className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-neutral-300">
            Table #{order.tableNumber}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-white/10">
          {order.lines.map((line, i) => (
            <li key={i} className="flex items-center justify-between py-3">
              <div>
                <p className="text-lg font-medium">{line.name}</p>
                <p className="text-sm text-neutral-400">
                  {typeof line.weight === 'number'
                    ? `${line.weight.toFixed(3)} ${line.weightUnit || 'kg'}`
                    : `× ${line.qty}`}
                </p>
              </div>
              <span className="text-lg font-semibold tabular-nums">€{line.linePrice.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 border-t border-white/10 pt-4 text-lg">
        <div className="flex justify-between text-neutral-400">
          <span>Subtotal</span>
          <span className="tabular-nums">€{order.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-neutral-400">
          <span>VAT</span>
          <span className="tabular-nums">€{order.tax.toFixed(2)}</span>
        </div>
        <div className="mt-2 flex justify-between text-3xl font-bold text-brand-light">
          <span>Total</span>
          <span className="tabular-nums">€{order.total.toFixed(2)}</span>
        </div>
      </div>
    </main>
  );
}
