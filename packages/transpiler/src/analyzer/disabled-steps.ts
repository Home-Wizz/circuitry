import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';

/**
 * Bug #75 (2026-09-27, found by the metamorphic tests; decided: a
 * disabled step is treated as if it weren't there). Some graph conventions
 * depend on two nodes being joined directly:
 * - a condition reached by another condition's true edge is a member of
 *   its list or AND chain and shares its else (bugs #21, #27);
 * - an until loop is recognized by its test's false edge looping back
 *   (bug #63), a count loop by its test's edge back to its init node and
 *   by its increment step leading straight to its test (bug #23).
 * A disabled step put on such an edge -- one HA skips -- used to break the
 * convention and change what the graph meant: e.g. `Motion? -yes->
 * (disabled) -> After sunset?` stopped sharing Motion's else, so "no"
 * after sunset did nothing instead of running the else.
 *
 * Here such a step is taken out of the graph and its edges joined up, so
 * every strategy and both verifiers read the graph as if it weren't there.
 * It isn't written to the saved YAML: there's no place for a step between
 * two conditions of a list, and HA would skip it anyway. The canvas keeps
 * it (the stored graph is the canvas's own).
 *
 * A step is taken out when it is disabled (`enabled: false`), is a plain
 * step (action, delay, wait, set variables; a disabled condition means
 * "true" in HA, which is different), has exactly one outgoing edge with no
 * handle, and is reached only from where a convention reads adjacency:
 * - the true edge of a condition, leading to a condition that would be its
 *   list/AND-chain member (no `_blockKey`, no false edge of its own);
 * - a loop test's own edge back to its loop (a `repeat_until` test's false
 *   edge, a count test's true edge back to its init step), the step being
 *   on that wire: reached only from the test, with the loop-back on one
 *   side;
 * - a count loop's increment step, leading to its test.
 * A disabled step anywhere else -- first in a branch or a loop body, last
 * in a while body, ... -- is written as before (with `enabled: false`), so
 * HA's editor still shows it.
 *
 * Returns the input unchanged (same object) when there is nothing to do.
 */
export function removeDisabledPassThroughSteps(flow: FlowGraph): FlowGraph {
  let current = flow;
  // One step at a time, until none is left: a chain of disabled steps is
  // taken out step by step.
  for (;;) {
    const step = current.nodes.find((n) => isRemovable(current, n));
    if (!step) return current;
    const next = spliceOut(current, step);
    if (next === current) return current;
    current = next;
  }
}

const PLAIN_STEP_TYPES = new Set(['action', 'delay', 'wait', 'set_variables']);

/** A count loop's init step (`_repeat_counter_X: 0`). */
function isCounterInit(node: FlowNode | undefined): boolean {
  if (node?.type !== 'set_variables') return false;
  const vars = (node.data as Record<string, unknown>).variables;
  if (!vars || typeof vars !== 'object') return false;
  const entries = Object.entries(vars);
  return (
    entries.length === 1 && entries[0][0].startsWith('_repeat_counter_') && entries[0][1] === 0
  );
}

/** A count loop's increment step (`_repeat_counter_X: "{{ ... + 1 }}"`). */
function isIncrementStep(node: FlowNode | undefined): boolean {
  if (node?.type !== 'set_variables') return false;
  const vars = (node.data as Record<string, unknown>).variables;
  if (!vars || typeof vars !== 'object') return false;
  const entries = Object.entries(vars);
  return (
    entries.length === 1 &&
    entries[0][0].startsWith('_repeat_counter_') &&
    typeof entries[0][1] === 'string'
  );
}

function isRemovable(flow: FlowGraph, node: FlowNode): boolean {
  if (!PLAIN_STEP_TYPES.has(node.type)) return false;
  if ((node.data as Record<string, unknown>).enabled !== false) return false;
  const outgoing = flow.edges.filter((e) => e.source === node.id);
  if (outgoing.length !== 1 || outgoing[0].sourceHandle) return false;
  const out = outgoing[0];
  const incoming = flow.edges.filter((e) => e.target === node.id);
  if (incoming.length !== 1) return false;
  const into = incoming[0];
  const byId = (id: string) => flow.nodes.find((n) => n.id === id);
  const source = byId(into.source);
  const target = byId(out.target);

  // Between a condition and the condition that would be its list member
  // (the head's only true edge, as a member's is).
  if (
    source?.type === 'condition' &&
    into.sourceHandle === 'true' &&
    flow.edges.filter((e) => e.source === source.id && e.sourceHandle === 'true').length === 1 &&
    target?.type === 'condition' &&
    typeof (target.data as Record<string, unknown>)._blockKey !== 'string' &&
    !flow.edges.some((e) => e.source === target.id && e.sourceHandle === 'false')
  ) {
    return true;
  }
  // On a loop test's own wire back to its loop: an until test's false edge
  // (a `repeat_until` head's false edge always loops back to its own body),
  // or a count test's true edge back to its init step. Not any other
  // condition's edge to a step that loops back -- a loop's exit leading to
  // the last step of an outer loop's body, say -- nor a while body made of
  // just this step, which loops back to the test itself.
  const isUntilTest =
    (source?.data as Record<string, unknown> | undefined)?._blockKey === 'repeat_until';
  if (
    source?.type === 'condition' &&
    out.target !== source.id &&
    (out.type === 'loop-back' || into.type === 'loop-back') &&
    ((into.sourceHandle === 'false' && isUntilTest) ||
      (into.sourceHandle === 'true' && isCounterInit(target)))
  ) {
    return true;
  }
  // Between a count loop's increment and its test.
  return isIncrementStep(source) && target?.type === 'condition';
}

/** Joins every edge into `step` to the edge out of it, and drops `step`.
 * Only for a step isRemovable accepted, which has exactly one edge out;
 * any other is left in place (never the first of several). */
function spliceOut(flow: FlowGraph, step: FlowNode): FlowGraph {
  const outgoing = flow.edges.filter((e) => e.source === step.id);
  if (outgoing.length !== 1) return flow;
  const [out] = outgoing;
  const incoming = flow.edges.filter((e) => e.target === step.id);
  const edges: FlowEdge[] = flow.edges.filter((e) => e.source !== step.id && e.target !== step.id);
  for (const into of incoming) {
    const exists = edges.some(
      (e) =>
        e.source === into.source &&
        e.target === out.target &&
        (e.sourceHandle ?? undefined) === (into.sourceHandle ?? undefined)
    );
    if (exists) continue;
    const joined: FlowEdge = { ...into, id: `${into.id}__via_${step.id}`, target: out.target };
    if (out.type === 'loop-back' || into.type === 'loop-back') joined.type = 'loop-back';
    edges.push(joined);
  }
  return { ...flow, nodes: flow.nodes.filter((n) => n.id !== step.id), edges };
}
