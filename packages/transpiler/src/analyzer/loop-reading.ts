import type { FlowGraph } from '@circuitry/shared';
import { findBackEdges } from './topology';

/**
 * Bug #278: a test that goes back round its loop from its "yes" side with
 * no "no" line of its own, straight after the condition before it -- one
 * of that condition's list (`and`), so its "no" is that condition's. Read
 * as the loop's test, its "no" leaves the loop; as one of the list, it goes
 * where the list's "no" goes. The state machine writes it as drawn; inside
 * a set of steps that run side by side it is written as Home Assistant YAML,
 * where native read it the first way and the gate the second (and counted
 * the test twice), so the gate refused it with its own words for a bug.
 * Only asked once the gate has refused. Returns the test and the condition
 * whose list it is in, or null.
 */
export function loopTestSharingItsListNo(flow: FlowGraph): { test: string; head: string } | null {
  const lines = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
  const backEdges = findBackEdges(flow);
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  for (const e of lines) {
    if (e.sourceHandle !== 'true' || !backEdges.has(e.id)) continue;
    const test = nodes.get(e.source);
    if (test?.type !== 'condition') continue;
    if (lines.some((o) => o.source === test.id && o.sourceHandle === 'false')) continue;
    const waysIn = lines.filter((o) => o.target === test.id && !backEdges.has(o.id));
    if (waysIn.length !== 1 || waysIn[0].sourceHandle !== 'true') continue;
    if (nodes.get(waysIn[0].source)?.type !== 'condition') continue;
    return { test: test.id, head: waysIn[0].source };
  }
  return null;
}
