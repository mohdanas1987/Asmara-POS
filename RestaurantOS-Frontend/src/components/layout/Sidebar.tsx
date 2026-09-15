'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

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

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex h-screen w-16 flex-col items-center gap-1 border-r border-neutral-200 bg-white py-4 lg:w-56 lg:items-stretch lg:px-3">
      <div className="mb-4 flex items-center gap-2 px-2 lg:text-left">
        <Image src="/asmara-logo.png" alt="Asmara Restaurant" width={32} height={32} className="rounded-md object-contain" />
        <span className="hidden text-lg font-bold text-brand lg:inline">Asmara</span>
      </div>
      {NAV.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'bg-brand text-white' : 'text-neutral-600 hover:bg-neutral-100'
            )}
          >
            <span>{item.icon}</span>
            <span className="hidden lg:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
