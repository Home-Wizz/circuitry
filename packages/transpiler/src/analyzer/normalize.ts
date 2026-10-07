import type { FlowGraph } from '@circuitry/shared';
import { gateConditionMeetings } from './condition-meetings';
import { removeDisabledPassThroughSteps } from './disabled-steps';
import { anchorParallelUntilBodies, anchorSharedLoopEntries } from './loop-entry-anchors';
import { normalizePathEndings } from './path-endings';

/**
 * The graph as every strategy and both verifiers read it: a disabled step
 * where a convention reads adjacency taken out (bug #75), loop entries
 * anchored (bug #28; an until body that opens with a parallel, #109),
 * tests meeting at one step made one OR (#111), path endings made
 * explicit (decision D1) and, where a path ends inside a parallel branch,
 * the steps after its meeting point copied (decision D5). Runs in
 * FlowTranspiler before strategy selection, and again inside the verifiers
 * so a caller that verifies against the canvas graph directly gets the same
 * reading. Idempotent: a normalized graph comes back unchanged.
 */
export function normalizeGraph(
  flow: FlowGraph,
  /** False for the graph walk (simulation/graph-walk.ts), which reads
   * where paths meet itself, condition by condition: one test that can't
   * be evaluated takes its own "no" edge there, which an OR of the tests
   * can't say (#128). `copies` false for it too: copying a tail (decision
   * D5) rewrites the graph into one a tree writes, and the walk is what
   * checks that it means the same. */
  { meetings = true, copies = true }: { meetings?: boolean; copies?: boolean } = {}
): FlowGraph {
  const anchored = anchorSharedLoopEntries(
    anchorParallelUntilBodies(removeDisabledPassThroughSteps(flow))
  );
  return normalizePathEndings(meetings ? gateConditionMeetings(anchored) : anchored, { copies });
}
