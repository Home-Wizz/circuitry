import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A row of buttons of which one is chosen (When / And / Then, Above /
 * Below / In range) on a muted track: the chosen one raised, or (`tone:
 * 'primary'`, a setting's value) filled in the theme's primary colour.
 * Choosing the one already chosen does nothing.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  tone = 'raised',
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  tone?: 'raised' | 'primary';
}) {
  return (
    <fieldset
      className={cn(
        'm-0 inline-flex min-w-0 flex-wrap rounded-md border-0 bg-muted p-0.5',
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => option.value !== value && onChange(option.value)}
          className={cn(
            'rounded px-3 py-1 text-sm',
            option.value !== value
              ? 'text-muted-foreground hover:text-foreground'
              : tone === 'primary'
                ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                : 'bg-background font-semibold shadow-sm'
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
