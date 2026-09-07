import { Panel } from '@xyflow/react';
import type { TFunction } from 'i18next';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppRoot } from '@/contexts/AppRootContext';
import { useNodeActionContext } from '@/hooks/useNodeActionContext';
import { cn } from '@/lib/utils';
import { isMacOS } from '@/utils/useAgentPlatform';
import type { NodeAction } from '../actions';
import {
  getAlignBottomAction,
  //  getAlignCenterAction,
  getAlignLeftAction,
  getAlignRightAction,
  getAlignTopAction,
  getCopyAction,
  getCutAction,
  getDeleteAction,
  getDisconnectAction,
  getDuplicateAction,
  getPasteAction,
  getRedoAction,
  //getRunAction,
  getSelectAllAction,
  getToggleEnabledAction,
  getUndoAction,
} from '../actions';

/**
 * Format a shortcut string for display
 */
function formatShortcut(shortcut: string, t: TFunction): string {
  const isMac = isMacOS();

  return shortcut
    .split('+')
    .map((part) => {
      if (part === 'ctrl') return isMac ? t('shortcuts.cmd') : t('shortcuts.ctrl');
      if (part === 'shift') return t('shortcuts.shift');
      if (part === 'alt') return t('shortcuts.alt');
      if (part === 'arrowup') return t('shortcuts.arrowUp');
      if (part === 'arrowdown') return t('shortcuts.arrowDown');
      if (part === 'arrowleft') return t('shortcuts.arrowLeft');
      if (part === 'arrowright') return t('shortcuts.arrowRight');
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('+');
}

// Define the order of groups to display
// New groups should be added here as needed!
const groupOrder: Array<
  'history' | 'node-specific' | 'selection' | 'clipboard' | 'edit' | 'align' | 'delete'
> = ['history', 'node-specific', 'selection', 'clipboard', 'edit', 'align', 'delete'];

export function NodeToolbar() {
  const { t } = useTranslation();
  // Same NodeActionContext CanvasContextMenu.tsx's right-click menu builds —
  // see useNodeActionContext.ts's doc comment.
  const context = useNodeActionContext();
  // See the dialog-open check inside handleKeyDown below for why this has to
  // be queried from here rather than `document`.
  const appRoot = useAppRoot();

  // The default actions available for all nodes
  // New actions should be added here as needed!
  const allActions = useMemo(
    () => [
      getUndoAction(t),
      getRedoAction(t),
      //getRunAction(t),
      getDuplicateAction(t),
      getCopyAction(t),
      getCutAction(t),
      getPasteAction(t),
      getAlignLeftAction(t),
      //  getAlignCenterAction(t),
      getAlignRightAction(t),
      getAlignTopAction(t),
      getAlignBottomAction(t),
      getDisconnectAction(t),
      getSelectAllAction(t),
      getToggleEnabledAction(t),
      getDeleteAction(t),
    ],
    [t]
  );

  // Determine if we have any actions to show
  const hasActions = allActions.length > 0;

  useEffect(() => {
    if (!hasActions) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Bail out first if *any* dialog is open at all, regardless of where
      // focus currently sits. Radix's Dialog renders `role="dialog"`
      // synchronously, but it moves focus into the dialog (and, for
      // AutomationSaveDialog, pre-selects the name input's text) via a
      // useEffect that runs a tick *after* that render — so a keypress
      // landing in that gap still has whatever the canvas last focused as
      // its event.target, not the dialog's input. The previous target-only
      // check (still below, for the common case) missed exactly that race:
      // opening Save with a canvas node selected and immediately hitting
      // Backspace/Delete to clear "Untitled Automation" could delete the
      // node instead of the text, reported directly by the user. Checking
      // for an open dialog up front — the canvas has no business reacting
      // to *any* shortcut while a dialog sits on top of it — closes the race
      // instead of chasing the timing.
      //
      // MUST query from `appRoot`, not `document`: in real HA panel mode
      // Circuitry's whole React tree — including every Radix Dialog's portal
      // (see dialog.tsx's usePortalContainer/AppRootContext) — renders
      // inside a Shadow DOM subtree, not document.body. Shadow DOM
      // encapsulation means `document.querySelector` can never see past
      // that boundary, so that version of this check was a silent no-op in
      // production the whole time — it only ever could have worked in a
      // plain (non-shadow-DOM) dev harness, which is why the bug was still
      // fully reproducible for the user after that first attempt.
      if (appRoot?.querySelector('[role="dialog"]')) {
        return;
      }

      // Skip if user is typing in an input field, or focus is anywhere
      // inside an open dialog (a Miller picker, Import YAML, ...) — these
      // shortcuts are scoped to the canvas, and with this listener now on
      // the capture phase (see below), it would otherwise see a plain
      // Ctrl+C meant to copy displayed text inside a dialog *before* the
      // dialog itself does, and hijack it into copying whatever canvas node
      // was selected before the dialog opened instead.
      //
      // MUST read `event.composedPath()[0]`, not `event.target`: this
      // listener sits on `window`, outside the Shadow DOM Circuitry's panel
      // mode renders its whole tree into (see the appRoot check above).
      // Per the DOM spec, a listener outside an event's shadow tree sees
      // `event.target` *retargeted* to the shadow host — in panel mode
      // that's the `<circuitry-panel>` custom element itself, never the actual
      // focused `<input>`/`<textarea>` inside it. `target.tagName` was
      // therefore never actually 'INPUT' in production, no matter what was
      // genuinely focused; this check has silently never worked in a real
      // Home Assistant install for *any* field, only in a plain (non-shadow-
      // DOM) dev harness. `composedPath()` is unaffected by retargeting —
      // its first entry is always the true originating element regardless
      // of shadow boundaries.
      const target = (event.composedPath()[0] ?? event.target) as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('[role="dialog"]')
      ) {
        return;
      }

      const isMac = isMacOS();
      const modifier = isMac ? event.metaKey : event.ctrlKey;

      // Build shortcut string from event
      let shortcut = '';
      if (modifier) shortcut += 'ctrl+';
      if (event.shiftKey) shortcut += 'shift+';
      if (event.altKey) shortcut += 'alt+';
      shortcut += event.key.toLowerCase();

      // Find matching action that is enabled
      const action = allActions.find((a) => {
        if (!a.shortcut) return false;
        const shortcuts = Array.isArray(a.shortcut) ? a.shortcut : [a.shortcut];
        if (!shortcuts.includes(shortcut)) return false;
        const isEnabled = a.isEnabled ? a.isEnabled(context) : true;
        return isEnabled;
      });

      if (action) {
        event.preventDefault();
        // Circuitry runs embedded inside Home Assistant's own panel chrome,
        // which has its own global keyboard handling (the quick-bar, entity
        // list shortcuts, ...) — stopping propagation here means a shortcut
        // Circuitry has already claimed and acted on can't *also* trigger
        // something in the host page once this bubbles past the canvas.
        event.stopPropagation();
        action.execute(context);
      }
    };

    // Capture phase, not bubble: makes this the *first* keydown handler to
    // see the event anywhere in this window, so nothing between the event's
    // target and window — an ancestor wrapper, a portaled dialog, anything
    // that calls stopPropagation() on its way up — can silently swallow a
    // shortcut before it ever reaches here. Bubble-phase (the previous
    // behavior) meant this listener only ever saw whatever survived every
    // other handler along that path.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [hasActions, allActions, context, appRoot]);

  // Group available actions by their group property
  const actionsByGroup = useMemo(() => {
    const groups: Record<string, NodeAction[]> = {};

    for (const action of allActions) {
      const group = action.group || 'node-specific';
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(action);
    }

    return groups;
  }, [allActions]);

  // Show toolbar only if there are actions available
  if (!hasActions) return null;

  // Get clipboard node count for display — falls back to edge count for a
  // bare copied connecting line (see clipboardHelpers.ts's pasteEdgesOnly),
  // which has no nodes of its own.
  let clipboardNodeCount = 0;
  try {
    if (context.clipboard) {
      const clipboardData = JSON.parse(context.clipboard);
      clipboardNodeCount = clipboardData.nodes?.length || clipboardData.edges?.length || 0;
    }
  } catch {
    // Ignore parse errors
  }

  const renderActionGroup = (actions: NodeAction[]) => {
    if (!actions || actions.length === 0) return null;

    return actions.map((action) => {
      const Icon = action.getIcon ? action.getIcon(context) : action.icon;
      const tooltip =
        typeof action.tooltip === 'function' ? action.tooltip(context) : action.tooltip;
      const isEnabled = action.isEnabled ? action.isEnabled(context) : true;
      const isPaste = action.name === 'paste';
      const label = action.shortcut
        ? `${tooltip} (${formatShortcut(Array.isArray(action.shortcut) ? action.shortcut[0] : action.shortcut, t)})`
        : tooltip;

      return (
        <Tooltip key={action.name}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={!isEnabled}
              className={cn(
                'relative h-8 w-8 shrink-0',
                'sm:h-9 sm:w-9',
                action.variant === 'destructive' &&
                  'text-destructive hover:bg-destructive/10 hover:text-destructive'
              )}
              onClick={() => action.execute(context)}
            >
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {isPaste && clipboardNodeCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary font-bold text-[9px] text-primary-foreground">
                  {clipboardNodeCount}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      );
    });
  };

  return (
    <Panel
      position="top-center"
      className="m-0! p-0! max-w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-4rem)]"
    >
      <div
        className={cn(
          'flex items-center gap-0.5 rounded-lg border bg-background/95 px-1.5 py-1 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/60 sm:gap-1 sm:px-2 sm:py-1.5',
          'fade-in slide-in-from-top-2 animate-in duration-200',
          'scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent overflow-x-auto',
          'max-w-full'
        )}
      >
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {groupOrder.map((groupName, index) => {
            const groupActions = actionsByGroup[groupName];
            if (!groupActions || groupActions.length === 0) return null;

            return (
              <div key={groupName} className="flex items-center gap-0.5 sm:gap-1">
                {renderActionGroup(groupActions)}
                {index < groupOrder.length - 1 &&
                  actionsByGroup[groupOrder[index + 1]]?.length > 0 && (
                    <Separator orientation="vertical" className="mx-0.5 h-6 sm:mx-1" />
                  )}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
