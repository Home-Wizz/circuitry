import type { FlowGraph } from '@circuitry/shared';
import { classifyLoopBackEdge } from '../strategies/native';
import { findBackEdges } from './topology';

/**
 * Bug #275 (2026-10-14, the editor fuzzer, seed 20261015, session 755):
 * steps beside where a loop goes on (#267: beside its test at the end, or
 * beside a line back round it) that another path also leads into. Drawn,
 * the other path meets them there -- in the round it arrives in, once --
 * and the round waits for them; Home Assistant's YAML can't say that (the
 * steps run in every round's parallel, and again where the other path
 * goes on), and both writers ran them twice. Refused, saying what to
 * change. The node fanning out, the step beside, and where the other way
 * in comes from; null when there's none.
 */
export function besideLoopJoinedElsewhere(
  flow: FlowGraph
): { node: string; beside: string; from: string } | null {
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const edges = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
  const backEdges = findBackEdges(flow);
  const forward = (id: string) =>
    edges.filter((e) => e.source === id && !backEdges.has(e.id)).map((e) => e.target);
  /** A loop's own test at its end (do-while, until, count). */
  const testAtEnd = (id: string) => {
    const node = nodes.get(id);
    if (node?.type !== 'condition') return false;
    return edges.some((e) => {
      const head = nodes.get(e.target);
      if (e.source !== id || !backEdges.has(e.id) || !head) return false;
      const kind = classifyLoopBackEdge(node, head, e.sourceHandle);
      return kind === 'do-while' || kind === 'until' || kind === 'count';
    });
  };
  const reach = (starts: string[]) => {
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...forward(id));
    }
    return seen;
  };
  const triggers = flow.nodes.filter((n) => n.type === 'trigger' || n.type === 'start');
  const reachOf = new Map(triggers.map((t) => [t.id, reach([t.id])]));
  for (const node of flow.nodes) {
    // Only ways in a run that gets here can take: another trigger's path
    // is another run.
    const sameRun = new Set(
      triggers
        .filter((t) => reachOf.get(t.id)!.has(node.id))
        .flatMap((t) => [...reachOf.get(t.id)!])
    );
    const out = edges.filter((e) => e.source === node.id);
    const groups =
      node.type === 'condition'
        ? [
            out.filter((e) => e.sourceHandle === 'true'),
            out.filter((e) => e.sourceHandle === 'false'),
          ]
        : [out];
    for (const group of groups) {
      const goesRound = group.some((e) => backEdges.has(e.id));
      const targets = group.filter((e) => !backEdges.has(e.id)).map((e) => e.target);
      const tests = targets.filter(testAtEnd);
      if (!goesRound && tests.length === 0) continue;
      for (const beside of targets.filter((t) => !tests.includes(t))) {
        const region = new Set<string>();
        const queue = [beside];
        while (queue.length > 0) {
          const id = queue.pop()!;
          if (region.has(id) || tests.includes(id)) continue;
          region.add(id);
          queue.push(...forward(id));
        }
        for (const e of edges) {
          if (backEdges.has(e.id) || !region.has(e.target)) continue;
          if (region.has(e.source) || e.source === node.id || !sameRun.has(e.source)) continue;
          return { node: node.id, beside, from: e.source };
        }
      }
    }
  }
  return null;
}

/**
 * #263's loop: a step going back to a condition that leads to it only
 * from its "no" side. The state machine writes it as drawn on its own; a
 * parallel branch holding it can't be written (FlowTranspiler names it when
 * the state machine's output is refused).
 */
export function loopOnNoSide(flow: FlowGraph): { step: string; test: string } | null {
  const edges = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
  const backEdges = findBackEdges(flow);
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const reachFrom = (starts: string[]): Set<string> => {
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of edges) if (e.source === id && !backEdges.has(e.id)) queue.push(e.target);
    }
    return seen;
  };
  for (const e of edges) {
    if (!backEdges.has(e.id)) continue;
    if (nodes.get(e.source)?.type === 'condition' || nodes.get(e.target)?.type !== 'condition')
      continue;
    const side = (handle: string) =>
      edges
        .filter((o) => o.source === e.target && o.sourceHandle === handle && !backEdges.has(o.id))
        .map((o) => o.target);
    if (!reachFrom(side('true')).has(e.source) && reachFrom(side('false')).has(e.source)) {
      return { step: e.source, test: e.target };
    }
  }
  return null;
}
