'use client';

/**
 * POS design system (project audit 2026-09-15, task "POS design system pass"): a shared
 * on-screen numeric keypad for cash amounts, quantities, and PINs -- a POS terminal usually
 * has no physical keyboard attached, so relying on the OS's own on-screen keyboard (if the
 * OS even shows one for a plain text input) has been the actual missing piece so far.
 */
import clsx from 'clsx';
import { Button } from './Button';

interface NumericKeypadProps {
  value: string;
  onChange: (value: string) => void;
  allowDecimal?: boolean;
  maxLength?: number;
}

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];

export function NumericKeypad({ value, onChange, allowDecimal = true, maxLength = 10 }: NumericKeypadProps) {
  function press(key: string) {
    if (key === '⌫') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '.' && (!allowDecimal || value.includes('.'))) return;
    if (value.length >= maxLength) return;
    onChange(value + key);
  }

  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Numeric keypad">
      {KEYS.map((key) => (
        <Button
          key={key}
          type="button"
          variant="secondary"
          size="lg"
          className="touch-target text-xl"
          onClick={() => press(key)}
          aria-label={key === '⌫' ? 'Backspace' : key}
        >
          {key}
        </Button>
      ))}
    </div>
  );
}
