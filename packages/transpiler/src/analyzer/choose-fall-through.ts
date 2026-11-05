import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { walkGraph } from '../simulation/graph-walk';
import { normalizeGraph } from './normalize';

/**
 * Where a Choose card goes when none of its options passes and no
 * "Otherwise" line is drawn: decision D1, rule 1 (analyzer/path-endings.ts,
 * addChooseFallThrough) -- it carries on, as Home Assistant's own `choose`
 * with no `default:` does. The canvas draws that path (a dashed "None
 * matched" line) and saving warns when the Choose gates nothing: whichever
 * of its tests pass, the run reaches that card without doing anything first
 * (the maintainer, 2026-10-25, after a bedroom light gated on "night, or day
 * and dark" turned on in daylight).
 */
export interface ChooseFallThrough {
  /** The Choose's last option (its first condition carries the line). */
  from: string;
  /** Where the run carries on: a card on the canvas. */
  to: string;
  /** Whether the Choose gates nothing (see above). */
  gatesNothing: boolean;
}

/** The suffix addChooseFallThrough gives the lines it adds. */
const FALLS_THROUGH = '__falls_through_';

/** The most tests tried in every combination when asking whether a Choose
 * gates nothing: past it, it isn't asked (no warning). */
const MAX_TESTS = 10;

export function chooseFallThroughs(
  flow: FlowGraph,
  /** normalizeGraph(flow), when the caller has it already. */
  normalized: FlowGraph = normalizeGraph(flow)
): ChooseFallThrough[] {
  const drawn = new Map(flow.nodes.map((n) => [n.id, n]));
  const found: ChooseFallThrough[] = [];
  for (const e of normalized.edges) {
    const at = e.id.indexOf(FALLS_THROUGH);
    if (at < 0 || e.id.slice(0, at) !== e.source) continue;
    if (!drawn.has(e.source) || !drawn.has(e.target)) continue;
    found.push({
      from: e.source,
      to: e.target,
      gatesNothing: gatesNothing(flow, e.source, e.target),
    });
  }
  return found;
}

class Reached extends Error {}
class Ran extends Error {}

/** The first case of the Choose whose last case is `last`. */
function firstCase(flow: FlowGraph, last: string): string {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  let at = last;
  for (let guard = 0; guard < flow.nodes.length; guard++) {
    // The previous option's "no" line into this one: exactly one, or the
    // chain is read no further.
    const prev = flow.edges.filter(
      (e) =>
        e.target === at &&
        e.sourceHandle === 'false' &&
        (byId.get(e.source)?.data as Record<string, unknown> | undefined)?._blockKey === 'choose'
    );
    if (prev.length !== 1) break;
    at = prev[0].source;
  }
  return at;
}

/**
 * Whether every outcome of the Choose's tests reaches `to` before anything
 * runs: the canvas walk, started at the Choose's first option, with each
 * combination of the tests it can meet on the way.
 */
function gatesNothing(flow: FlowGraph, last: string, to: string): boolean {
  const start = firstCase(flow, last);
  // The tests the run can meet between the Choose and `to`.
  const tests: string[] = [];
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id) || id === to) continue;
    seen.add(id);
    const node = flow.nodes.find((n) => n.id === id);
    if (node?.type !== 'condition') continue;
    tests.push(id);
    for (const e of flow.edges) if (e.source === id && e.type !== 'hint') queue.push(e.target);
  }
  if (tests.length === 0 || tests.length > MAX_TESTS) return false;
  const probe: FlowNode = {
    id: '__choose_probe',
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: { trigger: 'state', entity_id: 'binary_sensor.probe' },
  } as FlowNode;
  const graph: FlowGraph = {
    ...flow,
    nodes: [probe, ...flow.nodes.filter((n) => n.type !== 'trigger')],
    edges: [
      { id: '__choose_probe_line', source: probe.id, target: start } as FlowEdge,
      ...flow.edges.filter((e) => flow.nodes.find((n) => n.id === e.source)?.type !== 'trigger'),
    ],
  };
  for (let combo = 0; combo < 1 << tests.length; combo++) {
    try {
      walkGraph(graph, 0, {
        tick: () => {},
        visit: (node) => {
          if (node.id === to) throw new Reached();
        },
        test: (node) => {
          const i = tests.indexOf(node.id);
          if (i < 0) throw new Ran();
          return (combo & (1 << i)) !== 0;
        },
        run: () => {
          throw new Ran();
        },
        isStop: () => false,
      });
      return false; // the run ended before reaching `to`
    } catch (e) {
      if (e instanceof Reached) continue;
      return false;
    }
  }
  return true;
}
