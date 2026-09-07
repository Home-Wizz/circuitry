import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { usePortalContainer } from '@/contexts/AppRootContext';
import { cn } from '@/lib/utils';

// `modal` defaults to false: Radix's default `modal=true` wraps children in
// react-remove-scroll to lock body scroll, which attaches its wheel listener
// to the outer `document`. Circuitry's panel renders inside a Shadow DOM
// (panel-wrapper.ts), and Shadow DOM event retargeting means that listener
// never sees the same `event.target` its internal capture-phase handler
// recorded, so it falls back to blocking every wheel event inside the
// dialog — nothing scrolls. The Overlay still covers/dims the background and
// blocks pointer interaction with it either way.
const Dialog = ({
  modal = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) => (
  <DialogPrimitive.Root modal={modal} {...props} />
);

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-40 bg-black/80 data-[state=closed]:animate-out data-[state=open]:animate-in',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    container?: HTMLElement | null;
  }
>(({ className, children, container, ...props }, ref) => {
  const { t } = useTranslation(['common']);
  const portalContainer = usePortalContainer();
  return (
    <DialogPortal container={container ?? portalContainer}>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // sm:rounded-dialog matches ha-dialog's own corner radius (--ha-border-radius-3xl).
          // overflow-x-hidden: belt-and-suspenders alongside Alert's own min-w-0/
          // break-words fix (see alert.tsx) — a long unbroken run of text in any
          // future child should clip/wrap within this rounded card instead of
          // ever being able to visually spill outside it again.
          //
          // No slide-in-from-left/top on open (nor slide-out on close) —
          // deliberately dropped. The base positioning is `left-[50%]
          // translate-x-[-50%]` (and the top/y equivalent); the slide
          // classes animate an *additional* translate on top of that,
          // easing in from further off to the left/top toward the centered
          // resting position. In the user's embedded WebView client (the Mac
          // app — the same client already responsible for the native-
          // tooltip and native-time-picker bugs fixed earlier), this
          // dialog was reported rendering as if frozen partway through that
          // entrance transform: the title/icon cut off past the left edge
          // of the screen while the fully-in-view bottom-right buttons and
          // right-hand canvas content looked normal — exactly what a stuck
          // mid-animation frame looks like, not a text-wrapping overflow
          // (already independently fixed and verified deployed above).
          // Fade + zoom alone still gives a clear open/close transition
          // without a transform-in-transit state for this WebView to get
          // stuck on.
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-x-hidden border bg-background p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in sm:rounded-dialog',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">{t('buttons.close')}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-semibold text-lg leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
