'use client';

import { useCallback, useEffect, useState } from 'react';
import { getWebsiteStatus, connectWebsite, disconnectWebsite } from '@/lib/api';
import { WebsiteStatus } from '@/lib/types';

export function useWebsiteStatus() {
  const [data, setData] = useState<WebsiteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getWebsiteStatus();
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load website status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = useCallback(
    async (url: string) => {
      const res = await connectWebsite(url);
      await refresh();
      return res.api_key; // shown once -- the backend only ever returns a masked version after this
    },
    [refresh]
  );

  const disconnect = useCallback(async () => {
    await disconnectWebsite();
    await refresh();
  }, [refresh]);

  return { data, loading, error, connect, disconnect };
}
