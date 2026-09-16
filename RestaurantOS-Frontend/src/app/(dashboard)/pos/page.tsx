'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMenu } from '@/lib/hooks/useMenu';
import { useCart } from '@/lib/hooks/useCart';
import { useRegisterSession } from '@/lib/hooks/useRegisterSession';
import {
  sendDirectSaleToKitchen,
  sendTableOrderToKitchen,
  chargeOrder,
  cancelOrder,
  finishOrder,
  getOrders,
  SplitCharge,
} from '@/lib/api';
import { ProductGrid } from './components/ProductGrid';
import { Cart } from './components/Cart';
import { PaymentModal } from './components/PaymentModal';
import { OpenRegisterModal } from './components/OpenRegisterModal';
import { WeighItemModal } from './components/WeighItemModal';
import { MenuItem } from '@/lib/types';
import { parsePrice } from '@/lib/tax';
import { publishCustomerDisplay } from '@/lib/customerDisplay';

export default function PosPageWrapper() {
  // useSearchParams needs a Suspense boundary for the static parts of this route to still
  // prerender -- the direct-sale POS (no ?table=) is unaffected either way.
  return (
    <Suspense fallback={<p className="p-8 text-neutral-400">Loading…</p>}>
      <PosPage />
    </Suspense>
  );
}

function PosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const table = searchParams.get('table');
  const orderId = searchParams.get('order');
  const isTableOrder = Boolean(table && orderId);

  const { categories, items, loading, error } = useMenu();
  const cart = useCart();
  const register = useRegisterSession();
  const [showPayment, setShowPayment] = useState(false);
  const [charging, setCharging] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [weighingItem, setWeighingItem] = useState<MenuItem | null>(null);
  const [sendingToKitchen, setSendingToKitchen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preloaded, setPreloaded] = useState(false);

  // Resuming a table: pull in whatever's already on that order (sent to kitchen or not)
  // so re-opening a table shows what was already ordered, instead of an empty cart that
  // would silently wipe out earlier items on the next "Send to kitchen".
  useEffect(() => {
    if (!isTableOrder || loading || items.length === 0 || preloaded) return;
    let cancelled = false;
    getOrders()
      .then((res) => {
        if (cancelled || !table) return;
        const existing = res.tableOrders?.[table];
        cart.loadFromQuantities(existing?.data?.quantity, items);
      })
      .catch(() => {
        /* best-effort preload -- an empty cart is a safe fallback */
      })
      .finally(() => {
        if (!cancelled) setPreloaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTableOrder, loading, items, preloaded, table]);

  // Customer-facing display (second monitor, opened by the desktop shell): mirrors the
  // current order live so a customer can follow along as items are rung up, the same way
  // a real POS terminal's customer-facing screen works. Publishes null (welcome screen)
  // once the cart is empty -- covers "nothing rung up yet" and "just charged and cleared"
  // with the same state, which is the right customer-facing behavior for both.
  useEffect(() => {
    if (cart.lines.length === 0) {
      publishCustomerDisplay(null);
      return;
    }
    publishCustomerDisplay({
      tableNumber: table,
      lines: cart.lines.map((l) => ({
        name: l.item.name,
        qty: l.qty,
        weight: l.weight,
        weightUnit: l.item.weight_unit,
        linePrice: parsePrice(l.item.price) * (l.weight ?? l.qty),
      })),
      subtotal: cart.subtotal,
      tax: cart.tax,
      total: cart.total,
    });
  }, [cart.lines, cart.subtotal, cart.tax, cart.total, table]);

  // Clear the customer display when leaving the POS screen entirely (e.g. back to Tables)
  // so it doesn't keep showing a stale order to whoever's standing at the counter.
  useEffect(() => {
    return () => publishCustomerDisplay(null);
  }, []);

  function buildQuantities() {
    const quantities: Record<number, number> = {};
    const weights: Record<string, { itemName: string; weight: number; unit: string }> = {};
    cart.lines.forEach((l) => {
      quantities[l.item.id] = (quantities[l.item.id] ?? 0) + l.qty;
      if (typeof l.weight === 'number') {
        weights[l.lineKey ?? String(l.item.id)] = {
          itemName: l.item.name,
          weight: l.weight,
          unit: l.item.weight_unit || 'kg',
        };
      }
    });
    return { quantities, weights };
  }

  async function handleSendToKitchen() {
    if (!table || !orderId) return;
    setSendingToKitchen(true);
    setActionError(null);
    try {
      const { quantities } = buildQuantities();
      await sendTableOrderToKitchen(table, orderId, quantities, cart.total);
      setLastResult(`Sent to kitchen for table #${table}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not send to kitchen.');
    } finally {
      setSendingToKitchen(false);
    }
  }

  async function handleCancelTableOrder() {
    if (!table || !orderId) return;
    if (!confirm(`Cancel this order and free table #${table}?`)) return;
    setActionError(null);
    try {
      await cancelOrder(orderId, table);
      router.push('/tables');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not cancel this order.');
    }
  }

  // Direct sale (no table): unchanged from before -- a "direct sale" order is created via
  // /orders/to-kitchen with no order_id, then /orders/create finalizes payment.
  // Table order: the order already exists (created by /orders/init when the table was
  // opened) -- charge it directly, then /orders/finish frees the table.
  // Bill splitting (task #49): PaymentModal now confirms with either a single method or an
  // itemized `charges` array -- everything downstream of that branch (kitchen send, finish,
  // navigation) is completely unchanged from before this task.
  async function handleConfirmPayment(payload: { method: 'cash' | 'card' } | { charges: SplitCharge[] }) {
    const isSplit = 'charges' in payload;
    const method = isSplit ? undefined : payload.method;
    const splitCharges = isSplit ? payload.charges : undefined;
    const summaryLabel = isSplit ? `split ${splitCharges!.length} ways` : method!;

    setCharging(true);
    setChargeError(null);
    try {
      const { quantities, weights } = buildQuantities();

      if (isTableOrder && table && orderId) {
        await sendTableOrderToKitchen(table, orderId, quantities, cart.total);
        await chargeOrder(Number(orderId), cart.total, method ?? 'card', splitCharges);
        await finishOrder(orderId, table);
        setShowPayment(false);
        setLastResult(`Table #${table} charged €${cart.total.toFixed(2)} (${summaryLabel}) and freed.`);
        cart.clear();
        register.refresh();
        router.push('/tables');
        return;
      }

      const { order } = await sendDirectSaleToKitchen(quantities, cart.total, weights);
      await chargeOrder(order.id, cart.total, method ?? 'card', splitCharges);

      setShowPayment(false);
      setLastResult(`Order #${order.id} charged €${cart.total.toFixed(2)} (${summaryLabel}).`);
      cart.clear();
      register.refresh();
    } catch (err) {
      setChargeError(err instanceof Error ? err.message : 'Payment failed. Nothing was charged.');
    } finally {
      setCharging(false);
    }
  }

  if (register.loading) {
    return <p className="p-8 text-neutral-400">Checking register status…</p>;
  }

  return (
    <main className="grid h-screen grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_360px]">
      {!register.isOpen && (
        <OpenRegisterModal onOpen={async (cash) => { await register.open(cash); }} />
      )}

      <section className="flex min-h-0 flex-col">
        {isTableOrder && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2">
            <div>
              <span className="font-semibold text-amber-900">Table #{table}</span>
              <span className="ml-2 text-xs text-amber-700">Order #{orderId}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSendToKitchen}
                disabled={sendingToKitchen || cart.lines.length === 0}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {sendingToKitchen ? 'Sending…' : 'Send to kitchen 🖨️'}
              </button>
              <button
                onClick={handleCancelTableOrder}
                className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
              >
                Cancel order
              </button>
              <button
                onClick={() => router.push('/tables')}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
              >
                ← Tables
              </button>
            </div>
          </div>
        )}
        {actionError && <p className="mb-2 text-sm text-red-600">{actionError}</p>}

        {loading && <p className="p-8 text-neutral-400">Loading menu…</p>}
        {error && <p className="p-8 text-red-600">{error}</p>}
        {!loading && !error && (
          <ProductGrid categories={categories} items={items} onAdd={cart.addItem} onWeigh={setWeighingItem} />
        )}
      </section>

      <aside className="min-h-0">
        <Cart
          lines={cart.lines}
          subtotal={cart.subtotal}
          tax={cart.tax}
          total={cart.total}
          onSetQty={cart.setQty}
          onRemove={cart.removeItem}
          onClear={cart.clear}
          onCharge={() => setShowPayment(true)}
        />
      </aside>

      {showPayment && (
        <PaymentModal
          total={cart.total}
          onClose={() => setShowPayment(false)}
          onConfirm={handleConfirmPayment}
          submitting={charging}
          error={chargeError}
        />
      )}

      {weighingItem && (
        <WeighItemModal
          item={weighingItem}
          onClose={() => setWeighingItem(null)}
          onConfirm={(weight) => {
            cart.addWeighedItem(weighingItem, weight);
            setWeighingItem(null);
          }}
        />
      )}

      {lastResult && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg">
          {lastResult}
        </div>
      )}
    </main>
  );
}
