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
 * The condition whose list `id` is chained into, as the loops read it
 * (2.2), or null: a plain condition whose one way in -- lines back round
 * counted: a test a line comes back into is a loop's test (the maintainer,
 * 2026-10-24) -- is the one "yes" line of the condition before it, whose
 * own "no" lines, if any, go where the list's do (the nearest "no" lines
 * up the list: #322 compared them with the condition before's own, so a
 * member after one with none was read as no member). Exported for the
 * check that holds every reader of the list rule to the same answers; its
 * own implementation, on purpose.
 */
export function loopListParent(flow: FlowGraph, id: string): string | null {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const edges = lines(flow);
  const outOf = (at: string, handle: 'true' | 'false') =>
    edges.filter((e) => e.source === at && e.sourceHandle === handle);
  const targetsOf = (list: FlowEdge[]) => [...new Set(list.map((e) => e.target))].sort();
  const parentOf = (at: string, seen: Set<string>): string | null => {
    if (seen.has(at)) return null;
    seen.add(at);
    const n = byId.get(at);
    if (n?.type !== 'condition' || blockKey(n) !== undefined) return null;
    const ways = edges.filter((e) => e.target === at);
    if (ways.length !== 1 || ways[0].sourceHandle !== 'true') return null;
    const up = ways[0].source;
    if (byId.get(up)?.type !== 'condition') return null;
    // Chained on the condition's one "yes" line: beside another, it is a
    // branch of that side, not the list's next member.
    if (outOf(up, 'true').length !== 1) return null;
    const listNo = listNoOf(up, new Set(seen));
    const own = targetsOf(outOf(at, 'false'));
    if (own.length > 0 && own.join('\u0000') !== listNo.join('\u0000')) return null;
    // (Its one line in being from the condition before, the list's "no"
    // can reach it only through that condition: never where the list's
    // branches meet, #26, so there's nothing more to check.)
    return up;
  };
  /** The nearest "no" lines' targets up the list from `at`. */
  const listNoOf = (at: string, seen: Set<string>): string[] => {
    const own = targetsOf(outOf(at, 'false'));
    if (own.length > 0) return own;
    const up = parentOf(at, seen);
    return up === null ? [] : listNoOf(up, seen);
  };
  return parentOf(id, new Set());
}

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
  const memberOf = (id: string): string | null => loopListParent(flow, id);
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
  // An If/Else card is an `if` wherever it is: Home Assistant sends a test
  // it can't check to the "no" side of an if, so it is no loop's test,
  // even where its "no" goes back round (#311; decided with the
  // maintainer, 2026-10-29).
  if (blockKey(byId.get(head)) === 'if_else') return null;
  const isUntilCard = blockKey(byId.get(head)) === 'repeat_until';
  // A test whose "no" goes back to a Repeat While card's head is an if in
  // that card's body: the card is the guard. Only a card whose loop the
  // test is in (the every-small-drawing test: a test's "no" leading on,
  // forward, to an inner loop's card is no if in that loop).
  const enclosing = enclosingHeads(flow, head);
  if (
    !isUntilCard &&
    round.some((id) => blockKey(byId.get(id)) === 'repeat_while' && enclosing.has(id))
  )
    return null;
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

/** Steps that do nothing on their own: tests, Joins and grouping marks. */
const CONTROL_ONLY = new Set(['condition', 'join', 'sequence_start', 'sequence_end']);

/**
 * A loop with no step in it (2026-10-18, the every-small-drawing test; the
 * maintainer: refuse it with a reason): a loop -- a region of steps that
 * can all reach each other, inner loops included -- made only of tests,
 * Joins or grouping marks, a test whose line goes back to itself, say.
 * Nothing in it waits or changes anything, so as drawn it checks its tests
 * over and over; Home Assistant runs such a `repeat` about 20,000 rounds a
 * second and stops the automation after 10,000 (checked in HA 2026.10). A
 * loop with a step anywhere in it is not one (`while W: [if C: a]` going
 * round from C's "no" side has a step, and is Home Assistant's own), nor
 * one with a template test: a template can read what changes each round
 * (`repeat: until: "{{ repeat.index >= 2 }}"` with nothing in it ends
 * after two rounds), nor one with a branch beside its way round: a line
 * from one of its steps to a step outside it, from a side that also goes
 * round (#265: the next round waits for that branch). A disabled step
 * does nothing (Home Assistant skips it, and the state machine leaves it
 * out): a loop whose steps are all disabled has no step in it. Returns the
 * first step (by id) of the first such loop, or null.
 */
export function stepFreeLoop(flow: FlowGraph): string | null {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const doesNothing = (id: string): boolean => {
    const node = byId.get(id);
    if (!node) return false;
    const data = node.data as Record<string, unknown> | undefined;
    if (data?.enabled === false && node.type !== 'trigger') return true;
    if (!CONTROL_ONLY.has(node.type)) return false;
    return !(data?.condition === 'template' || JSON.stringify(data ?? {}).includes('{{'));
  };
  const edges = lines(flow);
  const branchBeside = (loop: LoopRegion): boolean =>
    edges.some(
      (e) =>
        loop.nodes.has(e.source) &&
        !loop.nodes.has(e.target) &&
        !doesNothing(e.target) &&
        edges.some(
          (o) =>
            o !== e &&
            o.source === e.source &&
            (o.sourceHandle ?? '') === (e.sourceHandle ?? '') &&
            loop.nodes.has(o.target)
        )
    );
  // A test (or Join) with a line straight back to itself goes round with
  // nothing in between even inside a loop that has steps elsewhere (the
  // every-small-drawing test, tier single4: "c1? yes: back to c1").
  const selfLines = edges
    .filter((e) => e.source === e.target && doesNothing(e.source))
    .map((e) => e.source);
  const found = [
    ...selfLines,
    ...loopStructure(flow)
      .loops.filter((loop) => [...loop.nodes].every(doesNothing) && !branchBeside(loop))
      .map((loop) => [...loop.nodes].sort()[0]),
  ].sort();
  return found[0] ?? null;
}

/**
 * Branches of a fan-out going back round a loop entered at several places
 * (#285, seed 20261022 session 773): which of those entries a branch's
 * round comes back to, and whether the branches meet there or each go
 * round on its own, can't be told from the drawing, and Home Assistant
 * has no form for each going round on its own; such a drawing is refused
 * with the reason, as it was before the lines back were read without a
 * walk (#283's last step). `backEdgeIds` are the
 * readers' lines back (analyzer/topology.ts). Returns the fan-out's step,
 * or null.
 */
export function branchesRoundALoopEnteredTwice(
  flow: FlowGraph,
  backEdgeIds: Set<string>
): string | null {
  const edges = lines(flow);
  const outOf = (id: string) => edges.filter((e) => e.source === id);
  for (const loop of loopStructure(flow).loops) {
    if (loop.heads.size < 2) continue;
    /** Whether a line leads back round this loop: it is a line back to one
     * of its heads, or goes on by forward lines to one. */
    const goesRound = (start: FlowEdge): boolean => {
      if (backEdgeIds.has(start.id)) return loop.heads.has(start.target);
      const seen = new Set<string>();
      const todo = [start.target];
      while (todo.length > 0) {
        const id = todo.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const e of outOf(id)) {
          if (backEdgeIds.has(e.id)) {
            if (loop.heads.has(e.target) && loop.nodes.has(e.source)) return true;
          } else todo.push(e.target);
        }
      }
      return false;
    };
    for (const id of [...loop.nodes].sort()) {
      const bySide = new Map<string, FlowEdge[]>();
      for (const e of outOf(id))
        bySide.set(e.sourceHandle ?? '', [...(bySide.get(e.sourceHandle ?? '') ?? []), e]);
      for (const side of bySide.values())
        if (side.length >= 2 && side.filter(goesRound).length >= 2) return id;
    }
  }
  return null;
}

/**
 * Bug #307: the branches of a fan-out outside a loop entered at several
 * places going into it at different steps ("t: c1 and c2 at once; c1 yes:
 * a3, no: c2; c2 no: a3, then back to c2"). Where they meet, and whether
 * one waits for the other there, is the same open question as above:
 * the graph walk met them at a3, the state machine took the line to c2
 * for a shortcut and ran a round more. #314 (the every-small-drawing
 * test, tier fanout: "c1 and c2 at once; c1 yes: a3; c2 either way: a3,
 * then back to c1"): the same where neither branch gets to the other's
 * step at all. Two lines of one side going into such a loop -- one with a
 * way out -- at different steps are refused, unless every run of one gets
 * to the other's first step before going into the loop anywhere else (a
 * test's sides are each a run; a fan-out's lines all run): that line beside
 * is a shortcut, the state machine leaves it out, and the branches meet
 * there. Measured on the whole fanout tier: of the drawings this refuses
 * that saved before, every one saved wrong. Returns the fan-out's step and
 * the steps its branches go in at, or null.
 */
export function branchesIntoALoopApart(
  flow: FlowGraph
): { step: string; entries: string[] } | null {
  const edges = lines(flow);
  const outOf = (id: string) => edges.filter((e) => e.source === id);
  for (const loop of loopStructure(flow).loops) {
    if (loop.heads.size < 2) continue;
    // A loop with no way out runs until HA's limit on any reading.
    const wayOut = [...loop.nodes].some(
      (id) =>
        outOf(id).some((e) => !loop.nodes.has(e.target)) ||
        (flow.nodes.find((n) => n.id === id)?.type === 'condition' &&
          new Set(outOf(id).map((e) => e.sourceHandle ?? '')).size < 2)
    );
    if (!wayOut) continue;
    /** The loop's steps a line goes in at, by lines outside the loop and
     * not through the step that fans out. */
    const entriesOf = (start: FlowEdge): Set<string> => {
      const found = new Set<string>();
      const seen = new Set<string>([start.source]);
      const todo = [start.target];
      while (todo.length > 0) {
        const id = todo.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        if (loop.nodes.has(id)) found.add(id);
        else for (const e of outOf(id)) todo.push(e.target);
      }
      return found;
    };
    const sidesOf = (id: string): FlowEdge[][] => {
      const bySide = new Map<string, FlowEdge[]>();
      for (const e of outOf(id))
        bySide.set(e.sourceHandle ?? '', [...(bySide.get(e.sourceHandle ?? '') ?? []), e]);
      return [...bySide.values()];
    };
    const steps = new Set(edges.map((e) => e.source));
    for (const id of [...steps].sort()) {
      if (loop.nodes.has(id)) continue;
      /** Whether every run from `at` gets to `to` before going into the
       * loop at any other step (`at` itself may be in it), not through
       * the step that fans out: each side a test can take has a line
       * that does. */
      const firstTo = (at: string, to: string, on: Set<string>, start: boolean): boolean => {
        if (at === to) return true;
        if (on.has(at) || at === id || (loop.nodes.has(at) && !start)) return false;
        const sides = sidesOf(at);
        const next = new Set([...on, at]);
        return (
          sides.length > 0 &&
          sides.every((side) => side.some((e) => firstTo(e.target, to, next, false)))
        );
      };
      for (const side of sidesOf(id)) {
        const into = side.filter((e) => entriesOf(e).size > 0);
        for (const a of into)
          for (const b of into) {
            if (a === b) continue;
            const entries = new Set([...entriesOf(a), ...entriesOf(b)]);
            if (entries.size < 2) continue;
            if (
              firstTo(a.target, b.target, new Set(), true) ||
              firstTo(b.target, a.target, new Set(), true)
            )
              continue;
            return { step: id, entries: [...entries].sort() };
          }
      }
    }
  }
  return null;
}

/**
 * Bug #317: a condition in a while loop's body whose branches meet at a
 * step, one of its paths going back to the loop's test without passing
 * that step ("while c1: c2? yes: the light; no: c4? yes: a5, then back to
 * c1; no: the light; the light, then back to c1"). HA has no "go round
 * now": a body is one list, so written as `if` then the meeting step, the
 * path back from a5 ran the light too. Only a while (its head a test): a
 * step or Join head is a do-while's, and going back to it is that loop's
 * round. Returns the test, the condition and its meeting step, or null.
 */
export function goesRoundEarlyInAWhile(
  flow: FlowGraph
): { head: string; at: string; meeting: string } | null {
  const edges = lines(flow);
  const outOf = (id: string) => edges.filter((e) => e.source === id);
  const typeOf = (id: string) => flow.nodes.find((n) => n.id === id)?.type;
  for (const loop of loopStructure(flow).loops) {
    if (loop.irreducible) continue;
    const head = [...loop.heads][0];
    if (typeOf(head) !== 'condition') continue;
    const body = loop.nodes;
    /**
     * The body's steps from `from` on, not through the head or any of
     * `avoid`; with `stopAt`, those are recorded but not gone past.
     */
    const reach = (from: string, avoid: Set<string>, stopAt?: Set<string>): Set<string> => {
      const seen = new Set<string>();
      const todo = [from];
      while (todo.length > 0) {
        const id = todo.pop()!;
        if (seen.has(id) || id === head || avoid.has(id) || !body.has(id)) continue;
        seen.add(id);
        if (stopAt?.has(id)) continue;
        for (const e of outOf(id)) todo.push(e.target);
      }
      return seen;
    };
    const goesBack = (ids: Set<string>) =>
      [...ids].some((id) => outOf(id).some((e) => e.target === head));
    for (const at of [...body].sort()) {
      if (at === head || typeOf(at) !== 'condition') continue;
      const sides = (['true', 'false'] as const).map((h) =>
        outOf(at).filter((e) => e.sourceHandle === h)
      );
      if (sides.some((side) => side.length === 0)) continue;
      // A condition on a loop inside the body (its test, or a step in it)
      // is that loop's: leaving it isn't going round the while early, and
      // the inner loop is checked as a loop of its own.
      if (sides.some((side) => side.some((e) => reach(e.target, new Set()).has(at)))) continue;
      const notAt = new Set([at]);
      const sideReach = (side: (typeof sides)[number], stopAt?: Set<string>) => {
        const all = new Set<string>();
        for (const e of side) for (const id of reach(e.target, notAt, stopAt)) all.add(id);
        return all;
      };
      const reached = sides.map((side) => sideReach(side));
      const common = new Set([...reached[0]].filter((id) => reached[1].has(id)));
      // Where the branches meet: the common step each side comes to before
      // any other (the steps of a loop after it all reach one another, so
      // "every other comes after it" names no one step).
      const firsts = new Set<string>();
      for (const side of sides)
        for (const id of sideReach(side, common)) if (common.has(id)) firsts.add(id);
      if (firsts.size !== 1) continue;
      const meeting = [...firsts][0];
      for (const side of sides)
        for (const e of side) {
          if (e.target === head || e.target === meeting) continue;
          if (goesBack(reach(e.target, new Set([at, meeting])))) return { head, at, meeting };
        }
    }
  }
  return null;
}

/**
 * Bug #318: a loop two of its tests guard -- each with one side staying in
 * the loop and the other leaving it -- whose ways out go on to a common
 * step ("c1? yes: c2; c2 yes: a3, then c5? yes: back to c2; c2's no and
 * c5's no to a Join, then back to c1"). HA's `repeat` has one test; the
 * other way out would be a break, which it has no form for. Native wrote
 * c2 as an if in an until loop on c5, so with c2 off the automation asked
 * c5 and could go round where the canvas goes straight to the Join. A
 * while's list (tests at the loop's head, chained on "yes", going out
 * where the head does) is one test. Ways out that go on to no common step (one ending the run, as
 * an `if: [stop]` does) need no break; "common" stops short of coming
 * back into the loop. Returns the loop's head and the two
 * tests, or null.
 */
export function twoWaysOutOfALoop(
  flow: FlowGraph
): { head: string; first: string; second: string } | null {
  const edges = lines(flow);
  const typeOf = (id: string) => flow.nodes.find((n) => n.id === id)?.type;
  const reachOf = (from: string[]): Set<string> => {
    const seen = new Set<string>();
    const todo = [...from];
    while (todo.length > 0) {
      const id = todo.pop()!;
      if (seen.has(id) || within.has(id)) continue;
      seen.add(id);
      for (const e of edges) if (e.source === id) todo.push(e.target);
    }
    return seen;
  };
  let within = new Set<string>();
  for (const loop of loopStructure(flow).loops) {
    // Where a way out goes on to, short of coming back into the loop.
    within = loop.nodes;
    if (loop.irreducible) continue;
    const guards: { id: string; out: string[] }[] = [];
    for (const id of [...loop.nodes].sort()) {
      if (typeOf(id) !== 'condition') continue;
      const side = (h: 'true' | 'false') =>
        edges.filter((e) => e.source === id && e.sourceHandle === h).map((e) => e.target);
      const [yes, no] = [side('true'), side('false')];
      const inside = (ts: string[]) => ts.length > 0 && ts.every((t) => loop.nodes.has(t));
      const outside = (ts: string[]) => ts.length > 0 && ts.every((t) => !loop.nodes.has(t));
      if (inside(yes) && outside(no)) guards.push({ id, out: [...no].sort() });
      else if (inside(no) && outside(yes)) guards.push({ id, out: [...yes].sort() });
    }
    const sameOut = (a: string[], b: string[]) => a.join('\u0000') === b.join('\u0000');
    const meet = (a: string[], b: string[]) => {
      const seen = reachOf(a);
      return [...reachOf(b)].some((id) => seen.has(id));
    };
    const guardOf = new Map(guards.map((g) => [g.id, g]));
    // At the while's head: the head, or reached only by "yes" lines from
    // tests that are (no step between).
    const atHead = (id: string, seen = new Set<string>()): boolean => {
      if (loop.heads.has(id)) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const ins = edges.filter((e) => e.target === id);
      return (
        ins.length > 0 &&
        ins.every(
          (e) =>
            e.sourceHandle === 'true' && typeOf(e.source) === 'condition' && atHead(e.source, seen)
        )
      );
    };
    // A member of the while's own list (at the loop's head, no step
    // before it; native writes a list after a step, an until's, as an if
    // and a test -- single-57):
    // reached only by a "yes" line from the list's test, or
    // through tests between them that are members themselves (no "no"
    // line, or going out where the list does) or whose own way out never
    // meets the list's (an `if: [stop]` in the chain, say).
    const isMember = (g: (typeof guards)[number]) =>
      guards.some((h) => {
        if (h.id === g.id || !atHead(h.id) || !sameOut(h.out, g.out)) return false;
        let at = g.id;
        const seen = new Set<string>();
        while (!seen.has(at)) {
          seen.add(at);
          const ins = edges.filter((e) => e.target === at);
          if (ins.length !== 1 || ins[0].sourceHandle !== 'true') return false;
          if (ins[0].source === h.id) return true;
          const from = ins[0].source;
          const between = guardOf.get(from);
          // A test with no "no" line is a member itself (it shares the
          // list's "no").
          const hasNoLine = edges.some((e) => e.source === from && e.sourceHandle === 'false');
          if (
            between === undefined
              ? typeOf(from) !== 'condition' || hasNoLine
              : !sameOut(between.out, h.out) && meet(between.out, h.out)
          )
            return false;
          at = from;
        }
        return false;
      });
    const tests = guards.filter((g) => !isMember(g));
    for (let i = 0; i < tests.length; i++)
      for (let j = i + 1; j < tests.length; j++) {
        if (meet(tests[i].out, tests[j].out))
          return { head: [...loop.heads][0], first: tests[i].id, second: tests[j].id };
      }
  }
  return null;
}
