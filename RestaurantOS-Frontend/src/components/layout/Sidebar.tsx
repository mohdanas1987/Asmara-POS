'use client';

/**
 * POS design system (project audit 2026-09-15, task "POS design system pass"): rewritten to
 * use theme tokens (surface/border/ink -- see globals.css) instead of hardcoded
 * `bg-white`/`text-neutral-*` classes, so this looks right in both light and dark mode, and
 * to add a real, user-controlled, persisted collapse toggle instead of relying only on a
 * CSS breakpoint (which never let a user on a wide desktop monitor choose to collapse it).
 */
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/Button';

const NAV = [
  { href: '/pos', label: 'POS', icon: '🧾' },
  { href: '/tables', label: 'Tables', icon: '🍽️' },
  { href: '/orders', label: 'Orders', icon: '📋' },
  { href: '/online-orders', label: 'Online Orders', icon: '🌐' },
  { href: '/kitchen', label: 'Kitchen Display', icon: '🍳' },
  { href: '/menu', label: 'Menu', icon: '📖' },
  { href: '/customers', label: 'Customers', icon: '👥' },
  { href: '/reports', label: 'Reports', icon: '📊' },
  { href: '/settings/website', label: 'Website Sync', icon: '🔗' },
  { href: '/settings/payments', label: 'Payments', icon: '💳' },
];

const STORAGE_KEY = 'restaurantos-sidebar-collapsed';

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      // localStorage unavailable -- default (expanded) is a perfectly fine fallback.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Best-effort persistence only -- collapsing still works for this session.
      }
      return next;
    });
  }

  return (
    <nav
      className={clsx(
        'flex h-screen flex-col gap-1 border-r border-border bg-surface py-4 transition-[width] duration-150',
        collapsed ? 'w-16 items-center' : 'w-56 items-stretch px-3'
      )}
    >
      <div className={clsx('mb-2 flex items-center gap-2 px-2', collapsed && 'justify-center px-0')}>
        <Image src="/asmara-logo.png" alt="Asmara Restaurant" width={32} height={32} className="rounded-md object-contain" />
        {!collapsed && <span className="text-lg font-bold text-brand">Asmara</span>}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="touch-target mb-2 self-center"
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '»' : '«'}
      </Button>

      {NAV.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            className={clsx(
              'touch-target flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'bg-brand text-white' : 'text-ink-muted hover:bg-surface-sunken',
              collapsed && 'justify-center px-0'
            )}
          >
            <span aria-hidden="true">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
