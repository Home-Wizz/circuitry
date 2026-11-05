import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { listHeads } from './list-members';
import { findBackEdges } from './topology';

/**
 * #134 (decided with the maintainer, 2026-10-31): the branches of a
 * fan-out inside a loop go back round it only on some of their paths, and
 * none on every path -- "check the hall and the porch; either one still
 * busy goes round again". Drawn, the next round comes once every branch
 * has finished, when at least one of them went round (the graph walk).
 * Home Assistant carries a variable a parallel's branch sets out of the
 * parallel (checked in HA 2026.9 and 2026.10), so each branch records
 * whether it went round in a flag of its own, and after the branches a
 * test of the flags goes round or ends:
 *
 *   F -> b1.. ; bi's line back -> L         becomes
 *   F -> reset -> b1.. ; bi's line back -> set flag i -> join;
 *   every way bi ends -> join;  join -> any flag? -- yes -> L (back)
 *
 * Every way out of the branches is a line back to the same step or an
 * end; the branches don't meet, hold no condition list and no `stop`.
 * Anything else is left as drawn (and refused as before). Not for the
 * graph walk, which reads the drawing itself and so checks this rewrite.
 */
export function writeOutRoundFlags(flow: FlowGraph): FlowGraph {
  let current = flow;
  for (let pass = 0; pass <= flow.nodes.length; pass++) {
    const next = writeOutOne(current);
    if (next === null) return current;
    current = next;
  }
  return current;
}

/** The node ids a rewrite adds for the fan-out `from` (on `handle`). */
export function roundFlagIds(from: string, handle: string | null) {
  const base = `${from}${handle ? `_${handle}` : ''}__round`;
  return { reset: `${base}_reset`, join: `${base}_join`, test: `${base}_test`, base };
}

function writeOutOne(flow: FlowGraph): FlowGraph | null {
  const lines = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
  const backEdges = findBackEdges(flow);
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const heads = listHeads(flow);
  const forwardOf = (id: string) => lines.filter((e) => e.source === id && !backEdges.has(e.id));

  // Every fan-out: a step's lines, or one side of a condition.
  const fanOuts = new Map<string, FlowEdge[]>();
  for (const e of lines) {
    if (backEdges.has(e.id)) continue;
    const key = `${e.source}\u0000${e.sourceHandle ?? ''}`;
    fanOuts.set(key, [...(fanOuts.get(key) ?? []), e]);
  }
  for (const [key, out] of fanOuts) {
    if (out.length < 2) continue;
    // A condition's side fanning out (beside a loop's test: #265, #267)
    // is read by the rules for steps beside; left to them.
    if (nodes.get(key.split('\u0000')[0])?.type === 'condition') continue;
    const [from, handle] = key.split('\u0000');
    if (nodes.has(roundFlagIds(from, handle || null).reset)) continue;
    const rewritten = rewriteFanOut(flow, from, handle || null, out, {
      lines,
      backEdges,
      nodes,
      heads,
      forwardOf,
    });
    if (rewritten !== null) return rewritten;
  }
  return null;
}

interface Ctx {
  lines: FlowEdge[];
  backEdges: Set<string>;
  nodes: Map<string, FlowNode>;
  heads: Map<string, string>;
  forwardOf: (id: string) => FlowEdge[];
}

function rewriteFanOut(
  flow: FlowGraph,
  from: string,
  handle: string | null,
  out: FlowEdge[],
  ctx: Ctx
): FlowGraph | null {
  const { lines, backEdges, nodes, heads, forwardOf } = ctx;
  const regions = out.map((e) => {
    const seen = new Set<string>();
    const queue = [e.target];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const f of forwardOf(id)) queue.push(f.target);
    }
    return seen;
  });
  // The branches don't meet.
  const all = new Set<string>();
  for (const region of regions) {
    for (const id of region) {
      if (all.has(id)) return null;
      all.add(id);
    }
  }
  // Nothing else leads into the branches.
  for (const e of lines) {
    if (all.has(e.target) && !all.has(e.source) && !out.some((o) => o.id === e.id)) return null;
  }
  let loopStep: string | null = null;
  const back: FlowEdge[][] = regions.map(() => []);
  const ends: { id: string; handle: 'true' | 'false' | null }[][] = regions.map(() => []);
  for (const [i, region] of regions.entries()) {
    for (const id of region) {
      const node = nodes.get(id);
      if (!node) return null;
      const data = node.data as Record<string, unknown>;
      if (node.type === 'action' && 'stop' in data) return null;
      if (!['action', 'delay', 'wait', 'set_variables', 'condition'].includes(node.type))
        return null;
      const own = lines.filter((e) => e.source === id);
      for (const e of own) {
        if (region.has(e.target)) continue;
        if (!backEdges.has(e.id)) return null;
        // Round on a test's "no": a test that can't be evaluated ends an
        // until in HA, where a flag would send it round (#63); left alone.
        if (node.type === 'condition' && e.sourceHandle === 'false') return null;
        if (loopStep !== null && loopStep !== e.target) return null;
        loopStep = e.target;
        back[i].push(e);
      }
      if (node.type === 'condition') {
        for (const side of ['true', 'false'] as const) {
          if (own.some((e) => e.sourceHandle === side)) continue;
          // A list member's missing "no" is its list's else (when the
          // list has one), not an end.
          const head = heads.get(id);
          if (
            side === 'false' &&
            head !== undefined &&
            lines.some((e) => e.source === head && e.sourceHandle === 'false')
          )
            continue;
          ends[i].push({ id, handle: side });
        }
      } else if (own.length === 0) {
        ends[i].push({ id, handle: null });
      }
    }
  }
  if (loopStep === null) return null;
  // Only some paths go round, and no branch goes round on every path (a
  // branch that always does sends the loop round anyway).
  if (back.some((b, i) => b.length > 0 && ends[i].length === 0)) return null;
  // The fan-out is inside the loop it goes round.
  const reached = new Set<string>();
  const queue = [loopStep];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const e of forwardOf(id)) queue.push(e.target);
  }
  if (!reached.has(from)) return null;

  const ids = roundFlagIds(from, handle);
  const flag = (i: number) => `${ids.base}_${i + 1}`.replace(/[^A-Za-z0-9_]/g, '_');
  const goesRound = back.map((b) => b.length > 0);
  const flags = goesRound.flatMap((g, i) => (g ? [flag(i)] : []));
  const at = nodes.get(from)!.position;
  const place = (dx: number, dy: number) => ({ x: at.x + dx, y: at.y + dy });
  const added: FlowNode[] = [
    {
      id: ids.reset,
      type: 'set_variables',
      position: place(160, 0),
      data: { variables: Object.fromEntries(flags.map((f) => [f, false])) },
    } as FlowNode,
    { id: ids.join, type: 'join', position: place(640, 0), data: {} } as FlowNode,
    {
      id: ids.test,
      type: 'condition',
      position: place(800, 0),
      data: { condition: 'template', value_template: `{{ ${flags.join(' or ')} }}` },
    } as FlowNode,
  ];
  const newEdges: FlowEdge[] = [];
  const edge = (id: string, source: string, target: string, sourceHandle: string | null = null) =>
    ({ id, source, target, sourceHandle, targetHandle: null }) as FlowEdge;
  newEdges.push(edge(`${ids.base}_in`, from, ids.reset, handle));
  for (const e of out) newEdges.push({ ...e, source: ids.reset, sourceHandle: null });
  const backIds = new Set(back.flat().map((e) => e.id));
  for (const [i, b] of back.entries()) {
    if (b.length === 0) continue;
    const setId = `${ids.base}_set_${i + 1}`;
    added.push({
      id: setId,
      type: 'set_variables',
      position: place(480, 120 * i),
      data: { variables: { [flag(i)]: true } },
    } as FlowNode);
    // No longer a line back (the flag step is ahead): its loop-back
    // marker goes to the test's line back.
    for (const e of b) {
      const { type: _marker, ...rest } = e;
      newEdges.push({ ...rest, target: setId } as FlowEdge);
    }
    newEdges.push(edge(`${setId}_out`, setId, ids.join));
  }
  for (const [i, list] of ends.entries()) {
    for (const end of list)
      newEdges.push(
        edge(`${ids.base}_end_${i + 1}_${end.id}_${end.handle ?? ''}`, end.id, ids.join, end.handle)
      );
  }
  newEdges.push(edge(`${ids.base}_test_in`, ids.join, ids.test));
  const marked = back.flat().some((e) => e.type === 'loop-back');
  newEdges.push({
    ...edge(`${ids.base}_again`, ids.test, loopStep, 'true'),
    ...(marked ? { type: 'loop-back' } : {}),
  } as FlowEdge);
  const outIds = new Set(out.map((e) => e.id));
  return {
    ...flow,
    nodes: [...flow.nodes, ...added],
    edges: [...flow.edges.filter((e) => !outIds.has(e.id) && !backIds.has(e.id)), ...newEdges],
  };
}
