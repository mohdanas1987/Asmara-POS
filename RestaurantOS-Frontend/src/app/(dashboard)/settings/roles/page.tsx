'use client';

/**
 * Roles & Permissions admin UI (CTO forensic audit 2026-09-20, task "role_permissions" --
 * flagged as missing, correctly: RBAC was enforced everywhere but the role -> permission map
 * only lived as a hardcoded object in the backend, with no way for a tenant admin to see or
 * change it without a code deploy). Backed by GET/PATCH/DELETE /roles/permissions -- see
 * backend/config/permissions.js's roleHasPermissionForTenant() for how a toggle here
 * actually takes effect on the next request. admin's row is intentionally never shown --
 * its wildcard access can't be overridden (see that same file for why).
 */
import { useEffect, useState } from 'react';
import { getRolePermissionMatrix, setRolePermission, resetRolePermission } from '@/lib/api';
import { RolePermissionRow } from '@/lib/types';

const PERMISSION_LABELS: Record<string, string> = {
  'staff.view': 'View staff',
  'staff.manage': 'Manage staff',
  'menu.manage': 'Manage menu',
  'tables.manage': 'Manage tables',
  'tables.transfer': 'Transfer tables',
  'orders.create': 'Create orders',
  'orders.void': 'Void orders',
  'payments.refund': 'Refund payments',
  'kitchen.view': 'View kitchen display',
  'reports.view': 'View reports',
  'settings.manage': 'Manage settings',
  'billing.manage': 'Manage billing',
  'loyalty.redeem': 'Redeem loyalty points',
  'loyalty.adjust': 'Adjust loyalty balances',
};

export default function RolesSettingsPage() {
  const [matrix, setMatrix] = useState<RolePermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getRolePermissionMatrix()
      .then((res) => {
        if (!res.status) throw new Error('Could not load the permission matrix.');
        setMatrix(res.matrix);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the permission matrix.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleToggle(role: string, permission: string, currentlyEnabled: boolean, isOverride: boolean, defaultValue: boolean) {
    const key = `${role}:${permission}`;
    setBusyKey(key);
    setError(null);
    try {
      const nextEnabled = !currentlyEnabled;
      // If flipping back to exactly the hardcoded default, clear the override instead of
      // storing a redundant row -- keeps the matrix honest about what's actually customized.
      if (isOverride && nextEnabled === defaultValue) {
        await resetRolePermission(role, permission);
      } else {
        await setRolePermission(role, permission, nextEnabled);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update permission.');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-neutral-900">🔐 Roles & Permissions</h1>
      <p className="mb-4 text-sm text-neutral-500">
        What each role can do, beyond the built-in defaults. A highlighted cell means it's been customized here --
        clicking it again reverts to the default. Admin always has full access and isn't shown.
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-neutral-400">Loading…</p>}

      {!loading && matrix.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2">Permission</th>
                {matrix.map((row) => (
                  <th key={row.role} className="px-4 py-2 text-center capitalize">{row.role}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix[0].permissions.map((_, permIndex) => {
                const permission = matrix[0].permissions[permIndex].permission;
                return (
                  <tr key={permission} className="border-t border-neutral-100">
                    <td className="px-4 py-2 font-medium text-neutral-800">{PERMISSION_LABELS[permission] || permission}</td>
                    {matrix.map((row) => {
                      const entry = row.permissions[permIndex];
                      const key = `${row.role}:${permission}`;
                      return (
                        <td key={key} className="px-4 py-2 text-center">
                          <button
                            disabled={busyKey === key}
                            onClick={() => handleToggle(row.role, permission, entry.enabled, entry.isOverride, entry.default)}
                            title={entry.isOverride ? 'Customized -- click to revert to default' : 'Default -- click to customize'}
                            className={`inline-flex h-6 w-6 items-center justify-center rounded-md border text-xs font-bold ${
                              entry.enabled
                                ? entry.isOverride
                                  ? 'border-sky-500 bg-sky-100 text-sky-700'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                : entry.isOverride
                                ? 'border-sky-500 bg-sky-100 text-sky-400'
                                : 'border-neutral-200 bg-neutral-50 text-neutral-300'
                            }`}
                          >
                            {entry.enabled ? '✓' : '—'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-400">
        <span className="mr-3">🟢 default-granted</span>
        <span className="mr-3">🔵 customized here</span>
        <span>⚪ default-denied</span>
      </p>
    </main>
  );
}
