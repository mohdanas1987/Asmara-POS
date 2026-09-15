'use client';

import { useMemo, useState } from 'react';
import { MenuCategory, MenuItem } from '@/lib/types';
import clsx from 'clsx';

function ItemThumb({ item }: { item: MenuItem }) {
  const [broken, setBroken] = useState(false);
  if (!item.image || broken) {
    // No real photo yet (or it failed to load) -- a neutral placeholder, not a broken-image icon.
    return (
      <div className="mb-2 flex h-20 w-full items-center justify-center rounded-lg bg-neutral-100 text-2xl">
        🍽️
      </div>
    );
  }
  return (
    // Plain <img>, not next/image -- these come from the local backend's own tmp/ folder
    // (server.local.js's /images static mount), so there's no build-time optimization to
    // gain and this avoids fighting Next's remote-image allowlist for a purely local host.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/images/${item.image}`}
      alt={item.name}
      onError={() => setBroken(true)}
      className="mb-2 h-20 w-full rounded-lg object-cover"
    />
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
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory('all')}
          className={clsx(
            'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
            activeCategory === 'all' ? 'bg-brand text-white' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
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
              activeCategory === c.id ? 'bg-brand text-white' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((item) => (
          <button
            key={item.id}
            onClick={() => (item.sold_by_weight ? onWeigh(item) : onAdd(item))}
            className="flex flex-col items-start rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm transition-all hover:border-brand hover:shadow-md active:scale-[0.98]"
          >
            <ItemThumb item={item} />
            <span className="font-medium text-neutral-900">{item.name}</span>
            <span className="mt-1 text-sm text-neutral-500">{item.catName}</span>
            <span className="mt-2 text-lg font-semibold text-brand">
              €{Number(item.price).toFixed(2)}
              {item.sold_by_weight && <span className="text-xs font-normal text-neutral-400"> / {item.weight_unit || 'kg'}</span>}
            </span>
            {Boolean(item.sold_by_weight) && (
              <span className="mt-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">⚖ Sold by weight</span>
            )}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-12 text-center text-neutral-400">No items match.</p>
        )}
      </div>
    </div>
  );
}
