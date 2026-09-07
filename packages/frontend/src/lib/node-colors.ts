import type { CSSProperties } from 'react';

export type NodeColorToken =
  | 'trigger'
  | 'condition'
  | 'action'
  | 'delay'
  | 'wait'
  | 'variables'
  | 'start'
  | 'join';

/**
 * Selection indicator for every node card, applied as an inline style rather
 * than Tailwind ring-* classes. Three rounds of ring-class attempts (a
 * same-hue ring blending into the card border; then a dedicated ring-ring
 * color; then reordering so it wins cn()/tailwind-merge's conflict
 * resolution against hasErrors/isActive/trace's own ring-* classes) were all
 * reported as still invisible — since a same-node-type card with none of
 * those other states active *also* showed nothing, the class-conflict theory
 * doesn't actually explain it, which points at something in Tailwind's own
 * utility generation/purge for these custom-color-token ring classes rather
 * than a fixable ordering issue. An inline style can't be dropped by
 * content-scanning/purging and always wins the cascade short of `!important`
 * elsewhere, which sidesteps that class entirely instead of guessing at it
 * again. `hsl(var(--ring))` reuses the same dedicated shadcn/ui
 * selection/focus color token every other focus ring in the app already
 * uses (components/ui/*.tsx's `ring-ring`).
 */
export const SELECTED_NODE_STYLE: CSSProperties = {
  outline: '2px solid hsl(var(--ring))',
  outlineOffset: '2px',
};

interface NodeColorClasses {
  /** Card border */
  border: string;
  /** Card background tint */
  bg: string;
  /** Selection ring */
  ring: string;
  /** Icon/title/body accent text */
  text: string;
  /** Icon chip background */
  chip: string;
  /** React Flow connector handle */
  handle: string;
  /** Step-number / count badge */
  badge: string;
  /** NodePalette drag button */
  palette: string;
}

/**
 * Single source of truth for per-node-type styling, shared by the canvas
 * node components (components/nodes/*.tsx) and NodePalette.tsx. Colors
 * themselves live as CSS custom properties (index.css / lib/ha-theme.ts) so
 * they follow HA's active theme — this only maps a node type to Tailwind
 * class names built on top of those tokens.
 *
 * Class names are spelled out in full (not template-built) so Tailwind's
 * static content scanner can find and generate them — dynamically
 * constructed strings like `border-${token}` are invisible to Tailwind's JIT.
 */
export const NODE_COLORS: Record<NodeColorToken, NodeColorClasses> = {
  trigger: {
    border: 'border-trigger',
    bg: 'bg-trigger-subtle',
    ring: 'ring-trigger',
    text: 'text-trigger',
    chip: 'bg-trigger-subtle',
    handle: 'bg-trigger! border-trigger!',
    badge: 'bg-trigger text-trigger-foreground',
    palette: 'bg-trigger border-trigger text-trigger-foreground hover:bg-trigger/90',
  },
  condition: {
    border: 'border-condition',
    bg: 'bg-condition-subtle',
    ring: 'ring-condition',
    text: 'text-condition',
    chip: 'bg-condition-subtle',
    handle: 'bg-condition! border-condition!',
    badge: 'bg-condition text-condition-foreground',
    palette: 'bg-condition border-condition text-condition-foreground hover:bg-condition/90',
  },
  action: {
    border: 'border-action',
    bg: 'bg-action-subtle',
    ring: 'ring-action',
    text: 'text-action',
    chip: 'bg-action-subtle',
    handle: 'bg-action! border-action!',
    badge: 'bg-action text-action-foreground',
    palette: 'bg-action border-action text-action-foreground hover:bg-action/90',
  },
  delay: {
    border: 'border-delay',
    bg: 'bg-delay-subtle',
    ring: 'ring-delay',
    text: 'text-delay',
    chip: 'bg-delay-subtle',
    handle: 'bg-delay! border-delay!',
    badge: 'bg-delay text-delay-foreground',
    palette: 'bg-delay border-delay text-delay-foreground hover:bg-delay/90',
  },
  wait: {
    border: 'border-wait',
    bg: 'bg-wait-subtle',
    ring: 'ring-wait',
    text: 'text-wait',
    chip: 'bg-wait-subtle',
    handle: 'bg-wait! border-wait!',
    badge: 'bg-wait text-wait-foreground',
    palette: 'bg-wait border-wait text-wait-foreground hover:bg-wait/90',
  },
  variables: {
    border: 'border-variables',
    bg: 'bg-variables-subtle',
    ring: 'ring-variables',
    text: 'text-variables',
    chip: 'bg-variables-subtle',
    handle: 'bg-variables! border-variables!',
    badge: 'bg-variables text-variables-foreground',
    palette: 'bg-variables border-variables text-variables-foreground hover:bg-variables/90',
  },
  start: {
    border: 'border-start',
    bg: 'bg-start-subtle',
    ring: 'ring-start',
    text: 'text-start',
    chip: 'bg-start-subtle',
    handle: 'bg-start! border-start!',
    badge: 'bg-start text-start-foreground',
    palette: 'bg-start border-start text-start-foreground hover:bg-start/90',
  },
  join: {
    border: 'border-join',
    bg: 'bg-join-subtle',
    ring: 'ring-join',
    text: 'text-join',
    chip: 'bg-join-subtle',
    handle: 'bg-join! border-join!',
    badge: 'bg-join text-join-foreground',
    palette: 'bg-join border-join text-join-foreground hover:bg-join/90',
  },
};

/** Shared node-state styling, independent of node type. */
export const NODE_STATE_CLASSES = {
  error: 'border-destructive ring-2 ring-destructive/40',
  errorBadge: 'bg-destructive text-destructive-foreground',
  disabledBadge: 'bg-muted-foreground text-background',
  active: 'node-active ring-4 ring-success',
  /** Trace overlay (Phase E) — real HA run, distinct from validation `error`/live `active`. */
  traceExecuted: 'ring-2 ring-emerald-500/60',
  traceError: 'border-destructive ring-2 ring-destructive/70',
  traceSkipped: 'opacity-40 grayscale',
} as const;

export type TraceNodeState = 'executed' | 'error' | 'skipped' | null;

/** Maps a node's `useTraceNodeState` result to the class from `NODE_STATE_CLASSES` above, if any. */
export function getTraceStateClass(state: TraceNodeState): string | undefined {
  switch (state) {
    case 'executed':
      return NODE_STATE_CLASSES.traceExecuted;
    case 'error':
      return NODE_STATE_CLASSES.traceError;
    case 'skipped':
      return NODE_STATE_CLASSES.traceSkipped;
    default:
      return undefined;
  }
}
