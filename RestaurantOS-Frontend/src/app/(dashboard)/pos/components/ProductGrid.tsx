'use client';

import { useMemo, useState } from 'react';
import { MenuCategory, MenuItem } from '@/lib/types';
import { parsePrice } from '@/lib/tax';
import clsx from 'clsx';

/**
 * Visual pass (owner feedback: dish photos were "getting cut and displaying half only", and
 * the whole POS "looking very basic school project" next to the current production app).
 * Two real, separate problems, both addressed here:
 *
 * 1. The old thumbnail was a fixed 80px-tall strip (`h-20`) with `object-cover` on a
 *    full-width box -- for anything but a very wide, short photo, `object-cover` crops to
 *    fill that box, and most of this menu's real dish photos are much taller than 80px
 *    relative to their width, so the vast majority of each photo (often the actual food)
 *    was being cropped away. Switched to a fixed ASPECT RATIO (`aspect-[4/3]`) that scales
 *    with the card instead of a fixed pixel height, which is what actually stops the crop
 *    from eating the subject -- a wide, shallow box is still `object-cover`, but now the box
 *    itself is shaped like the photos actually are, not like a filmstrip.
 * 2. General density/flatness: bumped image size, added a real card hover/press affordance,
 *    a category chip ON the photo (not a second line of small gray text), a cleaner
 *    price treatment, and slightly heavier shadows/spacing -- closer to how a shelf of
 *    product tiles reads in a real POS than a bare bordered box.
 */
function ItemThumb({ item }: { item: MenuItem }) {
  const [broken, setBroken] = useState(false);
  return (
    // NOTE: intentionally a fixed pixel height, not `aspect-[4/3]` -- inside a CSS Grid cell,
    // Chromium/WebKit fail to size an `aspect-ratio` box during the grid's row track-sizing
    // pass (it measures the ratio-derived height as 0 before the column width is settled),
    // which collapsed every product card down to ~13px tall with everything invisible. A
    // definite height sidesteps that entirely. Paired with `object-contain` (not `cover`) so
    // the full photo is always visible instead of being cropped -- the original owner
    // complaint ("getting cut and displaying half only") was `object-cover` on a too-short box.
    <div className="relative h-36 w-full overflow-hidden rounded-t-xl bg-neutral-100">
      {item.image && !broken ? (
        // Plain <img>, not next/image -- these come from the local backend's own tmp/ folder
        // (server.local.js's /images static mount), so there's no build-time optimization to
        // gain and this avoids fighting Next's remote-image allowlist for a purely local host.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/images/${item.image}`}
          alt={item.name}
          onError={() => setBroken(true)}
          className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
        />
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
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-[15px] shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory('all')}
          className={clsx(
            'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
            activeCategory === 'all' ? 'bg-brand text-white shadow-sm' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
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
              activeCategory === c.id ? 'bg-brand text-white shadow-sm' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
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
              className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/60 hover:shadow-lg active:translate-y-0 active:scale-[0.98]"
            >
              <ItemThumb item={item} />
              <div className="flex flex-1 flex-col p-3">
                <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-neutral-900">{item.name}</span>
                <span className="mt-auto flex items-baseline gap-1 pt-2 text-lg font-bold text-brand">
                  €{parsePrice(item.price).toFixed(2)}
                  {Boolean(item.sold_by_weight) && (
                    <span className="text-xs font-normal text-neutral-400">/ {item.weight_unit || 'kg'}</span>
                  )}
                </span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full py-12 text-center text-neutral-400">No items match.</p>
          )}
        </div>
      </div>
    </div>
  );
}
