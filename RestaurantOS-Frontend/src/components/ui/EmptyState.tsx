import { ReactNode } from 'react';

/**
 * POS design system (project audit 2026-09-15): the one "nothing here" / "something went
 * wrong" placeholder every screen uses, instead of each list screen inventing its own
 * blank-state or error copy. Doubles as an error state -- `icon` and `action` are both
 * optional, so a bare "No orders yet" and a "Couldn't load menu — [Retry]" use the same component.
 */
export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-sunken px-6 py-12 text-center">
      <span className="text-4xl" aria-hidden="true">{icon}</span>
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
