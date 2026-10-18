import type { FlowGraph } from '@circuitry/shared';
import { gateConditionMeetings } from './condition-meetings';
import { removeDisabledPassThroughSteps } from './disabled-steps';
import { anchorParallelUntilBodies, anchorSharedLoopEntries } from './loop-entry-anchors';
import { writeOutLoopRounds } from './loop-rounds';
import { writeOutMeetingLines } from './meeting-lines';
import { normalizePathEndings } from './path-endings';

/**
 * The graph as every strategy and both verifiers read it: a disabled step
 * where a convention reads adjacency taken out (bug #75), loop entries
 * anchored (bug #28; an until body that opens with a parallel, #109),
 * a line to a step another line's path also leads to written out as the
 * meeting it is (#262), a do-while's yes side going round and on to steps
 * beside it written as a first round and a while (#265), tests meeting at one step made one OR (#111), path endings made
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
   * checks that it means the same. `lines` false for it as well: it reads
   * a meeting of drawn lines itself (#262). `stops` false for it: it reads
   * what a path that ends means itself (decision D1), not the `stop` steps
   * normalize adds for the writers. */
  {
    meetings = true,
    copies = true,
    lines = true,
    stops = true,
  }: { meetings?: boolean; copies?: boolean; lines?: boolean; stops?: boolean } = {}
): FlowGraph {
  // A do-while's yes side going round and on to steps beside it, written
  // as a first round and a while (#265, loop-rounds.ts): a rewrite into
  // a graph a tree writes, like D5's copies, so not for the graph walk.
  const anchored = copies
    ? writeOutLoopRounds(anchoredGraph(flow, lines))
    : anchoredGraph(flow, lines);
  return normalizePathEndings(meetings ? gateConditionMeetings(anchored) : anchored, {
    copies,
    stops,
  });
}

/** The first steps of normalizeGraph: disabled steps taken out, drawn
 * meetings written out (unless `lines` is false) and loop entries
 * anchored -- the graph as drawn, before path endings are made explicit
 * (what FlowTranspiler's #262 check reads). */
export function anchoredGraph(flow: FlowGraph, lines = true): FlowGraph {
  const enabled = removeDisabledPassThroughSteps(flow);
  return anchorSharedLoopEntries(
    anchorParallelUntilBodies(lines ? writeOutMeetingLines(enabled) : enabled)
  );
}
