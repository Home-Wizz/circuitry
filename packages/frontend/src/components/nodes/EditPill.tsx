import { ChevronDown } from 'lucide-react';
import { type ReactNode, type RefObject, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NODE_COLORS, type NodeColorToken } from '@/lib/node-colors';
import { cn } from '@/lib/utils';

/** A pill's text: a long name wraps onto the next line rather than being
 * cut off. Every pill's text uses it. */
export const PILL_TEXT = 'min-w-0 break-words';

/** A pill editor holding a duration with milliseconds (a delay, a wait's
 * timeout): HA's duration picker is wider than the usual editor with its
 * four fields and ran past the edge. */
export const DURATION_POPOVER = 'w-96';

interface EditPillProps {
  /** Tinted in the step's colour. */
  tone: NodeColorToken;
  ariaLabel: string;
  testId: string;
  /** Nothing chosen yet: a dashed outline. */
  empty?: boolean;
  /** What the pill shows. */
  children: ReactNode;
  /** The editor it opens, drawn only while open. */
  editor: () => ReactNode;
  contentClassName?: string;
  /** Which side of the pill it opens on; it flips when there's no room. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Opens beside the whole card rather than the pill (not over the card's
   * own sentence). */
  besideCard?: boolean;
}

/**
 * A value in a card's sentence, as a pill: a click opens a small editor
 * beside it. The clicks and keys inside stay out of the canvas (no drag,
 * no double-click edit, no shortcuts). Every pill on the cards is one.
 */
export function EditPill({
  tone,
  ariaLabel,
  testId,
  empty,
  children,
  editor,
  contentClassName,
  side,
  besideCard = false,
}: EditPillProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The card the pill is on, measured when it opens.
  const cardRef = useRef<Element | null>(null);
  cardRef.current = buttonRef.current?.closest('[data-testid="step-card"]') ?? null;
  const colors = NODE_COLORS[tone];
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {besideCard && cardRef.current && (
        <PopoverAnchor virtualRef={cardRef as RefObject<Element>} />
      )}
      <PopoverTrigger asChild>
        <button
          ref={buttonRef}
          type="button"
          data-testid={testId}
          aria-label={ariaLabel}
          className={cn(
            'nodrag inline-flex min-w-0 max-w-full items-center gap-1 rounded-xl border px-2 py-0.5 text-left align-baseline font-semibold leading-tight hover:brightness-110',
            'focus-visible:outline-2 focus-visible:outline-primary',
            colors.text,
            empty
              ? 'border-current border-dashed opacity-80'
              : cn(colors.chip, 'border-transparent')
          )}
          onClick={stop}
          onDoubleClick={stop}
        >
          {children}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={contentClassName ?? 'w-72'}
        side={side}
        collisionPadding={12}
        align="start"
        onClick={stop}
        onDoubleClick={stop}
        onKeyDown={stop}
      >
        {open && editor()}
      </PopoverContent>
    </Popover>
  );
}
