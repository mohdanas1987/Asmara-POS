'use client';

/**
 * Menu modifiers & spice levels (task #40) -- menu CONFIGURATION only. Lets a manager define
 * modifier groups (e.g. "Spice Level", "Extras") and their options against one menu item.
 * Deliberately does not touch the POS cart or order-taking flow -- selecting a modifier while
 * building an order is a separate, not-yet-built follow-up (see the backend migration's
 * comment for why that's kept apart from this).
 */
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import {
  getItemModifierGroups,
  createModifierGroup,
  deleteModifierGroup,
  createModifier,
  deleteModifier,
} from '@/lib/api';
import { ModifierGroup, MenuItem } from '@/lib/types';

interface ItemModifiersDialogProps {
  item: MenuItem | null;
  onClose: () => void;
}

export function ItemModifiersDialog({ item, onClose }: ItemModifiersDialogProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupType, setNewGroupType] = useState<'single' | 'multiple'>('single');
  const [newModifierName, setNewModifierName] = useState<Record<number, string>>({});
  const [newModifierPrice, setNewModifierPrice] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  async function load(menuItemId: number) {
    setLoading(true);
    try {
      const res = await getItemModifierGroups(menuItemId);
      if (res.status) setGroups(res.groups);
    } catch {
      showToast('Could not load modifiers.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (item) {
      setNewGroupName('');
      setNewModifierName({});
      setNewModifierPrice({});
      load(item.id);
    }
  }, [item]);

  async function handleAddGroup() {
    if (!item || !newGroupName.trim()) {
      showToast('Enter a group name (e.g. "Spice Level" or "Extras").', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await createModifierGroup({ menu_item_id: item.id, name: newGroupName.trim(), selection_type: newGroupType });
      if (res.status) {
        setNewGroupName('');
        await load(item.id);
      } else {
        showToast(res.message || 'Could not add group.', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || 'Could not add group.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteGroup(groupId: number) {
    if (!item) return;
    setBusy(true);
    try {
      await deleteModifierGroup(groupId);
      await load(item.id);
    } catch (e: any) {
      showToast(e?.message || 'Could not delete group.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddModifier(groupId: number) {
    if (!item) return;
    const name = (newModifierName[groupId] || '').trim();
    if (!name) {
      showToast('Enter a modifier name.', 'error');
      return;
    }
    const priceDelta = Number(newModifierPrice[groupId] || 0) || 0;
    setBusy(true);
    try {
      const res = await createModifier(groupId, { name, price_delta: priceDelta });
      if (res.status) {
        setNewModifierName((prev) => ({ ...prev, [groupId]: '' }));
        setNewModifierPrice((prev) => ({ ...prev, [groupId]: '' }));
        await load(item.id);
      } else {
        showToast(res.message || 'Could not add modifier.', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || 'Could not add modifier.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteModifier(modifierId: number) {
    if (!item) return;
    setBusy(true);
    try {
      await deleteModifier(modifierId);
      await load(item.id);
    } catch (e: any) {
      showToast(e?.message || 'Could not delete modifier.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={item != null} onClose={onClose} title={item ? `Modifiers — ${item.name}` : 'Modifiers'}>
      {loading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {!loading && (
        <div className="flex flex-col gap-4">
          {groups.length === 0 && (
            <p className="text-sm text-ink-muted">No modifier groups yet -- e.g. a "Spice Level" (single choice) or "Extras" (multiple).</p>
          )}

          {groups.map((group) => (
            <div key={group.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-ink">
                  {group.name}{' '}
                  <span className="text-xs font-normal capitalize text-ink-muted">({group.selection_type} choice)</span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDeleteGroup(group.id)}
                  className="text-xs text-rose-600 hover:underline"
                >
                  Delete group
                </button>
              </div>

              <div className="flex flex-col gap-1">
                {group.modifiers.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded bg-surface-sunken px-2 py-1 text-sm">
                    <span className="text-ink">{m.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-ink-muted">
                        {Number(m.price_delta) >= 0 ? '+' : ''}
                        €{Number(m.price_delta).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDeleteModifier(m.id)}
                        className="text-xs text-rose-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  placeholder="Option name (e.g. Medium)"
                  value={newModifierName[group.id] || ''}
                  onChange={(e) => setNewModifierName((prev) => ({ ...prev, [group.id]: e.target.value }))}
                  className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="+/- price"
                  value={newModifierPrice[group.id] || ''}
                  onChange={(e) => setNewModifierPrice((prev) => ({ ...prev, [group.id]: e.target.value }))}
                  className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => handleAddModifier(group.id)}>
                  Add
                </Button>
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="text-sm font-medium text-ink">New modifier group</div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder='e.g. "Spice Level" or "Extras"'
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <select
                value={newGroupType}
                onChange={(e) => setNewGroupType(e.target.value as 'single' | 'multiple')}
                className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-ink"
              >
                <option value="single">Single choice</option>
                <option value="multiple">Multiple choice</option>
              </select>
              <Button type="button" variant="primary" size="sm" disabled={busy} onClick={handleAddGroup}>
                Add group
              </Button>
            </div>
          </div>

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
