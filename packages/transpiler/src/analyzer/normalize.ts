import type { FlowGraph } from '@circuitry/shared';
import { gateConditionMeetings } from './condition-meetings';
import { removeDisabledPassThroughSteps } from './disabled-steps';
import { anchorParallelUntilBodies, anchorSharedLoopEntries } from './loop-entry-anchors';
import { normalizePathEndings } from './path-endings';

/**
 * The graph as every strategy and both verifiers read it: a disabled step
 * where a convention reads adjacency taken out (bug #75), loop entries
 * anchored (bug #28; an until body that opens with a parallel, #109),
 * tests meeting at one step made one OR (#111) and path endings made
 * explicit (decision D1). Runs in
 * FlowTranspiler before strategy selection, and again inside the verifiers
 * so a caller that verifies against the canvas graph directly gets the same
 * reading. Idempotent: a normalized graph comes back unchanged.
 */
export function normalizeGraph(flow: FlowGraph): FlowGraph {
  return normalizePathEndings(
    gateConditionMeetings(
      anchorSharedLoopEntries(anchorParallelUntilBodies(removeDisabledPassThroughSteps(flow)))
    )
  );
}
