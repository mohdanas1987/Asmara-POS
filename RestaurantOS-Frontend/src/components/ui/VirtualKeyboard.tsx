'use client';

/**
 * POS design system (project audit 2026-09-15, task "POS design system pass"): a shared
 * on-screen QWERTY keyboard for text entry (customer names, search, notes) on a touch
 * terminal with no physical keyboard. Deliberately simple (letters, space, backspace, a
 * shift toggle for capitals) rather than a full IME -- this is a restaurant POS, not a
 * general-purpose text editor.
 */
import { useState } from 'react';
import { Button } from './Button';

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

interface VirtualKeyboardProps {
  onKeyPress: (char: string) => void;
  onBackspace: () => void;
  onEnter?: () => void;
}

export function VirtualKeyboard({ onKeyPress, onBackspace, onEnter }: VirtualKeyboardProps) {
  const [shift, setShift] = useState(false);

  function pressLetter(letter: string) {
    onKeyPress(shift ? letter.toUpperCase() : letter);
    if (shift) setShift(false); // shift is single-use, like a real phone keyboard
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-sunken p-3" role="group" aria-label="On-screen keyboard">
      {ROWS.map((row, rowIndex) => (
        <div key={row} className="flex justify-center gap-1.5">
          {rowIndex === ROWS.length - 1 && (
            <Button
              type="button"
              variant={shift ? 'primary' : 'secondary'}
              size="sm"
              className="touch-target px-3"
              onClick={() => setShift((s) => !s)}
              aria-label="Shift"
              aria-pressed={shift}
            >
              ⇧
            </Button>
          )}
          {row.split('').map((letter) => (
            <Button
              key={letter}
              type="button"
              variant="secondary"
              size="sm"
              className="touch-target w-9 px-0"
              onClick={() => pressLetter(letter)}
            >
              {shift ? letter.toUpperCase() : letter}
            </Button>
          ))}
          {rowIndex === ROWS.length - 1 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="touch-target px-3"
              onClick={onBackspace}
              aria-label="Backspace"
            >
              ⌫
            </Button>
          )}
        </div>
      ))}
      <div className="flex justify-center gap-1.5">
        <Button type="button" variant="secondary" size="sm" className="touch-target w-64" onClick={() => onKeyPress(' ')}>
          Space
        </Button>
        {onEnter && (
          <Button type="button" variant="primary" size="sm" className="touch-target px-6" onClick={onEnter}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
