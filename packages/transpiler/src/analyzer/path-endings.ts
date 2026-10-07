import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import {
  findTreeContinuedPathEnds,
  graphConvergenceSet,
  type PathEnd,
  scanPathEnds,
  type TailCopy,
} from '../verification/extractFromGraph';
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
export function normalizePathEndings(
  flow: FlowGraph,
  /** False for the graph walk: copying a tail (D5) only rewrites the graph
   * into one a tree writes, and the walk is what checks it means the same. */
  { copies = true }: { copies?: boolean } = {}
): FlowGraph {
  const withChoose = copies ? copyTails(addChooseFallThrough(flow)) : addChooseFallThrough(flow);
  const ends = findTreeContinuedPathEnds(withChoose);
  if (ends.length === 0) return withChoose;
  const byId = new Map(withChoose.nodes.map((n) => [n.id, n]));
  const nodes: FlowNode[] = [...withChoose.nodes];
  const edges: FlowEdge[] = [...withChoose.edges];
  for (const end of ends) {
    const from = byId.get(end.nodeId);
    if (!from) continue;
    const stopId = pathEndStopId(end.nodeId, end.handle);
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

/** The id of the `stop` step rule 2 adds where a path ends, at `nodeId`'s
 * `handle` (a condition's side; none for a step). */
export function pathEndStopId(nodeId: string, handle?: string): string {
  return `${nodeId}__path_end${handle === 'true' ? '_true' : ''}`;
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

/** Decision D5: the most steps copied into one graph; past it, it's refused. */
const MAX_COPIED_STEPS = 40;

/**
 * Decision D5 (2026-10-06): a path that ends inside a parallel branch,
 * before that branch's steps meet again, while something runs after the
 * parallel. A `stop` there would end what runs after the parallel too
 * (HA has no way to end one branch), so the steps after the meeting point
 * are copied into the if's else side, up to where its branches would have
 * gone on anyway: each side then has its own, and the ending path nothing
 * after it -- what a person writing the YAML would do. One if at a time,
 * then the graph is read again (an outer if may need the same).
 */
function copyTails(flow: FlowGraph): FlowGraph {
  let graph = flow;
  let copied = 0;
  for (let round = 0; round < MAX_COPIED_STEPS; round++) {
    const { copies } = scanPathEnds(graph);
    if (copies.length === 0) return graph;
    const next = copyTail(graph, copies[0], MAX_COPIED_STEPS - copied);
    // Left as it is: FlowTranspiler refuses it (unwritablePathEnd).
    if (next === null) return graph;
    copied += next.copied;
    graph = next.graph;
  }
  return graph;
}

/** The graph with `copy`'s tail copied into the if's else side, or null
 * when that can't be done safely (more than `budget` steps; a step in the
 * tail reached from somewhere that isn't one of the if's sides). */
function copyTail(
  flow: FlowGraph,
  copy: TailCopy,
  budget: number
): { graph: FlowGraph; copied: number } | null {
  const isHint = (e: FlowEdge) => e.type === 'hint' || e.type === 'choose-hint';
  const backEdgeIds = findBackEdges(flow);
  const forward = (id: string) =>
    flow.edges.filter((e) => e.source === id && !isHint(e) && !backEdgeIds.has(e.id));
  const reach = (starts: string[], avoid: Set<string>): Set<string> => {
    const seen = new Set<string>();
    const queue = starts.filter((id) => !avoid.has(id));
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of forward(id)) if (!avoid.has(e.target)) queue.push(e.target);
    }
    return seen;
  };
  const fromMeetings = reach(copy.meetings, new Set());
  const afterOuter = reach(
    copy.outerStop.filter((id) => fromMeetings.has(id)),
    new Set()
  );
  const tail = reach(copy.meetings, afterOuter);
  if (tail.size === 0 || tail.size > budget) return null;
  const outside = new Set([...tail, ...afterOuter]);
  const thenSide = reach(copy.thenTargets, outside);
  const elseSide = reach(copy.elseTargets, outside);
  const chain = new Set(copy.chain);
  const side = (e: FlowEdge): 'then' | 'else' | null => {
    if (chain.has(e.source)) return e.sourceHandle === 'false' ? 'else' : 'then';
    const inThen = thenSide.has(e.source);
    const inElse = elseSide.has(e.source);
    if (inThen === inElse) return null;
    return inThen ? 'then' : 'else';
  };
  const into = flow.edges.filter((e) => tail.has(e.target) && !tail.has(e.source));
  for (const e of into) {
    if (isHint(e)) continue;
    if (backEdgeIds.has(e.id) || side(e) === null) return null;
  }
  const nodeIds = new Set(flow.nodes.map((n) => n.id));
  const edgeIds = new Set(flow.edges.map((e) => e.id));
  const fresh = (taken: Set<string>, base: string): string => {
    let id = `${base}__copy`;
    for (let k = 2; taken.has(id); k++) id = `${base}__copy${k}`;
    taken.add(id);
    return id;
  };
  const copyOf = new Map([...tail].map((id) => [id, fresh(nodeIds, id)]));
  const nodes: FlowNode[] = [...flow.nodes];
  for (const node of flow.nodes) {
    const id = copyOf.get(node.id);
    if (id === undefined) continue;
    nodes.push({
      ...node,
      id,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: structuredClone(node.data),
    } as FlowNode);
  }
  const edges: FlowEdge[] = flow.edges.map((e) =>
    !tail.has(e.target) || tail.has(e.source) || side(e) !== 'else'
      ? e
      : { ...e, target: copyOf.get(e.target)! }
  );
  for (const e of flow.edges) {
    if (!tail.has(e.source)) continue;
    edges.push({
      ...e,
      id: fresh(edgeIds, e.id),
      source: copyOf.get(e.source)!,
      target: copyOf.get(e.target) ?? e.target,
    });
  }
  return { graph: { ...flow, nodes, edges }, copied: tail.size };
}

/**
 * Decision D5: a path that ends inside a parallel branch where the tree
 * reading carries on within the branch, and no copy writes it -- in a loop
 * there (it would go round again), or with more to copy than
 * MAX_COPIED_STEPS. The reason FlowTranspiler refuses the graph with, or
 * null. For a normalized graph.
 */
export function unwritablePathEnd(flow: FlowGraph): string | null {
  const { copies, unwritable } = scanPathEnds(flow);
  const name = (end: PathEnd) => {
    const node = flow.nodes.find((n) => n.id === end.nodeId);
    const alias = (node?.data as Record<string, unknown> | undefined)?.alias;
    const label = typeof alias === 'string' && alias ? alias : end.nodeId;
    return end.handle
      ? `"${label}" (its ${end.handle === 'true' ? 'Yes' : 'No'} side)`
      : `"${label}"`;
  };
  if (unwritable.length > 0) {
    return (
      `A path ends at ${name(unwritable[0])}, inside a loop in a parallel branch, while steps run ` +
      `after the parallel. Home Assistant can end the whole automation there, not one branch, and ` +
      `the loop would go round again. Connect the path to where the loop goes on, or move the loop ` +
      `out of the parallel.`
    );
  }
  if (copies.length > 0) {
    return (
      `A path ends at ${name(copies[0].end)}, inside a parallel branch before that branch's steps ` +
      `meet again, while steps run after the parallel. Home Assistant can end the whole automation ` +
      `there, not one branch, and writing it would mean copying the steps after the meeting point, ` +
      `which can't be done here (more than ${MAX_COPIED_STEPS} steps, or one of them is also reached ` +
      `from outside that if). Connect the path to where the branch's steps meet.`
    );
  }
  return null;
}
