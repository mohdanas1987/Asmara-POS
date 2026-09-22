'use client';

// Loaded by the desktop shell's second BrowserWindow when a second monitor is connected
// (see RestaurantOS-Desktop/main.js's openCustomerDisplay). The POS screen publishes its
// cart state over a same-origin BroadcastChannel every time it changes (lib/customerDisplay.ts)
// and this page renders whatever it last received.
//
// Beautification pass (2026-09-22): added the media slideshow configured in Settings ->
// Branding & display (routes/config.js's /customer-display/media). While idle (no active
// order) the slideshow runs full-screen; once a sale starts, it shrinks to the left half
// with the live bill on the right -- so the screen is never just blank/idle-looking during
// a transaction, and always shows something branded/attractive when it isn't.
import { useEffect, useMemo, useState } from 'react';
import { CustomerDisplayMediaItem, getCustomerDisplayMedia, getBranding } from '@/lib/api';
import { CustomerDisplayPayload, subscribeCustomerDisplay } from '@/lib/customerDisplay';

const SLIDE_MS = 7000; // per-photo dwell time when autoplaying through more than one image

function MediaSlide({ item, active }: { item: CustomerDisplayMediaItem; active: boolean }) {
  if (item.type === 'video') {
    return (
      <video
        key={item.id}
        src={`/images/${item.file}`}
        className="h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={item.id}
      src={`/images/${item.file}`}
      alt=""
      className="h-full w-full object-cover"
      style={{ opacity: active ? 1 : 0, transition: 'opacity 0.6s ease-in-out' }}
    />
  );
}

function Slideshow({ media, className }: { media: CustomerDisplayMediaItem[]; className?: string }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (media.length <= 1) return;
    const current = media[index];
    // Videos advance on their own timeline (loop=true keeps them playing); photos advance
    // on a fixed timer so a mixed playlist keeps moving either way.
    if (current?.type === 'video') return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % media.length), SLIDE_MS);
    return () => clearTimeout(t);
  }, [index, media]);

  if (media.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center bg-brand-gradient text-white ${className || ''}`}>
        <span className="mb-4 text-6xl">🍽️</span>
        <h1 className="text-4xl font-bold">Welcome to Asmara</h1>
        <p className="mt-2 text-lg text-white/70">Your order will appear here.</p>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-black ${className || ''}`}>
      {media.map((m, i) => (
        <div key={m.id} className="absolute inset-0" style={{ display: i === index ? 'block' : m.type === 'video' ? 'none' : 'block' }}>
          <MediaSlide item={m} active={i === index} />
        </div>
      ))}
      {media.length > 1 && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
          {media.map((m, i) => (
            <span
              key={m.id}
              className="h-1.5 rounded-full transition-all"
              style={{ width: i === index ? '24px' : '8px', background: i === index ? '#14B8A6' : 'rgba(255,255,255,0.4)' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CustomerDisplayPage() {
  const [order, setOrder] = useState<CustomerDisplayPayload>(null);
  const [media, setMedia] = useState<CustomerDisplayMediaItem[]>([]);
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => subscribeCustomerDisplay(setOrder), []);
  useEffect(() => {
    getCustomerDisplayMedia().then((r) => setMedia(r.media || [])).catch(() => {});
    getBranding().then((r) => setLogo(r.logo)).catch(() => {});
  }, []);

  const hasOrder = useMemo(() => Boolean(order && order.lines.length > 0), [order]);

  if (!hasOrder) {
    // Idle: full-screen slideshow (or the branded welcome gradient if no media configured).
    return (
      <main className="relative h-screen w-screen">
        <Slideshow media={media} className="h-full w-full" />
        <div className="pointer-events-none absolute left-6 top-6 flex items-center gap-2.5 rounded-xl bg-black/40 px-3 py-2 backdrop-blur-sm">
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-brand-gradient">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/images/${logo}`} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="text-base">🍽️</span>
            )}
          </div>
          <span className="text-sm font-semibold text-white">Asmara</span>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen w-screen bg-neutral-950 text-white">
      {/* Left half: media, kept playing through checkout instead of going blank */}
      <Slideshow media={media} className="h-full w-1/2" />

      {/* Right half: live bill */}
      <div className="flex h-full w-1/2 flex-col bg-brand-gradient p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Your order</h1>
          {order!.tableNumber && (
            <span className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium text-white/90 backdrop-blur-sm">
              Table #{order!.tableNumber}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto rounded-2xl bg-black/20 p-4 backdrop-blur-sm">
          <ul className="divide-y divide-white/10">
            {order!.lines.map((line, i) => (
              <li key={i} className="flex items-center justify-between py-3 animate-fadeInUp" style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'backwards' }}>
                <div>
                  <p className="text-lg font-medium">{line.name}</p>
                  <p className="text-sm text-white/60">
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

        <div className="mt-6 border-t border-white/15 pt-4 text-lg">
          <div className="flex justify-between text-white/70">
            <span>Subtotal</span>
            <span className="tabular-nums">€{order!.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-white/70">
            <span>VAT</span>
            <span className="tabular-nums">€{order!.tax.toFixed(2)}</span>
          </div>
          <div className="mt-2 flex justify-between text-3xl font-bold text-white">
            <span>Total</span>
            <span className="tabular-nums">€{order!.total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
