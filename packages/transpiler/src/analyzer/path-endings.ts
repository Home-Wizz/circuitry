import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { findTreeContinuedPathEnds, graphConvergenceSet } from '../verification/extractFromGraph';
import { findBackEdges } from './topology';

/**
 * Decision D1 (2026-09-26): what a path that just ends means. The canvas
 * lets a path stop without an edge -- a condition with no false edge, an
 * action with nothing after it -- and the strategies used to disagree about
 * it whenever something else runs "after" that point: NativeStrategy (and
 * its verifier) read the graph as a tree and carried on at the step where
 * the enclosing branches meet again, or with the enclosing loop's next
 * round; StateMachineStrategy followed the flowchart literally and ended
 * the automation. The same graph behaved differently depending on which
 * strategy compiled it.
 *
 * The rule now, applied to the graph before any strategy runs, so every
 * strategy and both verifiers see the same explicit graph:
 *
 * 1. A Choose block with no default (its last case -- `_blockKey:
 *    'choose'`, `_chooseCase` equal to `_chooseCaseTotal`, 2 or more cases
 *    -- has no false edge) falls through when no case matches: it goes on to
 *    where its cases meet again -- the step after the Choose, or, inside a
 *    loop, the loop's next round. That's what a Choose block means, and it
 *    is what YamlParser already builds for `choose:` without `default:`.
 * 2. Any other path that ends stops the automation, as drawn. Where the
 *    tree reading would have carried on, the end becomes an explicit
 *    `stop` step. Inside a parallel branch a path that ends only ends its
 *    branch (every strategy renders branches the same way), so nothing is
 *    added there.
 *
 * Returns the input unchanged (same object) when there is nothing to do.
 */
export function normalizePathEndings(flow: FlowGraph): FlowGraph {
  const withChoose = addChooseFallThrough(flow);
  const ends = findTreeContinuedPathEnds(withChoose);
  if (ends.length === 0) return withChoose;
  const byId = new Map(withChoose.nodes.map((n) => [n.id, n]));
  const nodes: FlowNode[] = [...withChoose.nodes];
  const edges: FlowEdge[] = [...withChoose.edges];
  for (const end of ends) {
    const from = byId.get(end.nodeId);
    if (!from) continue;
    const stopId = `${end.nodeId}__path_end${end.handle === 'true' ? '_true' : ''}`;
    if (byId.has(stopId)) continue;
    const stopNode = {
      id: stopId,
      type: 'action',
      position: { x: from.position.x + 320, y: from.position.y + 80 },
      data: { stop: 'This path ends here' },
    } as FlowNode;
    nodes.push(stopNode);
    byId.set(stopId, stopNode);
    edges.push({
      id: `${end.nodeId}__to_path_end${end.handle === 'true' ? '_true' : ''}`,
      source: end.nodeId,
      target: stopId,
      ...(end.handle ? { sourceHandle: end.handle } : {}),
    } as FlowEdge);
  }
  return { ...withChoose, nodes, edges };
}

const blockKey = (node: FlowNode | undefined): unknown =>
  (node?.data as Record<string, unknown> | undefined)?._blockKey;

/** Rule 1: see normalizePathEndings. */
function addChooseFallThrough(flow: FlowGraph): FlowGraph {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const backEdgeIds = findBackEdges(flow);
  const out = (id: string, handle?: string): FlowEdge[] =>
    flow.edges.filter(
      (e) =>
        e.source === id &&
        (handle === undefined || e.sourceHandle === handle) &&
        e.type !== 'hint' &&
        e.type !== 'choose-hint'
    );
  const added: FlowEdge[] = [];
  const caseNumber = (node: FlowNode | undefined): number | undefined => {
    const n = (node?.data as Record<string, unknown> | undefined)?._chooseCase;
    return typeof n === 'number' ? n : undefined;
  };
  for (const last of flow.nodes) {
    if (last.type !== 'condition' || blockKey(last) !== 'choose') continue;
    if (out(last.id, 'false').length > 0) continue;
    const total = (last.data as Record<string, unknown>)._chooseCaseTotal;
    if (typeof total !== 'number' || total < 2 || caseNumber(last) !== total) continue;
    // The chain of cases, first to last: case k's one false edge leads to
    // case k+1 (the case numbers keep two Choose blocks in a row apart --
    // a single-case Choose's false edge leads to the next one).
    const cases = [last.id];
    while (cases.length < total) {
      const want = total - cases.length;
      const prev = flow.edges.filter(
        (e) =>
          e.target === cases[0] &&
          e.sourceHandle === 'false' &&
          blockKey(byId.get(e.source)) === 'choose' &&
          caseNumber(byId.get(e.source)) === want &&
          out(e.source, 'false').length === 1
      );
      if (prev.length !== 1 || cases.includes(prev[0].source)) break;
      cases.unshift(prev[0].source);
    }
    if (cases.length !== total) continue;
    const caseStarts = cases.map((id) =>
      out(id, 'true')
        .filter((e) => !backEdgeIds.has(e.id))
        .map((e) => e.target)
    );
    if (caseStarts.some((s) => s.length === 0)) continue;
    // Each case's starts are one group (bug #50): a case that opens with a
    // parallel reaches the meeting point if any of its branches does.
    let targets = graphConvergenceSet(flow, caseStarts).filter((id) => !cases.includes(id));
    if (targets.length === 0) {
      // Inside a loop, every case may just loop back: fall through to the
      // same place (the loop's next round).
      const loopBackTargets = caseStarts.map((starts) => {
        const seen = new Set<string>();
        const hits = new Set<string>();
        const queue = [...starts];
        while (queue.length > 0) {
          const id = queue.shift()!;
          if (seen.has(id)) continue;
          seen.add(id);
          for (const e of out(id)) {
            if (backEdgeIds.has(e.id)) hits.add(e.target);
            else queue.push(e.target);
          }
        }
        return hits;
      });
      const common = [...loopBackTargets[0]].filter((t) => loopBackTargets.every((s) => s.has(t)));
      if (common.length === 1) targets = common;
    }
    targets.forEach((target, i) => {
      added.push({
        id: `${last.id}__falls_through_${i}`,
        source: last.id,
        target,
        sourceHandle: 'false',
      } as FlowEdge);
    });
  }
  return added.length > 0 ? { ...flow, edges: [...flow.edges, ...added] } : flow;
}
