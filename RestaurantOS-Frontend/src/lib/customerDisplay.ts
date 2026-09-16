'use client';

/**
 * Customer-facing display (task #17 gap: this screen was a static "Welcome to Asmara" stub
 * with a comment saying the live order view was a real follow-up, not guessed at). The
 * desktop shell opens this page in a second BrowserWindow on a second monitor, on the SAME
 * origin as the POS itself -- so the simplest correct transport between the two windows is
 * the browser's own BroadcastChannel, not a round trip through the backend's Socket.IO
 * server (that would need new backend routing, tenant/terminal scoping, and network
 * latency for something that never needs to leave this one machine).
 */

export type CustomerDisplayLine = {
  name: string;
  qty: number;
  weight?: number;
  weightUnit?: string;
  linePrice: number;
};

export type CustomerDisplayPayload = {
  tableNumber: string | null;
  lines: CustomerDisplayLine[];
  subtotal: number;
  tax: number;
  total: number;
} | null; // null = no active order right now -> customer display shows the welcome screen

const CHANNEL_NAME = 'asmara-customer-display';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** Called from the POS screen whenever the current order's cart changes. */
export function publishCustomerDisplay(payload: CustomerDisplayPayload) {
  try {
    getChannel()?.postMessage(payload);
  } catch {
    // BroadcastChannel unsupported in this browser/context -- the customer display simply
    // stays on its welcome screen instead of crashing the POS over a nice-to-have.
  }
}

/** Called from the customer-display screen to receive live updates. Returns an unsubscribe fn. */
export function subscribeCustomerDisplay(onMessage: (payload: CustomerDisplayPayload) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent<CustomerDisplayPayload>) => onMessage(e.data);
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}
