'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPaymentStatus, connectPaymentProvider, disconnectPaymentProvider } from '@/lib/api';
import { PaymentProvider, PaymentTerminalStatus } from '@/lib/types';

export function usePaymentStatus() {
  const [data, setData] = useState<PaymentTerminalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getPaymentStatus();
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payment status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = useCallback(
    async (provider: PaymentProvider, apiKey: string, terminalId: string, apiSecret?: string) => {
      await connectPaymentProvider({ provider, api_key: apiKey, terminal_id: terminalId, api_secret: apiSecret });
      await refresh();
    },
    [refresh]
  );

  const disconnect = useCallback(async () => {
    await disconnectPaymentProvider();
    await refresh();
  }, [refresh]);

  return { data, loading, error, connect, disconnect };
}
