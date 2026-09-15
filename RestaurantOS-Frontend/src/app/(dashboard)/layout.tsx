'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { getToken } from '@/lib/api';

/**
 * Auth guard for every /pos, /menu, /orders, /tables, /kitchen, /reports, /customers,
 * /online-orders, /settings/* screen. Without this, a fresh install (setup wizard completed
 * but no signup/login ever done) or an expired/cleared token would silently 401 on every
 * API call with no way to navigate anywhere else -- the desktop shell always boots straight
 * to /pos once setup is marked complete (see RestaurantOS-Desktop/main.js createMainWindow),
 * so there was no other route that would ever show a login screen.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setChecked(true);
  }, [router]);

  if (!checked) return null;

  return (
    <div className="flex">
      <Sidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
