import type { FlowGraph } from '@circuitry/shared';
import type { PathEnd } from '../verification/extractFromGraph';
import { listHeads } from './list-members';
import { normalizeGraph } from './normalize';
import { pathEndStopId } from './path-endings';

/**
 * Meaning the canvas carries only by
 * shape, for the editor to show on the nodes. Read from the graph every
 * strategy compiles -- normalizeGraph's -- so a marker says what the saved
 * automation does rather than a second guess at it.
 */
export interface ConventionMarkers {
  /** Conditions chained into the list of the condition before them
   * (the list convention): member id -> the id of the list's first condition. */
  listMembers: Record<string, string>;
  /** Where a path that just ends stops the automation although something
   * would otherwise have run after it (decision D1): where normalizeGraph
   * adds a `stop`. */
  pathEnds: PathEnd[];
}

export function conventionMarkers(flow: FlowGraph): ConventionMarkers {
  const drawn = new Set(flow.nodes.map((n) => n.id));
  const normalized = normalizeGraph(flow);
  const listMembers: Record<string, string> = {};
  for (const [member, head] of listHeads(normalized)) {
    // Only what is on the canvas: normalizeGraph's own nodes (a #111 gate,
    // a loop anchor) have nowhere to be shown.
    if (drawn.has(member) && drawn.has(head)) listMembers[member] = head;
  }
  const pathEnds: PathEnd[] = [];
  for (const e of normalized.edges) {
    if (drawn.has(e.target) || !drawn.has(e.source)) continue;
    const handle =
      e.sourceHandle === 'true' || e.sourceHandle === 'false' ? e.sourceHandle : undefined;
    if (e.target !== pathEndStopId(e.source, handle)) continue;
    pathEnds.push(handle ? { nodeId: e.source, handle } : { nodeId: e.source });
  }
  return { listMembers, pathEnds };
}
