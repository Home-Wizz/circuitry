import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, style, checked, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    checked={checked}
    // Plain inline border, not a Tailwind border-*/ring-* utility. Screen
    // recording evidence (unchecked box painted zero pixels — not
    // low-contrast, literally nothing — while the checked box's solid
    // background-color fill rendered fine) points at Tailwind v4's
    // border-width/style utilities, which compile through `@property
    // --tw-border-style`/`--tw-*` custom properties: whatever's rendering
    // this panel silently drops those when `@property` isn't supported,
    // and a `border-*` utility with no resolvable border-style paints
    // nothing at all. `background-color` utilities (which is why the
    // *checked* fill was never affected) and this plain `border` inline
    // style don't route through that custom-property machinery, so
    // neither can hit the same failure mode in any browser/WebView —
    // this is a stronger fix than picking yet another Tailwind color
    // class (already tried border-primary, then border-muted-foreground,
    // then border-zinc-400 — all three are equally exposed to this bug
    // regardless of which color each one names).
    style={{
      ...style,
      border: checked ? '2px solid hsl(var(--primary))' : '2px solid #a1a1aa',
    }}
    className={cn(
      'peer grid h-4 w-4 shrink-0 place-content-center rounded-sm bg-transparent shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn('grid place-content-center text-current')}>
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
