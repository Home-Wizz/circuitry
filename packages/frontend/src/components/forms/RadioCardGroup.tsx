import { cn } from '@/lib/utils';

export interface RadioCardOption {
  value: string;
  label: string;
  description?: string;
}

interface RadioCardGroupProps {
  value: string;
  onChange: (value: string) => void;
  options: RadioCardOption[];
}

/**
 * A stacked radio-card selector — each option is its own row with a radio
 * dot, a bold label, and an optional description underneath, the selected
 * row highlighted. Mirrors real HA's own condition/trigger editor's
 * "Condition passes if" Any/All picker (a list of description-bearing radio
 * rows, not a collapsed dropdown) — built as a small reusable primitive
 * (rather than a one-off in NativeConditionFields.tsx) since any field with
 * a small, fixed set of self-explanatory options benefits from the same
 * treatment.
 */
export function RadioCardGroup({ value, onChange, options }: RadioCardGroupProps) {
  return (
    <div className="space-y-2">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={cn(
              'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
              selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                selected ? 'border-primary' : 'border-muted-foreground'
              )}
            >
              {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <span className="flex flex-col">
              <span className="font-medium text-sm">{option.label}</span>
              {option.description && (
                <span className="text-muted-foreground text-xs">{option.description}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
