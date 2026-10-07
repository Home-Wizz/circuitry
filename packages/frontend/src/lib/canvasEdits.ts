import type { Edge, Node } from '@xyflow/react';
import type { PickerKind } from '@/components/canvas/PickerColumns';

/**
 * The canvas's Replace and "Select its whole flow" edits, as pure functions
 * the store and the context menu share.
 */

/** The picker that replaces a step of this node type; null when it can't be
 * replaced (a Start, a join, a sequence's start or end). */
export function replacePicker(type: string | undefined): PickerKind | null {
  switch (type) {
    case 'trigger':
      return 'when';
    case 'condition':
      return 'and';
    case 'action':
    case 'delay':
    case 'wait':
    case 'set_variables':
      return 'then';
    default:
      return null;
  }
}

/** A stop step: an action that ends the run and has no outlet. */
export const isStopData = (data: Readonly<Record<string, unknown>>): boolean =>
  typeof data.stop === 'string';

type Outlets = 'branches' | 'none' | 'one';

/** The outlets a step has: a condition's Yes and No, none for a stop,
 * one for every other step. */
function outlets(type: string | undefined, data: Readonly<Record<string, unknown>>): Outlets {
  if (type === 'condition') return 'branches';
  return isStopData(data) ? 'none' : 'one';
}

/**
 * Whether the replacing step has an outlet for every link that leaves the
 * step today. A step with the same outlets always does (its links stay as
 * they are); otherwise each link must leave from an outlet the new step
 * has. A replacement that doesn't fit would leave links hanging from
 * outlets the new step doesn't have, so it is refused rather than made.
 */
export function replaceFits(
  old: { type: string | undefined; data: Readonly<Record<string, unknown>> },
  next: { type: string; data: Readonly<Record<string, unknown>> },
  outgoing: readonly Pick<Edge, 'sourceHandle'>[]
): boolean {
  const kind = outlets(next.type, next.data);
  if (kind === outlets(old.type, old.data)) return true;
  if (kind === 'none') return outgoing.length === 0;
  if (kind === 'branches') {
    return outgoing.every((e) => e.sourceHandle === 'true' || e.sourceHandle === 'false');
  }
  return outgoing.every((e) => e.sourceHandle === null || e.sourceHandle === undefined);
}

/** Markers that describe what the old step was, not where it sits: an
 * unknown step kept as written, a block condition's own alias, and an
 * unfilled placeholder. */
const CONTENT_MARKERS: ReadonlySet<string> = new Set([
  '_opaque',
  '_conditionAlias',
  '_placeholder',
]);

/**
 * The replacing step's data: the pick, plus what belongs to the step's
 * place rather than to what it did:
 * - its structural markers (which block, branch or case it is in);
 * - `enabled`;
 * - a trigger's `id` (the "Triggered by" conditions name it) and its
 *   `variables`, when a trigger replaces a trigger;
 * - `continue_on_error`, between action steps;
 * - the alias of a block's step, which is the block's own name (a block's
 *   first condition holds it). Any other alias named the old step, so it
 *   goes.
 */
export function replacedData(
  oldType: string | undefined,
  oldData: Readonly<Record<string, unknown>>,
  newType: string,
  pick: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(oldData)) {
    if (key.startsWith('_') && !CONTENT_MARKERS.has(key)) kept[key] = value;
  }
  const keep = (key: string) => {
    if (oldData[key] !== undefined) kept[key] = oldData[key];
  };
  keep('enabled');
  if (oldType === 'trigger' && newType === 'trigger') {
    keep('id');
    keep('variables');
  }
  if (replacePicker(oldType) === 'then' && replacePicker(newType) === 'then') {
    keep('continue_on_error');
  }
  if (typeof oldData._blockKey === 'string') keep('alias');
  // A placeholder is filled by its pick: the marker goes with the rest.
  return { ...pick, ...kept };
}

/** Every step linked to `nodeId`, through links in either direction: the
 * flow it belongs to. */
export function connectedFlow(
  nodeId: string,
  edges: readonly Pick<Edge, 'source' | 'target'>[]
): Set<string> {
  const neighbours = new Map<string, string[]>();
  const link = (a: string, b: string) => neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
  for (const e of edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const seen = new Set([nodeId]);
  const queue = [nodeId];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const other of neighbours.get(next) ?? []) {
      if (!seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen;
}

/** A node's size before React Flow has measured it. */
const DEFAULT_SIZE = { width: 240, height: 80 };

/** The nodes a box (flow coordinates, any corner order) touches. */
export function nodesInBox(
  nodes: readonly Node[],
  a: { x: number; y: number },
  b: { x: number; y: number }
): string[] {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  return nodes
    .filter((n) => {
      if (n.hidden) return false;
      const width = n.measured?.width ?? n.width ?? DEFAULT_SIZE.width;
      const height = n.measured?.height ?? n.height ?? DEFAULT_SIZE.height;
      const x = n.position.x;
      const y = n.position.y;
      return x < right && x + width > left && y < bottom && y + height > top;
    })
    .map((n) => n.id);
}
