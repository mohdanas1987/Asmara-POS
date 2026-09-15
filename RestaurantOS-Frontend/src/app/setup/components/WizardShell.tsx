'use client';

import { Button } from '@/components/ui/Button';

export function WizardShell({
  step,
  totalSteps,
  title,
  description,
  children,
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled = false,
}: {
  step: number;
  totalSteps: number;
  title: string;
  description?: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
      <div className="mb-6">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-brand">
          Step {step} of {totalSteps}
        </p>
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>

      <div className="mb-8">{children}</div>

      <div className="flex justify-between">
        {onBack ? (
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
