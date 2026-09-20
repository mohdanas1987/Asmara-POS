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
import { useCallback, useEffect, useRef, useState } from 'react';
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
// Sidebar drag-resize (CTO forensic audit 2026-09-20): the sidebar previously only supported
// two fixed widths via the collapse toggle (w-16 / w-56) -- no drag-to-resize at all. This
// adds a real, user-draggable width for the expanded state, persisted separately from the
// collapse flag so collapsing/expanding never clobbers a width the user picked.
const WIDTH_STORAGE_KEY = 'restaurantos-sidebar-width';
const COLLAPSED_WIDTH = 64; // matches the old w-16
const DEFAULT_WIDTH = 224; // matches the old w-56
const MIN_WIDTH = 180;
const MAX_WIDTH = 360;

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Role is read from the JWT client-side only after mount, so SSR and the first client
  // render agree (avoids a hydration mismatch). Until then, `role` is null and
  // roleHasPermission(null, ...) is false for everything -- so on first paint no gated item
  // is shown rather than briefly flashing items a role can't use.
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === 'true');
      const savedWidth = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
      if (Number.isFinite(savedWidth) && savedWidth > 0) setWidth(clampWidth(savedWidth));
    } catch {
      // localStorage unavailable -- the defaults (expanded, DEFAULT_WIDTH) are a fine fallback.
    }
    setRole(getCurrentRole());
  }, []);

  const handleResizePointerMove = useCallback((e: PointerEvent) => {
    if (!dragStartRef.current) return;
    const { startX, startWidth } = dragStartRef.current;
    setWidth(clampWidth(startWidth + (e.clientX - startX)));
  }, []);

  const handleResizePointerUp = useCallback(() => {
    dragStartRef.current = null;
    setResizing(false);
    window.removeEventListener('pointermove', handleResizePointerMove);
    window.removeEventListener('pointerup', handleResizePointerUp);
    // Persist on release rather than on every pixel of movement -- avoids hammering
    // localStorage during a drag while still saving the final chosen width.
    setWidth((current) => {
      try {
        window.localStorage.setItem(WIDTH_STORAGE_KEY, String(current));
      } catch {
        // Best-effort persistence only -- the resize still works for this session.
      }
      return current;
    });
  }, [handleResizePointerMove]);

  function handleResizePointerDown(e: React.PointerEvent) {
    if (collapsed) return; // nothing to resize while collapsed -- fixed width
    dragStartRef.current = { startX: e.clientX, startWidth: width };
    setResizing(true);
    window.addEventListener('pointermove', handleResizePointerMove);
    window.addEventListener('pointerup', handleResizePointerUp);
  }

  // Double-clicking the resize handle resets to the default width -- the same "reset"
  // affordance most desktop apps' resizable panels support, and an easy way back if a drag
  // goes further than intended.
  function handleResizeDoubleClick() {
    setWidth(DEFAULT_WIDTH);
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(DEFAULT_WIDTH));
    } catch {
      // Best-effort persistence only.
    }
  }

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
      style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
      className={clsx(
        'relative flex h-screen flex-shrink-0 flex-col gap-1 border-r border-border bg-surface py-4',
        !resizing && 'transition-[width] duration-150',
        collapsed ? 'items-center' : 'items-stretch px-3'
      )}
    >
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize (double-click to reset)"
          onPointerDown={handleResizePointerDown}
          onDoubleClick={handleResizeDoubleClick}
          className={clsx(
            'absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize select-none hover:bg-brand/30',
            resizing && 'bg-brand/40'
          )}
        />
      )}
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
