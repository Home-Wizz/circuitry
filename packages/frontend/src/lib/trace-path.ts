import type { FlowGraph, FlowNode } from '@circuitry/shared';
import { walkGraph } from '@circuitry/transpiler';

/**
 * The canvas's trace simulator: the nodes a run of `graph` passes through,
 * in order, walking it with the transpiler's own reading of the graph
 * (`walkGraph`: every branch of a parallel, a meeting point once, loops,
 * Joins, a list member's inherited else, a path that ends stopping the
 * automation) -- so what the canvas animates is what the saved automation
 * does. It used to follow only the first edge out of each node.
 *
 * Conditions take the outcome the user picked for them, or a random one.
 * A count loop's test counts, from the counter its init and increment
 * steps keep. A `stop` ends the run. The walk gives up after `maxSteps`
 * nodes (a loop whose test the user pinned may never end); `finished`
 * says whether it got to the end.
 */
export interface TracePath {
  nodeIds: string[];
  /** The canvas edges the run went down. */
  edgeIds: string[];
  finished: boolean;
}

class TraceStop extends Error {}
class TraceLimit extends Error {}

const COUNT_TEST = /^\{\{\s*(_repeat_counter_\w+)\s*<\s*(\d+)\s*\}\}$/;

/** A condition's data as written to YAML: without the canvas's own `_`
 * keys (so a condition can be matched to the one normalization copied
 * into a combined test). */
const stripped = (data: unknown): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries((data as Record<string, unknown>) ?? {}).filter(([k]) => !k.startsWith('_'))
    )
  );

export function tracePath(
  graph: FlowGraph,
  picked: Record<string, boolean>,
  random: () => boolean = () => Math.random() > 0.5,
  maxSteps = 300
): TracePath {
  const onCanvas = new Map(graph.nodes.map((n) => [n.id, n]));
  const edgesOnCanvas = new Set(graph.edges.map((e) => e.id));
  const edgeIds = new Set<string>();
  // A condition's outcome: the one picked, or drawn afresh each time it is
  // tested (a loop's test comes up again).
  const outcomeOf = (id: string): boolean => picked[id] ?? random();
  const byData = new Map(
    graph.nodes.filter((n) => n.type === 'condition').map((n) => [stripped(n.data), n.id])
  );
  const counters = new Map<string, number>();
  const nodeIds: string[] = [];
  let steps = 0;

  /** A test normalization made (conditions meeting at one step become one
   * `or`, #111): the outcome of the canvas conditions it came from. */
  const evaluate = (data: Record<string, unknown>): boolean => {
    const id = byData.get(stripped(data));
    if (id !== undefined) return outcomeOf(id);
    const parts = Array.isArray(data.conditions)
      ? (data.conditions as Record<string, unknown>[])
      : [];
    if (data.condition === 'or') return parts.some(evaluate);
    if (data.condition === 'not') return !parts.some(evaluate);
    return random();
  };

  /** The canvas conditions a combined test was made from, in order. */
  const sourcesOf = (data: unknown): string[] => {
    const id = byData.get(stripped(data));
    if (id !== undefined) return [id];
    const parts = (data as { conditions?: unknown }).conditions;
    return Array.isArray(parts) ? parts.flatMap(sourcesOf) : [];
  };

  const test = (node: FlowNode): boolean => {
    const data = node.data as Record<string, unknown>;
    const count =
      typeof data.value_template === 'string' ? COUNT_TEST.exec(data.value_template.trim()) : null;
    if (count) return (counters.get(count[1]) ?? 0) < Number(count[2]);
    if (onCanvas.has(node.id)) return outcomeOf(node.id);
    return evaluate(data);
  };

  const run = (node: FlowNode): void => {
    const data = node.data as Record<string, unknown>;
    if (node.type === 'action' && 'stop' in data) throw new TraceStop();
    if (node.type !== 'set_variables') return;
    const vars = (data.variables as Record<string, unknown> | undefined) ?? {};
    for (const [name, value] of Object.entries(vars)) {
      if (!name.startsWith('_repeat_counter_')) continue;
      counters.set(name, value === 0 ? 0 : (counters.get(name) ?? 0) + 1);
    }
  };

  try {
    walkGraph(graph, 0, {
      tick: () => {
        steps++;
        if (steps > maxSteps) throw new TraceLimit();
      },
      // Only what is on the canvas: normalization's own nodes (a `stop` at
      // a path's end, a loop anchor, a combined test) have nothing to light.
      visit: (node) => {
        if (onCanvas.has(node.id)) nodeIds.push(node.id);
        else if (node.type === 'condition') nodeIds.push(...sourcesOf(node.data));
      },
      follow: (edge) => {
        if (edgesOnCanvas.has(edge.id)) edgeIds.add(edge.id);
      },
      test,
      run,
      isStop: (e) => e instanceof TraceStop,
    });
  } catch (e) {
    if (e instanceof TraceLimit) return { nodeIds, edgeIds: [...edgeIds], finished: false };
    throw e;
  }
  return { nodeIds, edgeIds: [...edgeIds], finished: true };
}
