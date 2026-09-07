import { type ReactElement, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/**
 * Hover tooltip for a truncated label — thin convenience wrapper around the
 * existing `Tooltip`/`TooltipTrigger`/`TooltipContent` primitives
 * (ui/tooltip.tsx), which already portal correctly into Circuitry's Shadow
 * DOM root (via usePortalContainer, see that file) and are already wrapped
 * in one app-wide `TooltipProvider` (app-mount.tsx) — so this needs no
 * provider of its own. Exists purely to save every truncated-label call
 * site (canvas node cards, the Miller-column picker dialogs, device/type
 * pickers, property-panel read-only fields) from repeating the same
 * three-component composition for what's always the same "show the full
 * text on hover, but only when it's actually cut off" need.
 *
 * Deliberately NOT the native `title` attribute: a user reported hovering
 * over a truncated device name in the trigger picker never showing
 * anything, even after confirming (via a grep of the compiled bundle) that
 * `title` really was present and correctly populated on the DOM node — the
 * native title-attribute tooltip is drawn by the *host browser chrome*, and
 * some embedded WebView-based Home Assistant clients never implement that
 * chrome-level behavior at all. This renders the tooltip itself, in-page,
 * so it works identically regardless of host chrome.
 *
 * Renders `children` bare (no tooltip wiring) when `content` is empty, so
 * callers don't need their own guard for optional/blank labels.
 *
 * Truncation is checked at hover time, not baked in from a prop: `open` is
 * controlled, and `onOpenChange` refuses to open the tooltip unless the
 * trigger element's `scrollWidth` actually exceeds its `clientWidth` (the
 * standard "is this text visually clipped" check). Without this check the
 * tooltip would render on every hover regardless of whether the label fit —
 * which is exactly the bug a user reported: hovering an untruncated
 * Miller-column row (e.g. "Living Room", no shorter than sibling rows like
 * "Master Bathroom" that never showed a tooltip) still popped a floating
 * tooltip box over the row. Checking live at hover time (rather than once
 * on mount) also means a column that's been resized wider/narrower via
 * ResizableColumn's drag handle is always re-evaluated correctly, with no
 * stale truncation state to invalidate.
 */
export function TruncatedTooltip({
  content,
  children,
  side = 'top',
}: {
  content: string | null | undefined;
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  if (!content) return children;

  const handleOpenChange = (next: boolean) => {
    if (next) {
      const el = triggerRef.current;
      if (!el || el.scrollWidth <= el.clientWidth) {
        // Not actually clipped — refuse to open. Leaving `open` at its
        // current value (false) rather than calling setOpen(false) avoids
        // an extra no-op render on every hover of an untruncated row.
        return;
      }
    }
    setOpen(next);
  };

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange}>
      <TooltipTrigger
        asChild
        // Callback ref, not the RefObject directly: TooltipTrigger's own ref
        // type is pinned to HTMLButtonElement (the element it renders
        // without asChild), which TS can't reconcile with `asChild`
        // rendering whatever element `children` actually is (a <span> at
        // every real call site here) — a plain callback sidesteps the
        // RefObject variance mismatch since HTMLButtonElement (and every
        // other element type Radix might type this as) is assignable to
        // the broader HTMLElement our truncation check only ever reads
        // scrollWidth/clientWidth from.
        ref={(node: HTMLElement | null) => {
          triggerRef.current = node;
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs break-words">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
