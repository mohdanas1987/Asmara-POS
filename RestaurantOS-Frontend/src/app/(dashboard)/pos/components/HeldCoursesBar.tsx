'use client';

import { useEffect, useState } from 'react';
import { getHeldCourses, fireCourse } from '@/lib/api';
import { HeldCourse } from '@/lib/types';

/**
 * Course firing (CTO forensic audit 2026-09-20, task "Courses" -- flagged as never built,
 * correctly). Shows what's currently held back from the kitchen for this table's order
 * (e.g. "Main -- 2 items waiting") and lets a waiter fire a course on demand. Polls rather
 * than needing a socket subscription of its own -- held courses change rarely compared to
 * cart edits, and this bar only matters right after "Send to kitchen" anyway.
 */
export function HeldCoursesBar({ orderId, refreshKey }: { orderId: string; refreshKey: number }) {
  const [held, setHeld] = useState<HeldCourse[]>([]);
  const [firing, setFiring] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await getHeldCourses(orderId);
      if (res.status) setHeld(res.held);
    } catch {
      // Best-effort -- an order with no held courses (the common case) should never surface
      // an error banner over something that isn't actually a problem.
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, refreshKey]);

  if (held.length === 0) return null;

  async function handleFire(course: string) {
    setFiring(course);
    try {
      await fireCourse(orderId, course);
      await refresh();
    } finally {
      setFiring(null);
    }
  }

  return (
    <div className="mb-3 flex flex-wrap gap-2 rounded-xl border border-sky-300 bg-sky-50 px-4 py-2">
      {held.map((h) => (
        <div key={h.course} className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 shadow-sm">
          <span className="text-sm font-medium capitalize text-sky-900">
            {h.course} holding · {h.items.reduce((sum, i) => sum + i.quantity, 0)} item(s)
          </span>
          <button
            onClick={() => handleFire(h.course)}
            disabled={firing === h.course}
            className="rounded-md bg-sky-600 px-2 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {firing === h.course ? 'Firing…' : `Fire ${h.course} →`}
          </button>
        </div>
      ))}
    </div>
  );
}
