import type { Edge } from '@xyflow/react';

export interface LoopStructure {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

const MAX_DEPTH = 200;
const MAX_PATHS = 500;

/**
 * Given a `loop-back` edge (the dashed line that closes a Repeat While/Until
 * block's body back into its condition — see block-factories.ts's
 * createRepeatWhileBlock/createRepeatUntilBlock), finds every node and edge
 * that makes up that specific loop instance: every node on some forward path
 * from the loop-back edge's target to its source (the cycle it closes),
 * plus every edge directly between two such nodes (including the loop-back
 * edge itself).
 *
 * There's no explicit "this node belongs to loop X" grouping field in this
 * app's data model — nodes/edges are flat (see block-factories.ts), and only
 * the condition node carries `_blockKey`, not the body nodes — so loop
 * membership is purely topological rather than a lookup. A node reachable
 * from the loop-back edge's target that *doesn't* lead back to its source
 * (e.g. whatever the condition's exit branch continues on to, after the
 * loop) is correctly excluded, since that branch never closes the cycle.
 *
 * Used for the right-click context menu's Delete/Copy/Cut on a loop-back
 * line — per the user's explicit request, those operate on "the entire loop
 * structure, not just the line or the nodes themselves."
 */
export function getLoopStructure(loopBackEdge: Edge, edges: Edge[]): LoopStructure {
  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (edge.id === loopBackEdge.id) continue;
    const list = outgoing.get(edge.source);
    if (list) list.push(edge);
    else outgoing.set(edge.source, [edge]);
  }

  const nodeIds = new Set<string>();
  let pathCount = 0;

  // Enumerates every forward path from `current` that eventually reaches the
  // loop-back edge's source, unioning every node visited along a successful
  // path into `nodeIds`. Small, mostly-linear loop bodies in practice — the
  // depth/path caps are just a safety net against malformed/cyclic data.
  function visit(current: string, pathSoFar: string[]): boolean {
    if (pathCount > MAX_PATHS || pathSoFar.length > MAX_DEPTH) return false;
    if (current === loopBackEdge.source) {
      for (const id of pathSoFar) nodeIds.add(id);
      nodeIds.add(current);
      pathCount++;
      return true;
    }
    if (pathSoFar.includes(current)) return false; // cycle guard

    let closedLoop = false;
    const nextPath = [...pathSoFar, current];
    for (const edge of outgoing.get(current) ?? []) {
      if (visit(edge.target, nextPath)) closedLoop = true;
    }
    return closedLoop;
  }

  const closed = visit(loopBackEdge.target, []);
  if (!closed) {
    // Fall back to just the loop-back edge's own two endpoints rather than
    // silently deleting nothing, in case the body's been edited into a
    // state where no path actually closes the loop.
    nodeIds.add(loopBackEdge.source);
    nodeIds.add(loopBackEdge.target);
  }

  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      edgeIds.add(edge.id);
    }
  }
  edgeIds.add(loopBackEdge.id);

  return { nodeIds, edgeIds };
}
