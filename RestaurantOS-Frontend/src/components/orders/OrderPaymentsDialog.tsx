'use client';

/**
 * Refund/void UI (task #42) -- the backend ledger (task #37) has supported this since it was
 * built: GET /orders/:order/payments, POST /orders/:order/refund, POST /orders/payments/:id/void.
 * Nothing in the frontend called any of it until now. Manager/admin only (same
 * PAYMENTS_REFUND permission the backend already enforces -- this dialog just doesn't render
 * the button for anyone else; the backend rejects the request either way).
 */
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { getCurrentRole } from '@/lib/auth';
import { PERMISSIONS, roleHasPermission } from '@/lib/permissions';
import { getOrderPayments, refundOrder, voidPaymentTransaction, PaymentTransaction } from '@/lib/api';

interface OrderPaymentsDialogProps {
  orderId: string | null;
  onClose: () => void;
}

function formatEuro(amount: number | string) {
  return `€${Number(amount).toFixed(2)}`;
}

export function OrderPaymentsDialog({ orderId, onClose }: OrderPaymentsDialogProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [netPaid, setNetPaid] = useState(0);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [busyId, setBusyId] = useState<string | number | null>(null);

  const canRefund = roleHasPermission(getCurrentRole(), PERMISSIONS.PAYMENTS_REFUND);

  async function load(id: string) {
    setLoading(true);
    try {
      const res = await getOrderPayments(id);
      if (res.status) {
        setTransactions(res.transactions);
        setNetPaid(res.netPaid);
      }
    } catch {
      showToast('Could not load payment history.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (orderId) {
      setRefundAmount('');
      setRefundReason('');
      load(orderId);
    }
  }, [orderId]);

  async function handleRefund() {
    if (!orderId) return;
    const amount = Number(refundAmount);
    if (!amount || amount <= 0) {
      showToast('Enter a valid refund amount.', 'error');
      return;
    }
    setBusyId('refund');
    try {
      const res = await refundOrder(orderId, amount, refundReason || undefined);
      if (res.status) {
        showToast('Refund recorded.', 'success');
        setRefundAmount('');
        setRefundReason('');
        await load(orderId);
      } else {
        showToast(res.message || 'Refund failed.', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || 'Refund failed.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleVoid(transactionId: number) {
    if (!orderId) return;
    setBusyId(transactionId);
    try {
      const res = await voidPaymentTransaction(transactionId);
      if (res.status) {
        showToast('Transaction voided.', 'success');
        await load(orderId);
      } else {
        showToast(res.message || 'Void failed.', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || 'Void failed.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={orderId != null} onClose={onClose} title="Payment history">
      {loading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {!loading && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-surface-sunken px-3 py-2 text-sm">
            <span className="text-ink-muted">Net paid: </span>
            <span className="font-semibold text-ink">{formatEuro(netPaid)}</span>
          </div>

          <div className="flex flex-col gap-2">
            {transactions.length === 0 && (
              <p className="text-sm text-ink-muted">No transactions recorded for this order.</p>
            )}
            {transactions.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium capitalize text-ink">
                    {t.type} · {t.method}{' '}
                    {t.status === 'voided' && <span className="text-ink-muted">(voided)</span>}
                  </div>
                  <div className="text-xs text-ink-muted">{new Date(t.created_at).toLocaleString('en-GB')}</div>
                  {t.note && <div className="text-xs text-ink-muted">{t.note}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{formatEuro(t.amount)}</span>
                  {canRefund && t.type === 'charge' && t.status !== 'voided' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busyId === t.id}
                      onClick={() => handleVoid(t.id)}
                    >
                      {busyId === t.id ? '…' : 'Void'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {canRefund && netPaid > 0 && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="text-sm font-medium text-ink">Issue a refund</div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <Button type="button" variant="primary" size="sm" disabled={busyId === 'refund'} onClick={handleRefund}>
                  {busyId === 'refund' ? '…' : 'Refund'}
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
