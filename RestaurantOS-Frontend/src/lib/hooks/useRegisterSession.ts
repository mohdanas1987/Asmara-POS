'use client';

import { useCallback, useEffect, useState } from 'react';
import { getLastActiveSession, openRegister } from '@/lib/api';
import { CashRegisterSession } from '@/lib/types';

export function useRegisterSession() {
  const [session, setSession] = useState<CashRegisterSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLastActiveSession();
      setSession(res.session && res.session.status ? res.session : null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check register status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const open = useCallback(
    async (openingCash: number) => {
      const res = await openRegister(openingCash);
      setSession(res.created);
      return res;
    },
    []
  );

  return { session, isOpen: !!session, loading, error, open, refresh };
}
