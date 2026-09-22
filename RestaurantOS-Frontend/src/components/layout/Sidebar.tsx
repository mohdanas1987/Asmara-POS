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
 *
 * Beautification pass (2026-09-22): each nav group is now independently collapsible (a
 * chevron toggles it, state persisted per-group so a returning user's preference sticks),
 * and a user identity + logout footer was added -- until now there was no way to sign out
 * of the app at all short of clearing localStorage by hand.
 */
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/Button';
import { getCurrentRole } from '@/lib/auth';
import { PERMISSIONS, roleHasPermission } from '@/lib/permissions';
import { clearToken, getBranding } from '@/lib/api';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission: string;
}

interface NavGroup {
  label: string;
  accent: string; // small color accent for the group's chevron/label, purely decorative
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    accent: 'text-brand',
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
    accent: 'text-amber-600 dark:text-amber-400',
    items: [
      { href: '/menu', label: 'Menu', icon: '📖', permission: PERMISSIONS.MENU_MANAGE },
      { href: '/customers', label: 'Customers', icon: '👥', permission: PERMISSIONS.LOYALTY_REDEEM },
    ],
  },
  {
    label: 'Settings',
    accent: 'text-slate-500 dark:text-slate-400',
    items: [
      { href: '/settings/branding', label: 'Branding & Display', icon: '🎨', permission: PERMISSIONS.SETTINGS_MANAGE },
      { href: '/settings/website', label: 'Website Sync', icon: '🔗', permission: PERMISSIONS.SETTINGS_MANAGE },
      { href: '/settings/payments', label: 'Payments', icon: '💳', permission: PERMISSIONS.SETTINGS_MANAGE },
      { href: '/settings/tax', label: 'Tax Rates', icon: '🧮', permission: PERMISSIONS.SETTINGS_MANAGE },
      { href: '/settings/printers', label: 'Printers', icon: '🖨️', permission: PERMISSIONS.SETTINGS_MANAGE },
      { href: '/settings/staff', label: 'Staff', icon: '🧑‍🍳', permission: PERMISSIONS.STAFF_VIEW },
      { href: '/settings/roles', label: 'Roles & Permissions', icon: '🔐', permission: PERMISSIONS.SETTINGS_MANAGE },
    ],
  },
];

const STORAGE_KEY = 'restaurantos-sidebar-collapsed';
const GROUPS_STORAGE_KEY = 'restaurantos-sidebar-open-groups';
// Sidebar drag-resize (CTO forensic audit 2026-09-20): the sidebar previously only supported
// two fixed widths via the collapse toggle (w-16 / w-56) -- no drag-to-resize at all. This
// adds a real, user-draggable width for the expanded state, persisted separately from the
// collapse flag so collapsing/expanding never clobbers a width the user picked.
const WIDTH_STORAGE_KEY = 'restaurantos-sidebar-width';
const COLLAPSED_WIDTH = 64; // matches the old w-16
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 200;
const MAX_WIDTH = 360;

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  cashier: 'Cashier',
  waiter: 'Waiter',
  kitchen: 'Kitchen Staff',
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Role is read from the JWT client-side only after mount, so SSR and the first client
  // render agree (avoids a hydration mismatch). Until then, `role` is null and
  // roleHasPermission(null, ...) is false for everything -- so on first paint no gated item
  // is shown rather than briefly flashing items a role can't use.
  const [role, setRole] = useState<string | null>(null);
  // Which groups are expanded, keyed by label -- defaults to "all open" (matches the old,
  // always-expanded behavior) until a saved preference is loaded.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(NAV_GROUPS.map((g) => [g.label, true]))
  );
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    getBranding()
      .then((res) => {
        if (res.status && res.logo) setLogoUrl(`/images/${res.logo}`);
      })
      .catch(() => {
        // No custom logo set (or request failed) -- falls back to the default Asmara mark.
      });
  }, []);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === 'true');
      const savedWidth = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
      if (Number.isFinite(savedWidth) && savedWidth > 0) setWidth(clampWidth(savedWidth));
      const savedGroups = window.localStorage.getItem(GROUPS_STORAGE_KEY);
      if (savedGroups) setOpenGroups((prev) => ({ ...prev, ...JSON.parse(savedGroups) }));
    } catch {
      // localStorage unavailable -- the defaults (expanded, DEFAULT_WIDTH, all groups open)
      // are a fine fallback.
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

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Best-effort persistence only.
      }
      return next;
    });
  }

  function handleLogout() {
    setLoggingOut(true);
    clearToken();
    router.replace('/login');
  }

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => roleHasPermission(role, item.permission)),
  })).filter((group) => group.items.length > 0);

  const roleLabel = role ? (ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1)) : 'Signed in';
  const roleInitial = roleLabel.charAt(0).toUpperCase();

  return (
    <nav
      style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
      className={clsx(
        'relative flex h-screen flex-shrink-0 flex-col border-r border-border bg-surface',
        !resizing && 'transition-[width] duration-150',
        collapsed ? 'items-center' : 'items-stretch'
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

      {/* Header -- a subtle brand-gradient plate behind the logo gives the sidebar an
          identity of its own instead of blending into the flat page background. */}
      <div
        className={clsx(
          'flex items-center gap-2.5 border-b border-border bg-brand-gradient-soft px-4 py-4',
          collapsed && 'justify-center px-0'
        )}
      >
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-gradient shadow-glow">
          <Image src={logoUrl || '/asmara-logo.png'} alt="" width={22} height={22} className="rounded object-contain" unoptimized={Boolean(logoUrl)} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-base font-bold leading-tight text-ink">Asmara</div>
            <div className="truncate text-[11px] font-medium leading-tight text-ink-muted">Restaurant POS</div>
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="touch-target my-2 self-center"
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '»' : '«'}
      </Button>

      <div className={clsx('flex-1 overflow-y-auto overflow-x-hidden pb-2', !collapsed && 'px-3')}>
        {groups.map((group) => {
          const isOpen = collapsed || (openGroups[group.label] ?? true);
          return (
            <div key={group.label} className={clsx('mb-1 mt-3 flex flex-col first:mt-0', collapsed && 'items-center')}>
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="flex touch-target items-center justify-between gap-2 rounded-md px-3 py-1 text-left transition-colors hover:bg-surface-sunken"
                  aria-expanded={isOpen}
                >
                  <span className={clsx('text-[11px] font-bold uppercase tracking-wider', group.accent)}>
                    {group.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className={clsx(
                      'text-[10px] text-ink-muted transition-transform duration-200',
                      isOpen ? 'rotate-90' : 'rotate-0'
                    )}
                  >
                    ▶
                  </span>
                </button>
              ) : (
                <div className={clsx('h-1.5 w-6 rounded-full', group.accent.replace('text-', 'bg-'), 'opacity-40')} />
              )}

              {isOpen && (
                <div className={clsx('mt-1 flex flex-col gap-0.5', !collapsed && 'animate-slideDown overflow-hidden')}>
                  {group.items.map((item) => {
                    const active = pathname?.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={clsx(
                          'touch-target group relative flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium transition-all duration-150',
                          active
                            ? 'bg-brand-gradient text-white shadow-glow'
                            : 'text-ink-muted hover:bg-surface-sunken hover:text-ink hover:translate-x-0.5',
                          collapsed && 'justify-center px-0'
                        )}
                      >
                        {active && !collapsed && (
                          <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-light" aria-hidden="true" />
                        )}
                        <span aria-hidden="true" className="text-lg">{item.icon}</span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Identity + logout footer (2026-09-22 beautification pass): previously there was no
          way to sign out of the app short of clearing localStorage by hand. */}
      <div className={clsx('border-t border-border p-3', collapsed && 'flex flex-col items-center px-0')}>
        <div className={clsx('mb-2 flex items-center gap-2.5 rounded-lg bg-surface-sunken px-2.5 py-2', collapsed && 'justify-center px-0 bg-transparent')}>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-white">
            {roleInitial}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{roleLabel}</div>
              <div className="truncate text-[11px] text-ink-muted">Signed in</div>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={loggingOut}
          onClick={handleLogout}
          title="Log out"
          aria-label="Log out"
          className={clsx('touch-target w-full justify-center gap-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40', collapsed && 'w-11 px-0')}
        >
          <span aria-hidden="true">🚪</span>
          {!collapsed && <span>{loggingOut ? 'Logging out…' : 'Log out'}</span>}
        </Button>
      </div>
    </nav>
  );
}
