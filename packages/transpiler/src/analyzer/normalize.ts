import type { FlowGraph } from '@circuitry/shared';
import { anchorSharedLoopEntries } from './loop-entry-anchors';
import { normalizePathEndings } from './path-endings';

/**
 * The graph as every strategy and both verifiers read it: loop entries
 * anchored (bug #28) and path endings made explicit (decision D1). Runs in
 * FlowTranspiler before strategy selection, and again inside the verifiers
 * so a caller that verifies against the canvas graph directly gets the same
 * reading. Idempotent: a normalized graph comes back unchanged.
 */
export function normalizeGraph(flow: FlowGraph): FlowGraph {
  return normalizePathEndings(anchorSharedLoopEntries(flow));
}
