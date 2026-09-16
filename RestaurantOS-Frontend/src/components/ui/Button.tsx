import { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variantClasses: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark',
  secondary: 'bg-surface-sunken text-ink hover:brightness-95 dark:hover:brightness-125',
  ghost: 'bg-transparent text-brand hover:bg-brand/10',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

// POS design system (project audit 2026-09-15): every size still meets the 44px minimum
// touch target (see globals.css's .touch-target) even at "sm" -- there is no size variant
// small enough to become a mis-tap risk during a busy dinner service.
const sizeClasses: Record<Size, string> = {
  sm: 'min-h-touch px-3 text-sm',
  md: 'min-h-touch px-4 py-2 text-base',
  lg: 'min-h-[52px] px-6 py-3 text-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={clsx(
        'rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}
