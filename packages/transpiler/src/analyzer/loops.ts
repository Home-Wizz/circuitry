import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';

/**
 * The loops of a drawing, read without a depth-first walk (bug #283, the
 * rule decided with the maintainer on 2026-10-16).
 *
 * Which line of a loop is its "line back" used to be whichever line a
 * depth-first search met last, so a loop with two ways in (two triggers,
 * or a trigger joined at its test and at its step) read differently
 * depending on where the search started (#277, #282). Here a loop is a
 * set of steps that can all reach each other (a strongly connected
 * region), nested the standard way: a region with one way in is a loop
 * with that step as its head, and its inner loops are the regions left
 * when the head is taken out; a region with several ways in (an
 * irreducible region) is one loop, read no further -- the documented
 * limit: a loop nested inside such a region is read as part of it.
 *
 * On top of that, the one semantic rule the readers share: **a plain
 * condition that guards its loop ends the loop when it can't be checked,
 * as Home Assistant's own `while` and `until` do**; a plain condition
 * whose both sides stay inside the loop is an if in the loop's body and
 * takes its "no" line, as HA's `if` does (#128). A guard's "no" side
 * staying in the loop and its "yes" side leaving is the until shape:
 * ending the loop means taking the "yes" side. Every other shape (a
 * while's head, a do-while's test, an if inside) ends up on its "no"
 * side on an error either way, so `untilExit` is the only question the
 * readers need to ask. A condition LIST (2.2: members chained on "yes"
 * lines, sharing the head's "no") is one test: the head's "no" is the
 * round, the last member's "yes" the exit, and an error anywhere in the
 * list ends the loop (HA stops a condition list at its first error).
 * An Until card's test keeps the card's meaning: its "no" side is the
 * round, even where that side also goes on elsewhere.
 */

export interface LoopRegion {
  /** Every step in the loop (its heads included). */
  nodes: Set<string>;
  /** The steps lines from outside the loop lead into. */
  heads: Set<string>;
  /** More than one head: read as one loop, with no inner loops. */
  irreducible: boolean;
  /** The loop this one is nested in, by index into `loops`. */
  parent: number | null;
}

export interface LoopStructure {
  loops: LoopRegion[];
  /** Each step's innermost loop, by index into `loops`. */
  innermost: Map<string, number>;
}

const lines = (flow: FlowGraph): FlowEdge[] =>
  flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');

const cache = new WeakMap<FlowGraph, LoopStructure>();

/** The loops of `flow`, nested (see the file comment). Cached per graph. */
export function loopStructure(flow: FlowGraph): LoopStructure {
  const found = cache.get(flow);
  if (found) return found;
  const edges = lines(flow);
  const out = new Map<string, string[]>();
  for (const n of flow.nodes) out.set(n.id, []);
  for (const e of edges) out.get(e.source)?.push(e.target);
  const loops: LoopRegion[] = [];
  const innermost = new Map<string, number>();

  const findLoops = (within: Set<string>, parent: number | null): void => {
    for (const region of stronglyConnected(within, out)) {
      const heads = new Set(
        edges.filter((e) => region.has(e.target) && !region.has(e.source)).map((e) => e.target)
      );
      // A loop nothing leads into (unreachable steps going round): every
      // step is a head, and nothing can run it anyway.
      if (heads.size === 0) for (const id of region) heads.add(id);
      const index = loops.length;
      loops.push({ nodes: region, heads, irreducible: heads.size > 1, parent });
      for (const id of region) innermost.set(id, index);
      if (heads.size === 1) {
        const inner = new Set(region);
        for (const h of heads) inner.delete(h);
        findLoops(inner, index);
      }
    }
  };
  findLoops(new Set(flow.nodes.map((n) => n.id)), null);
  const result = { loops, innermost };
  cache.set(flow, result);
  return result;
}

/** The nontrivial strongly connected regions of the steps in `within`
 * (two or more steps, or one step with a line to itself), Tarjan's way,
 * in a fixed order (by step id) so the result never depends on the order
 * lines were drawn in. */
function stronglyConnected(within: Set<string>, out: Map<string, string[]>): Set<string>[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const regions: Set<string>[] = [];
  let counter = 0;
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of [...(out.get(v) ?? [])].sort()) {
      if (!within.has(w)) continue;
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const region = new Set<string>();
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        region.add(w);
      } while (w !== v);
      const selfLoop = region.size === 1 && (out.get(v) ?? []).includes(v);
      if (region.size > 1 || selfLoop) regions.push(region);
    }
  };
  for (const v of [...within].sort()) if (!index.has(v)) visit(v);
  return regions;
}

const blockKey = (node: FlowNode | undefined): unknown =>
  (node?.data as Record<string, unknown> | undefined)?._blockKey;

/**
 * Where a condition's loop goes on when the condition can't be checked
 * and that ends the loop on its "yes" side (the until shape, see the file
 * comment): the exit targets. Null when an error takes the "no" side
 * instead -- the condition is in no loop, is an if inside its loop (one
 * whose "no" goes back to a Repeat While card's head among them: that
 * card is the guard), or guards it from the "yes" side (a while, a
 * do-while), where "no" is the exit anyway. `node` may be any member of
 * the loop's condition list. Returns the exit lines ([] when the exit is a
 * path end).
 */
export function untilExit(flow: FlowGraph, nodeId: string): FlowEdge[] | null {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (node?.type !== 'condition') return null;
  if ((node.data as Record<string, unknown>).enabled === false) return null;
  const edges = lines(flow);
  const outOf = (id: string, handle: 'true' | 'false') =>
    edges.filter((e) => e.source === id && e.sourceHandle === handle);
  const into = (id: string) => edges.filter((e) => e.target === id);
  // A list member (2.2): a plain condition, no "no" line of its own, its
  // one way in the one "yes" line of the condition before it.
  // A member may also carry "no" lines to exactly the head's "no" targets
  // (2.2, bug #51; for an until, back to where the head's go: #115).
  const sameTargets = (a: FlowEdge[], b: FlowEdge[]) => {
    const x = [...new Set(a.map((e) => e.target))].sort().join('\u0000');
    return x === [...new Set(b.map((e) => e.target))].sort().join('\u0000');
  };
  const memberOf = (id: string): string | null => {
    const n = byId.get(id);
    if (n?.type !== 'condition' || blockKey(n) !== undefined) return null;
    const ways = into(id);
    if (ways.length !== 1 || ways[0].sourceHandle !== 'true') return null;
    const up = ways[0].source;
    if (byId.get(up)?.type !== 'condition') return null;
    // Chained on the condition's one "yes" line: beside another, it is a
    // branch of that side, not the list's next member.
    if (outOf(up, 'true').length !== 1) return null;
    const own = outOf(id, 'false');
    if (own.length > 0 && !sameTargets(own, outOf(up, 'false'))) return null;
    return up;
  };
  let head = nodeId;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(head)) return null;
    seen.add(head);
    const up = memberOf(head);
    if (up === null) break;
    head = up;
  }
  let last = head;
  for (;;) {
    const yes = outOf(last, 'true');
    if (yes.length !== 1 || memberOf(yes[0].target) !== last) break;
    last = yes[0].target;
  }

  const { loops, innermost } = loopStructure(flow);
  const loopIndex = innermost.get(head);
  if (loopIndex === undefined) return null;
  const loop = loops[loopIndex].nodes;
  const round = outOf(head, 'false').map((e) => e.target);
  // No "yes" line at all: the exit is a path end (decision D1), and the
  // loop still ends there on an error -- an empty exit, not null.
  const exitLines = outOf(last, 'true');
  if (round.length === 0) return null;
  const isUntilCard = blockKey(byId.get(head)) === 'repeat_until';
  if (!isUntilCard && round.some((id) => blockKey(byId.get(id)) === 'repeat_while')) return null;
  // The round stays in the loop (an Until card's "no" side is its round
  // even where it also goes on elsewhere); the exit leaves it.
  const roundStays = isUntilCard
    ? round.some((id) => loop.has(id))
    : round.every((id) => loop.has(id));
  const exitLeaves = exitLines.every((e) => !loop.has(e.target));
  return roundStays && exitLeaves ? exitLines : null;
}

/** Whether the steps in `ids` can go round among themselves (a cycle
 * within them, other lines ignored): the order-independent form of "the
 * path loops" (#283; meeting-lines.ts read it from DFS back edges). */
export function hasCycleWithin(flow: FlowGraph, ids: Set<string>): boolean {
  const out = new Map<string, string[]>();
  for (const id of ids) out.set(id, []);
  for (const e of lines(flow))
    if (ids.has(e.source) && ids.has(e.target)) out.get(e.source)!.push(e.target);
  return stronglyConnected(ids, out).length > 0;
}

/** Whether a line from `id` to `head` is the only way a loop `id` is in
 * goes round: `head` is that loop's one head. A head of a loop with
 * several ways in (an irreducible region) is not: which of its lines is
 * the line back depends on where the run came in, so the line from `id`
 * is a forward line in one run and the round in another -- a meeting
 * question for unwrittenMeetings, not a round (editor fuzzer, seed
 * 20261025, session 640: taken for a round, the direct line was dropped as
 * a shortcut and the saved automation ended where the canvas goes round). */
export function onlyWayRound(flow: FlowGraph, id: string, head: string): boolean {
  const { loops, innermost } = loopStructure(flow);
  for (let i = innermost.get(id); i !== undefined && i !== null; i = loops[i].parent ?? undefined) {
    if (loops[i].heads.size === 1 && loops[i].heads.has(head)) return true;
  }
  return false;
}

/** The heads of every loop `id` is in, innermost first: reaching one of
 * them from inside is the loop going round (#283). */
export function enclosingHeads(flow: FlowGraph, id: string): Set<string> {
  const { loops, innermost } = loopStructure(flow);
  const heads = new Set<string>();
  for (let i = innermost.get(id); i !== undefined && i !== null; i = loops[i].parent ?? undefined) {
    for (const h of loops[i].heads) heads.add(h);
  }
  return heads;
}

/**
 * The steps of one branch of a fan-out, when that branch goes round a
 * loop of its own -- written then as a small state machine of its own,
 * which needs no loop recognized (#284). The branch starts at `target`
 * and stops at `bound` (where the branches meet and what follows) or
 * where its paths end. Null when the
 * branch has no loop, or leaves its own steps another way: back to the
 * fan-out's step or round a loop the fan-out is in (that is the enclosing
 * run's business, written as before).
 */
export function branchMachineRegion(
  flow: FlowGraph,
  targets: string[],
  bound: Set<string> | null,
  source: string
): Set<string> | null {
  if (targets.length !== 1) return null;
  const edges = lines(flow);
  const avoid = new Set([source, ...enclosingHeads(flow, source)]);
  const region = new Set<string>();
  const queue = [targets[0]];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (region.has(id) || bound?.has(id)) continue;
    if (avoid.has(id)) return null;
    region.add(id);
    for (const e of edges) if (e.source === id) queue.push(e.target);
  }
  if (region.size === 0 || !hasCycleWithin(flow, region)) return null;
  return region;
}
