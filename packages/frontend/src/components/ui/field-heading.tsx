import type { ReactNode } from 'react';

/** A setting under a small heading ("Level", "For at least"), as the
 * pickers' Fill in column lays its settings out. */
export function FieldHeading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </span>
      {children}
    </div>
  );
}
