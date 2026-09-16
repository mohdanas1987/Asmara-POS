'use client';

/**
 * POS design system (project audit 2026-09-15, task "POS design system pass"): the one
 * shared modal/dialog implementation. Closes on Escape and on backdrop click (both
 * overridable), traps nothing fancy beyond that -- a full focus trap is worth adding once a
 * real accessibility pass happens, but Escape + backdrop-click covers the actual daily
 * friction of "how do I get out of this dialog" on a touch POS.
 */
import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  closeOnBackdrop?: boolean;
}

export function Dialog({ open, onClose, title, children, closeOnBackdrop = true }: DialogProps) {
  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface-raised p-6 shadow-2xl"
      >
        {title && <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>}
        {children}
      </div>
    </div>,
    document.body
  );
}
