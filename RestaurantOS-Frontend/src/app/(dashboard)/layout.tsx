'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { SyncIndicator } from '@/components/layout/SyncIndicator';
import { useTerminalHeartbeat } from '@/lib/hooks/useTerminalHeartbeat';
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

  // Offline sync (task #47): registers this browser as a terminal once per authenticated
  // session and on a slow heartbeat, regardless of which screen is open. Runs here (not
  // inside TopBar) because TopBar isn't on every screen yet, while every real screen goes
  // through this layout.
  useTerminalHeartbeat();

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
      {/* Fixed overlay, not part of the flex flow -- several screens under here use
          `h-screen` (Orders, Tables, ...) and a layout row above them would push their
          content past the viewport instead of just overlapping a corner. The Tables screen
          already shows this same indicator via its own TopBar -- harmless to show it twice
          there, and every other screen gets it here for the first time. */}
      <div className="fixed right-3 top-3 z-30">
        <SyncIndicator />
      </div>
    </div>
  );
}
