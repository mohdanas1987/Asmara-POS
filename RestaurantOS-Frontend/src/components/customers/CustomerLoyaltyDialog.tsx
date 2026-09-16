'use client';

/**
 * Customer QR/barcode identity + printable loyalty card (task #48). The backend has assigned
 * every customer a scannable `customer_code` and exposed balance/ledger/lookup-by-code since
 * the loyalty subsystem was built (task #31, routes/loyalty.js) -- nothing in the frontend
 * displayed a code, a QR, a balance, or a ledger until now.
 *
 * The QR simply encodes the customer_code as plain text; GET /loyalty/lookup/:code already
 * exists for scan-to-lookup at the POS, so a barcode scanner or camera reading this code and
 * typing/pasting it into that lookup works today with zero further backend changes.
 */
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { getCurrentRole } from '@/lib/auth';
import { PERMISSIONS, roleHasPermission } from '@/lib/permissions';
import { getCustomerLoyalty, redeemLoyaltyPoints, adjustLoyaltyPoints } from '@/lib/api';
import { Customer, LoyaltyLedgerRow } from '@/lib/types';

interface CustomerLoyaltyDialogProps {
  customerId: number | null;
  onClose: () => void;
}

export function CustomerLoyaltyDialog({ customerId, onClose }: CustomerLoyaltyDialogProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LoyaltyLedgerRow[]>([]);
  const [redeemPoints, setRedeemPoints] = useState('');
  const [adjustPoints, setAdjustPoints] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [busy, setBusy] = useState<'redeem' | 'adjust' | null>(null);

  const role = getCurrentRole();
  const canRedeem = roleHasPermission(role, PERMISSIONS.LOYALTY_REDEEM);
  const canAdjust = roleHasPermission(role, PERMISSIONS.LOYALTY_ADJUST);

  async function load(id: number) {
    setLoading(true);
    try {
      const res = await getCustomerLoyalty(id);
      if (res.status) {
        setCustomer(res.customer);
        setBalance(res.balance);
        setLedger(res.ledger);
      }
    } catch {
      showToast('Could not load loyalty details.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (customerId != null) {
      setRedeemPoints('');
      setAdjustPoints('');
      setAdjustReason('');
      load(customerId);
    }
  }, [customerId]);

  async function handleRedeem() {
    if (!customer) return;
    const points = Number(redeemPoints);
    if (!points || points <= 0) {
      showToast('Enter a valid number of points.', 'error');
      return;
    }
    setBusy('redeem');
    try {
      const res = await redeemLoyaltyPoints(customer.id, points);
      if (res.status) {
        showToast(res.message, 'success');
        setRedeemPoints('');
        await load(customer.id);
      } else {
        showToast(res.message || 'Redeem failed.', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || 'Redeem failed.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function handleAdjust() {
    if (!customer) return;
    const points = Number(adjustPoints);
    if (!points || !adjustReason.trim()) {
      showToast('Enter a non-zero point amount and a reason.', 'error');
      return;
    }
    setBusy('adjust');
    try {
      const res = await adjustLoyaltyPoints(customer.id, points, adjustReason.trim());
      if (res.status) {
        showToast(res.message, 'success');
        setAdjustPoints('');
        setAdjustReason('');
        await load(customer.id);
      } else {
        showToast(res.message || 'Adjustment failed.', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || 'Adjustment failed.', 'error');
    } finally {
      setBusy(null);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <Dialog open={customerId != null} onClose={onClose} title="Loyalty card">
      {loading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {!loading && customer && (
        <div className="flex flex-col gap-4">
          <div id="loyalty-card-print" className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface-sunken p-4">
            <div className="text-base font-semibold text-ink">{customer.name}</div>
            {customer.customer_code ? (
              <>
                <QRCodeSVG value={customer.customer_code} size={160} level="M" marginSize={2} />
                <div className="font-mono text-sm tracking-widest text-ink-muted">{customer.customer_code}</div>
              </>
            ) : (
              <p className="text-sm text-ink-muted">No loyalty code assigned to this customer yet.</p>
            )}
            <div className="text-sm text-ink">
              Balance: <span className="font-semibold">{balance} points</span>
            </div>
          </div>

          <Button type="button" variant="secondary" size="sm" onClick={handlePrint}>
            Print card
          </Button>

          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-ink">Recent activity</div>
            {ledger.length === 0 && <p className="text-sm text-ink-muted">No activity yet.</p>}
            {ledger.slice(0, 10).map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-sm">
                <div>
                  <span className="capitalize text-ink">{row.type}</span>
                  {row.reason && <span className="text-ink-muted"> · {row.reason}</span>}
                </div>
                <span className={row.points >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
                  {row.points >= 0 ? '+' : ''}
                  {row.points}
                </span>
              </div>
            ))}
          </div>

          {canRedeem && balance > 0 && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="text-sm font-medium text-ink">Redeem points</div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  placeholder="Points"
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.value)}
                  className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <Button type="button" variant="primary" size="sm" disabled={busy === 'redeem'} onClick={handleRedeem}>
                  {busy === 'redeem' ? '…' : 'Redeem'}
                </Button>
              </div>
            </div>
          )}

          {canAdjust && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="text-sm font-medium text-ink">Manual adjustment</div>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="+/- points"
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(e.target.value)}
                  className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <input
                  type="text"
                  placeholder="Reason"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <Button type="button" variant="secondary" size="sm" disabled={busy === 'adjust'} onClick={handleAdjust}>
                  {busy === 'adjust' ? '…' : 'Apply'}
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
