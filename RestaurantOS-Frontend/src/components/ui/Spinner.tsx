import clsx from 'clsx';

/** POS design system (project audit 2026-09-15). The one loading indicator every screen uses. */
export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizeClasses = { sm: 'h-4 w-4 border-2', md: 'h-6 w-6 border-2', lg: 'h-10 w-10 border-[3px]' }[size];
  return (
    <div
      role="status"
      aria-label="Loading"
      className={clsx('animate-spin rounded-full border-brand border-t-transparent', sizeClasses, className)}
    />
  );
}
