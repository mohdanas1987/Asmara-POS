'use client';

import { useMemo, useState } from 'react';
import { MenuCategory, MenuItem } from '@/lib/types';
import { parsePrice } from '@/lib/tax';
import clsx from 'clsx';

/**
 * Visual pass (owner feedback: dish photos were "getting cut and displaying half only", and
 * the whole POS "looking very basic school project" next to the current production app).
 *
 * 1. Fixed pixel height, not `aspect-[4/3]` -- inside a CSS Grid cell, Chromium/WebKit fail
 *    to size an `aspect-ratio` box during the grid's row track-sizing pass (it measures the
 *    ratio-derived height as 0 before the column width is settled), which collapsed every
 *    product card down to ~13px tall with everything invisible. A definite height sidesteps
 *    that entirely.
 * 2. Uploaded dish photos come in wildly different aspect ratios (portrait phone shots,
 *    wide landscape crops, near-square). A single `object-contain` image inside a fixed
 *    box makes every photo look a DIFFERENT size -- a tall photo shrinks to fit the width
 *    and leaves huge gray bars, a wide photo fills the box -- which is exactly the "some
 *    are bigger, some are small, looks weird" problem in the All tab. Plain `object-cover`
 *    fixes the sizing but silently crops the dish out of frame for anything far from the
 *    box's own ratio (the original "getting cut and displaying half only" complaint).
 *    Fix: a two-layer thumbnail, the same technique Spotify/YouTube use for mismatched
 *    cover art -- a blurred, scaled-up `object-cover` copy of the photo fills the ENTIRE
 *    tile edge-to-edge (so every tile is visually the same size, no gray bars, ever), and
 *    the real photo sits on top with `object-contain`, centered, fully visible, never
 *    cropped. Every tile reads as the same size at a glance; every dish photo is intact.
 */
function ItemThumb({ item }: { item: MenuItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative h-36 w-full overflow-hidden rounded-t-xl bg-surface-sunken">
      {item.image && !broken ? (
        <>
          {/* Blurred backdrop -- always fills the tile edge-to-edge regardless of the
              source photo's own aspect ratio, so every tile is the same visual size. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/images/${item.image}`}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-110 object-cover object-center blur-md brightness-90"
          />
          <div className="absolute inset-0 bg-black/10" aria-hidden="true" />
          {/* Foreground -- the actual photo, always shown whole and centered, never cropped. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/images/${item.image}`}
            alt={item.name}
            onError={() => setBroken(true)}
            className="relative h-full w-full object-contain object-center drop-shadow-md transition-transform duration-200 group-hover:scale-[1.04]"
          />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-4xl">🍽️</div>
      )}

      {item.catName && (
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
          {item.catName}
        </span>
      )}

      {/* Dish number, matching the printed hardcopy menu -- only shows once items have a
          `code` set (Menu screen's "Barcode / #" field); harmless no-op until then. */}
      {item.code && (
        <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-white/90 px-1.5 text-[11px] font-bold text-neutral-700 shadow-sm">
          #{item.code}
        </span>
      )}

      {Boolean(item.sold_by_weight) && (
        <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-neutral-600 shadow-sm">
          ⚖ / {item.weight_unit || 'kg'}
        </span>
      )}
    </div>
  );
}

export function ProductGrid({
  categories,
  items,
  onAdd,
  onWeigh,
}: {
  categories: MenuCategory[];
  items: MenuItem[];
  onAdd: (item: MenuItem) => void;
  onWeigh: (item: MenuItem) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<number | 'all'>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    return items.filter((it) => {
      const matchesCategory = activeCategory === 'all' || it.category_id === activeCategory;
      const matchesQuery = it.name.toLowerCase().includes(query.toLowerCase());
      return matchesCategory && matchesQuery;
    });
  }, [items, activeCategory, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <input
          autoFocus
          placeholder="Search items… (or scan a barcode)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-[15px] text-ink shadow-card transition-shadow focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory('all')}
          className={clsx(
            'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
            activeCategory === 'all' ? 'bg-brand-gradient text-white shadow-glow' : 'bg-surface-sunken text-ink-muted hover:bg-border/60'
          )}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategory(c.id)}
            className={clsx(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              activeCategory === c.id ? 'bg-brand-gradient text-white shadow-glow' : 'bg-surface-sunken text-ink-muted hover:bg-border/60'
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* The scroll region is a WRAPPER, not the grid itself -- putting `overflow-y-auto`
          directly on a `flex-1` CSS Grid container makes Chromium/WebKit treat the flex-
          assigned height as a hard cap during row track-sizing (because a non-visible
          `overflow` value zeroes out the item's "automatic minimum size" for flex sizing),
          so every "auto" row got squeezed to fit inside that cap instead of sizing to its
          content -- collapsing every product card to ~13px tall with everything invisible.
          Moving flex-grow + overflow-y-auto to this wrapper and letting the grid size
          naturally inside it fixes that; the wrapper still scrolls exactly the same. */}
      <div className="flex-1 overflow-y-auto pb-2 pr-1">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => (item.sold_by_weight ? onWeigh(item) : onAdd(item))}
              className="card-lift group flex animate-fadeInUp flex-col overflow-hidden rounded-xl border border-border bg-surface text-left shadow-card transition-all hover:border-brand/60 hover:shadow-card-hover active:scale-[0.98]"
            >
              <ItemThumb item={item} />
              <div className="flex flex-1 flex-col p-3">
                <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{item.name}</span>
                <span className="mt-auto flex items-baseline gap-1 pt-2 text-lg font-bold text-brand">
                  €{parsePrice(item.price).toFixed(2)}
                  {Boolean(item.sold_by_weight) && (
                    <span className="text-xs font-normal text-ink-muted">/ {item.weight_unit || 'kg'}</span>
                  )}
                </span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center gap-2 py-16 text-center text-ink-muted">
              <span className="text-4xl">🔍</span>
              <p>No items match.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
