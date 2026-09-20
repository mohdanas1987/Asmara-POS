'use client';

/**
 * POS design system (project audit 2026-09-15, task "POS design system pass"): rewritten to
 * use theme tokens (surface/border/ink -- see globals.css) instead of hardcoded
 * `bg-white`/`text-neutral-*` classes, so this looks right in both light and dark mode, and
 * to add a real, user-controlled, persisted collapse toggle instead of relying only on a
 * CSS breakpoint (which never let a user on a wide desktop monitor choose to collapse it).
 *
 * RBAC-aware navigation (execution plan Phase 10 gap: "frontend adapts to role"): nav items
 * are now grouped and each item is filtered by the same permission the backend already
 * enforces server-side (config/permissions.js / requirePermission). This is a UX convenience
 * only -- it hides items a role can't use, it grants nothing, and a direct request to a
 * hidden route is still rejected server-side exactly as before (see lib/auth.ts's caveat).
 */
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/Button';
import { getCurrentRole } from '@/lib/auth';
import { PERMISSIONS, roleHasPermission } from '@/lib/permissions';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { href: '/pos', label: 'POS', icon: '🧾', permission: PERMISSIONS.ORDERS_CREATE },
      { href: '/tables', label: 'Tables', icon: '🍽️', permission: PERMISSIONS.TABLES_MANAGE },
      { href: '/orders', label: 'Orders', icon: '📋', permission: PERMISSIONS.ORDERS_CREATE },
      { href: '/online-orders', label: 'Online Orders', icon: '🌐', permission: PERMISSIONS.ORDERS_CREATE },
      { href: '/kitchen', label: 'Kitchen Display', icon: '🍳', permission: PERMISSIONS.KITCHEN_VIEW },
      { href: '/reports', label: 'Reports', icon: '📊', permission: PERMISSIONS.REPORTS_VIEW },
    ],
  },
  {
    label: 'Menu & Customers',
    items: [
      { href: '/menu', label: 'Menu', icon: '📖', permission: PERMISSIONS.MENU_MANAGE },
      { href: '/customers', label: 'Customers', icon: '👥', permission: PERMISSIONS.LOYALTY_REDEEM },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings/website', label: 'Website Sync', icon: '🔗', permission: PERMISSIONS.SETTINGS_MANAGE },
      { href: '/settings/payments', label: 'Payments', icon: '💳', permission: PERMISSIONS.SETTINGS_MANAGE },
      { href: '/settings/tax', label: 'Tax Rates', icon: '🧮', permission: PERMISSIONS.SETTINGS_MANAGE },
      { href: '/settings/printers', label: 'Printers', icon: '🖨️', permission: PERMISSIONS.SETTINGS_MANAGE },
      { href: '/settings/staff', label: 'Staff', icon: '🧑\u200d🍳', permission: PERMISSIONS.STAFF_VIEW },
      { href: '/settings/roles', label: 'Roles & Permissions', icon: '🔐', permission: PERMISSIONS.SETTINGS_MANAGE },
    ],
  },
];

const STORAGE_KEY = 'restaurantos-sidebar-collapsed';

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // Role is read from the JWT client-side only after mount, so SSR and the first client
  // render agree (avoids a hydration mismatch). Until then, `role` is null and
  // roleHasPermission(null, ...) is false for everything -- so on first paint no gated item
  // is shown rather than briefly flashing items a role can't use.
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      // localStorage unavailable -- default (expanded) is a perfectly fine fallback.
    }
    setRole(getCurrentRole());
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

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => roleHasPermission(role, item.permission)),
  })).filter((group) => group.items.length > 0);

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

      {groups.map((group) => (
        <div key={group.label} className={clsx('mb-1 mt-2 flex flex-col gap-1 first:mt-0', collapsed && 'items-center')}>
          {!collapsed && (
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              {group.label}
            </div>
          )}
          {group.items.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={clsx(
                  'touch-target flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                  active ? 'bg-brand text-white shadow-sm' : 'text-ink-muted hover:bg-surface-sunken hover:translate-x-0.5',
                  collapsed && 'justify-center px-0'
                )}
              >
                <span aria-hidden="true">{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
