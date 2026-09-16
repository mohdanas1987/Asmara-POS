'use client';

/**
 * POS design system (project audit 2026-09-15, task "POS design system pass"): a search box
 * that offers the shared VirtualKeyboard on tap, for terminals with no physical keyboard.
 * `keyboardMode="auto"` (the default) only shows the on-screen keyboard on a coarse pointer
 * (touch) device, so a terminal with a real keyboard attached isn't forced through it.
 */
import { useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { VirtualKeyboard } from './VirtualKeyboard';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  keyboardMode?: 'auto' | 'always' | 'never';
  className?: string;
}

function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', keyboardMode = 'auto', className }: SearchInputProps) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const shouldOfferKeyboard = keyboardMode === 'always' || (keyboardMode === 'auto' && isCoarsePointer());

  function handleFocus() {
    if (shouldOfferKeyboard) {
      setKeyboardOpen(true);
      inputRef.current?.blur(); // avoid the OS's own on-screen keyboard fighting with ours
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={handleFocus}
        placeholder={placeholder}
        className={`touch-target w-full rounded-lg border border-border bg-surface-sunken px-4 text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand ${className ?? ''}`}
      />
      <Dialog open={keyboardOpen} onClose={() => setKeyboardOpen(false)} title={placeholder}>
        <input
          type="text"
          value={value}
          readOnly
          className="touch-target mb-4 w-full rounded-lg border border-border bg-surface-sunken px-4 text-lg text-ink"
        />
        <VirtualKeyboard
          onKeyPress={(char) => onChange(value + char)}
          onBackspace={() => onChange(value.slice(0, -1))}
          onEnter={() => setKeyboardOpen(false)}
        />
      </Dialog>
    </>
  );
}
