import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { findBackEdges } from './topology';

/**
 * Bug #28 (2026-09-26, found by the canvas-graph fuzzer): gives every
 * until loop its own entry node when it shares one with another loop.
 *
 * An until loop's back-edge (its `repeat_until` test's false edge) goes to
 * the first node of its body. When that body OPENS with another loop, the
 * first node is also the inner loop's entry -- e.g. `until A: [until B:
 * [x], y]` drawn on the canvas wires both A's and B's false edges to x, and
 * `until A: [while W: [...]]` wires A's false edge to W, which W's own body
 * also loops back to. NativeStrategy and extractFromGraph.ts both key their
 * loop tables by entry node, so the second loop silently replaced the
 * first: the outer loop compiled, the inner one became a plain `if`, and
 * the gate agreed (both sides read the graph the same wrong way).
 *
 * YamlParser never produces this shape -- for an until whose body opens
 * with a `repeat:` (or `parallel:`) it opens the body with a pass-through
 * Join node and loops back to that (bug #24). This does the same for a
 * graph drawn by hand: for the OUTERMOST until among the loops sharing an
 * entry X, insert a Join node J, redirect every forward edge into X and
 * that until's back-edge to J, and add J -> X. J only passes control on,
 * so the flowchart's behavior is unchanged; repeated until no entry is
 * shared by an until and another loop.
 *
 * "Another loop" means a back-edge into X that belongs to a different
 * loop: another `repeat_until` test's false edge, anything looping back
 * onto a `repeat_while` head, or a count test's true edge. A false
 * back-edge from a plain condition (no `_blockKey`) is left alone -- that's
 * how a hand-wired 2nd member of a multi-condition `until: [A, B]` looks,
 * which is the same loop, not a nested one.
 *
 * Returns the input unchanged (same object) when nothing needs anchoring,
 * or when the loops sharing an entry can't be ordered outer-to-inner (then
 * the verifiers' own collision check makes the transpile fall back rather
 * than guess).
 */
export function anchorSharedLoopEntries(flow: FlowGraph): FlowGraph {
  let current = flow;
  // Each pass anchors one until loop; a graph can't need more passes than
  // it has edges.
  for (let pass = 0; pass <= flow.edges.length; pass++) {
    const next = anchorOne(current);
    if (next === null) return current;
    current = next;
  }
  return current;
}

function blockKey(node: FlowNode | undefined): unknown {
  return (node?.data as Record<string, unknown> | undefined)?._blockKey;
}

function isUntilBackEdge(edge: FlowEdge, nodesById: Map<string, FlowNode>): boolean {
  const source = nodesById.get(edge.source);
  return (
    source?.type === 'condition' &&
    edge.sourceHandle === 'false' &&
    blockKey(source) === 'repeat_until'
  );
}

/** Could this back-edge into `target` belong to a loop other than an until
 * whose test is somewhere else? (See the doc comment above.) */
function isOtherLoopBackEdge(edge: FlowEdge, nodesById: Map<string, FlowNode>): boolean {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  if (!source || !target) return false;
  if (isUntilBackEdge(edge, nodesById)) return true;
  if (target.type === 'condition' && blockKey(target) === 'repeat_while') return true;
  if (source.type !== 'condition') return target.type === 'condition'; // while body end
  if (typeof blockKey(source) === 'string') return target.type === 'condition'; // body exit into a while head
  return edge.sourceHandle === 'true'; // count test
}

function anchorOne(flow: FlowGraph): FlowGraph | null {
  const edges = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
  const backEdgeIds = findBackEdges(flow);
  const nodesById = new Map(flow.nodes.map((n) => [n.id, n]));

  const backEdgesByTarget = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (!backEdgeIds.has(e.id)) continue;
    const list = backEdgesByTarget.get(e.target) ?? [];
    list.push(e);
    backEdgesByTarget.set(e.target, list);
  }

  const forwardReach = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of edges) if (e.source === id && !backEdgeIds.has(e.id)) queue.push(e.target);
    }
    return false;
  };

  for (const [targetId, backEdges] of backEdgesByTarget) {
    const untilEdges = backEdges.filter((e) => isUntilBackEdge(e, nodesById));
    if (untilEdges.length === 0) continue;
    const loopEdges = backEdges.filter((e) => isOtherLoopBackEdge(e, nodesById));
    const sources = new Set(loopEdges.map((e) => e.source));
    if (sources.size < 2) continue;

    // The outermost until: every other until test sharing this entry
    // reaches it going forward (an inner loop finishes, then the rest of
    // the outer body runs, then the outer test). Must be unique.
    const outer = untilEdges.filter((candidate) =>
      untilEdges.every(
        (other) => other.source === candidate.source || forwardReach(other.source, candidate.source)
      )
    );
    if (outer.length !== 1) continue;
    // A while or count loop at this entry is necessarily inside the until
    // (its own entry can't be the until's body start unless it's the body's
    // first statement); make sure the until's test is really after it.
    const others = loopEdges.filter((e) => e.source !== outer[0].source);
    if (
      !others.every(
        (e) => forwardReach(e.source, outer[0].source) || forwardReach(e.target, outer[0].source)
      )
    ) {
      continue;
    }

    const existingIds = new Set(flow.nodes.map((n) => n.id));
    let anchorId = `${targetId}__loop_entry`;
    for (let i = 2; existingIds.has(anchorId); i++) anchorId = `${targetId}__loop_entry_${i}`;
    const existingEdgeIds = new Set(flow.edges.map((e) => e.id));
    let anchorEdgeId = `${anchorId}__to__${targetId}`;
    for (let i = 2; existingEdgeIds.has(anchorEdgeId); i++)
      anchorEdgeId = `${anchorId}__to__${targetId}_${i}`;

    const target = nodesById.get(targetId)!;
    const anchor = {
      id: anchorId,
      type: 'join',
      position: { x: target.position.x, y: target.position.y - 80 },
      data: { mode: 'all' },
    } as FlowNode;

    const outerEdgeId = outer[0].id;
    const redirected = flow.edges.map((e) => {
      if (e.target !== targetId || e.type === 'hint' || e.type === 'choose-hint') return e;
      if (e.id === outerEdgeId || !backEdgeIds.has(e.id)) return { ...e, target: anchorId };
      return e;
    });
    return {
      ...flow,
      nodes: [...flow.nodes, anchor],
      edges: [...redirected, { id: anchorEdgeId, source: anchorId, target: targetId } as FlowEdge],
    };
  }
  return null;
}
